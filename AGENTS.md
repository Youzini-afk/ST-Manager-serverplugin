# AGENTS.md

## Build & Development Commands

### Starting the Application
```bash
# Standard run (production mode)
python app.py

# Debug mode with hot reload
python app.py --debug
# or
FLASK_DEBUG=1 python app.py
```

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Testing
This project currently has no automated test suite. Tests should be added following these guidelines:
- Create `test_*.py` files in a new `tests/` directory
- Use pytest as the test framework
- Run all tests: `pytest tests/`
- Run single test: `pytest tests/test_module.py::test_function_name`

### Linting & Type Checking
No linting tools are currently configured. Recommended setup:
```bash
# Install linting tools
pip install black flake8 mypy pylint

# Format code
black .

# Check style
flake8 .

# Type checking
mypy core/
```

## Code Style Guidelines

### File Organization & Imports
- **Standard library imports first**: `import os`, `import sys`, `import json`
- **Third-party imports second**: `from flask import Blueprint`, `import requests`
- **Local imports last**: `from core.config import CARDS_FOLDER`
- Group imports with blank lines between sections
- Use absolute imports for core modules: `from core.config import ...`
- Avoid circular imports - keep dependencies shallow

### Naming Conventions
- **Classes**: `PascalCase` - `GlobalMetadataCache`, `AutomationEngine`
- **Functions/Methods**: `snake_case` - `extract_card_info`, `load_config`
- **Variables**: `snake_case` - `card_id`, `file_path`
- **Constants**: `UPPER_CASE` - `CARDS_FOLDER`, `SIDECAR_EXTENSIONS`
- **Private methods**: `_leading_underscore` - `_init_state()`, `_update_category_count()`
- **Blueprints**: Lowercase, descriptive - `bp = Blueprint('cards', __name__)`

### Formatting Standards
- **Indentation**: 4 spaces (no tabs)
- **Line length**: Target 100-120 characters max
- **Blank lines**: 2 between top-level functions, 1 between class methods
- **Trailing whitespace**: Remove all trailing whitespace
- **String quotes**: Single quotes for string literals, double quotes for JSON output

### Type Hints
- Type hints are **not** currently enforced but recommended for new code
- Use Python 3.6+ type hint syntax: `def load_config() -> dict:`
- For complex types, import from `typing`: `from typing import List, Dict, Optional`

### Docstrings
- Use triple-double quotes for docstrings
- Describe function purpose, parameters, and return values
- Keep it concise and Chinese-friendly for user-facing strings

```python
def extract_card_info(filepath):
    """
    解析卡片文件元数据。
    支持 PNG (tEXt chunk) 和 JSON 格式。
    返回标准化的卡片字典，失败返回 None。
    """
```

### Error Handling
- Always use try-except for file I/O operations
- Log errors using `logger.error()` from logging module
- Use `logger.warning()` for non-critical issues
- Return `None` or `False` on expected failures, not empty exceptions
- Never expose stack traces to user-facing endpoints

```python
try:
    data = json.load(f)
except Exception as e:
    logger.error(f"Failed to parse {filepath}: {e}")
    return None
```

### Threading & Concurrency
- Use `threading.Lock()` for shared state protection
- Always use `with lock:` context manager for critical sections
- Background threads should be daemons: `threading.Thread(..., daemon=True)`
- Use `ctx.scan_queue` for inter-thread communication
- Use `queue.Queue()` for thread-safe message passing

### Database Operations
- Use `sqlite3` directly for queries
- Always use parameterized queries to prevent SQL injection
- Use `execute_with_retry()` for retryable operations
- Close connections properly with context managers

```python
with sqlite3.connect(db_path, timeout=60) as conn:
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM table WHERE id = ?", (id,))
```

### Flask/Blueprint Patterns
- Use Flask Blueprints for API routing
- Return JSON with `jsonify()` for API responses
- Use standard HTTP status codes: 200, 400, 404, 500
- Structure: `@bp.route('/api/endpoint', methods=['GET', 'POST'])`

### File Paths
- Always use `os.path.join()` for cross-platform compatibility
- Use `os.path.dirname()` and `os.path.basename()` for path manipulation
- Normalize paths with `.replace('\\', '/')` when storing in database
- Check path existence before operations with `os.path.exists()`

### JSON Handling
- Use `ensure_ascii=False` when dumping JSON to support Chinese characters
- Use `indent=4` for human-readable JSON files
- Use `separators=(',', ':')` for compact JSON output
- Always handle JSON parse errors

```python
json.dump(data, f, ensure_ascii=False, indent=4, separators=(',', ': '))
```

### Logging
- Get logger per module: `logger = logging.getLogger(__name__)`
- Use appropriate levels: `logger.debug()`, `logger.info()`, `logger.warning()`, `logger.error()`
- Log meaningful context, not just "Error occurred"
- Print user-facing messages with `print()` for CLI visibility

### Code Patterns
- **Singleton pattern** for global context: `AppContext` class in `core/context.py`
- **Factory pattern** for Flask app: `create_app()` function
- **Service layer** in `core/services/` for business logic
- **Utility layer** in `core/utils/` for reusable functions
- **API layer** in `core/api/v1/` for Flask routes

### Bundle/Version Management
- Cards in folders with `.bundle` marker are treated as multi-version bundles
- Bundle cards aggregate all versions and display latest as primary
- Use `bundle_dir` field to track bundle association
- Handle version conflicts by checking modification times

### Configuration
- Load from `config.json` in project root
- Use `DEFAULT_CONFIG` for default values
- Support both absolute and relative paths
- Reload config on changes via `load_config()`

### Comments & Documentation
- Use Chinese comments for user-facing strings and messages
- Use English for technical comments and variable names
- Explain complex logic briefly inline
- No need for excessive commenting of obvious code

### Anti-Patterns to Avoid
- Don't use global variables (use `ctx` singleton instead)
- Don't catch all exceptions with bare `except:` - specify exception types
- Don't use mutable default arguments: `def func(items=[]):` → `def func(items=None):`
- Don't hardcode paths - use config constants from `core.config`
- Don't commit secrets or sensitive data to repository
- Don't use `print()` for logging in production code
