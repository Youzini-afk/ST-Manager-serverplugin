import os
import json
import logging
import re
from core.config import DATA_DIR

logger = logging.getLogger(__name__)

RULES_DIR = os.path.join(DATA_DIR, 'system', 'automation')

if not os.path.exists(RULES_DIR):
    os.makedirs(RULES_DIR)

class RuleManager:
    def __init__(self):
        pass

    def _sanitize_filename(self, name):
        """将名称转换为合法文件名"""
        # 替换非法字符为下划线，去除前后空格
        name = re.sub(r'[\\/*?:"<>|]', '_', str(name).strip())
        return name if name else "Untitled_Ruleset"

    def list_rulesets(self):
        """列出所有规则集文件"""
        results = []
        if not os.path.exists(RULES_DIR): return []
        
        for f in os.listdir(RULES_DIR):
            if f.endswith('.json'):
                try:
                    path = os.path.join(RULES_DIR, f)
                    with open(path, 'r', encoding='utf-8') as f_obj:
                        data = json.load(f_obj)
                        if data.get('spec') == 'st_manager_ruleset':
                            # ID 就是文件名（不含扩展名）
                            f_id = os.path.splitext(f)[0]
                            results.append({
                                "id": f_id, 
                                "meta": data.get('meta', {}),
                                "rule_count": len(data.get('rules', [])),
                                "path": path
                            })
                except Exception as e:
                    logger.error(f"Error reading ruleset {f}: {e}")
        return results

    def get_ruleset(self, ruleset_id):
        path = os.path.join(RULES_DIR, f"{ruleset_id}.json")
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # 确保返回数据里包含 id
                data['id'] = ruleset_id 
                return data
        return None

    def save_ruleset(self, old_ruleset_id, data):
        """
        保存规则集
        old_ruleset_id: 编辑前的 ID (文件名)，如果是新建则为 None
        data: 完整数据
        返回: new_ruleset_id (新的文件名)
        """
        # 1. 准备元数据
        data['spec'] = 'st_manager_ruleset'
        if not data.get('spec_version'):
            data['spec_version'] = '1.0'
            
        meta_name = data.get('meta', {}).get('name', 'Untitled')
        
        # 2. 生成基于名称的新 ID (文件名)
        base_filename = self._sanitize_filename(meta_name)
        new_id = base_filename
        
        # 3. 处理重名 (如果是新建，或者改名导致和现存文件冲突)
        # 如果仅仅是保存自己(没有改名)，不需要检查冲突
        check_conflict = True
        if old_ruleset_id and old_ruleset_id.lower() == new_id.lower():
            check_conflict = False
            new_id = old_ruleset_id # 保持原大小写
            
        if check_conflict:
            counter = 1
            while os.path.exists(os.path.join(RULES_DIR, f"{new_id}.json")):
                new_id = f"{base_filename}_{counter}"
                counter += 1
        
        # 4. 如果是改名（old_id 存在 且 不等于 new_id），需要删除旧文件
        if old_ruleset_id and old_ruleset_id != new_id:
            old_path = os.path.join(RULES_DIR, f"{old_ruleset_id}.json")
            if os.path.exists(old_path):
                try:
                    os.remove(old_path)
                    logger.info(f"Renamed ruleset: {old_ruleset_id} -> {new_id}")
                except Exception as e:
                    logger.error(f"Failed to delete old ruleset file {old_path}: {e}")

        # 5. 写入新文件
        # 确保持久化数据里的 ID 字段也是新的
        data['id'] = new_id 
        
        save_path = os.path.join(RULES_DIR, f"{new_id}.json")
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        if old_ruleset_id and old_ruleset_id != new_id:
            from core.config import load_config, save_config
            cfg = load_config()
            if cfg.get('active_automation_ruleset') == old_ruleset_id:
                cfg['active_automation_ruleset'] = new_id
                save_config(cfg)
                logger.info(f"Updated global automation setting from {old_ruleset_id} to {new_id}")
        
        return new_id

    def delete_ruleset(self, ruleset_id):
        if not ruleset_id: return False
        
        # 安全检查，防止路径遍历
        safe_id = os.path.basename(ruleset_id)
        path = os.path.join(RULES_DIR, f"{safe_id}.json")
        
        if os.path.exists(path):
            try:
                os.remove(path)
                return True
            except Exception as e:
                logger.error(f"Delete error: {e}")
                return False
        else:
            logger.warning(f"Delete failed: file not found {path}")
            return False

rule_manager = RuleManager()