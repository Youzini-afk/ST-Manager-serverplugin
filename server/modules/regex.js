/**
 * 正则脚本管理模块
 * 
 * 完整复刻 Python 后端的 core/utils/regex.py 和 st_client.py 中的正则处理逻辑
 * 
 * 关键区分：
 * 1. 全局正则 (Global Regex): 存储在 settings.json 中，通过 extractGlobalRegexFromSettings() 提取
 * 2. 预设绑定正则 (Preset-bound Regex): 存储在预设文件的 extensions.regex_scripts 等字段中
 * 3. 正则脚本文件 (Regex Script Files): 存储在 regex/ 目录下的 .json 文件
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// ==================== 工具函数 ====================

/**
 * 布尔值强制转换
 * 复刻 Python 后端的 _coerce_bool()
 */
function coerceBool(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'enabled'].includes(lowered)) {
            return true;
        }
        if (['false', '0', 'no', 'off', 'disabled', ''].includes(lowered)) {
            return false;
        }
        return true;
    }
    return Boolean(value);
}

/**
 * 标准化单个正则条目
 * 复刻 Python 后端的 _normalize_regex_item()
 * 
 * @param {*} item - 正则条目（可能是字符串、对象等各种格式）
 * @param {string} nameHint - 名称提示
 * @returns {Object|null} 标准化的正则对象，无效返回 null
 */
function normalizeRegexItem(item, nameHint = null) {
    if (item === null || item === undefined) {
        return null;
    }

    // 字符串格式
    if (typeof item === 'string') {
        const pattern = item.trim();
        if (!pattern) {
            return null;
        }
        return {
            name: nameHint || 'regex',
            description: '',
            pattern: pattern,
            replace: '',
            flags: '',
            enabled: true,
            scope: [],
        };
    }

    if (typeof item !== 'object' || Array.isArray(item)) {
        return null;
    }

    // 尝试从多种可能的字段名中获取 pattern
    const pattern = (
        item.pattern ||
        item.regex ||
        item.expression ||
        item.match ||
        item.findRegex ||
        item.find ||
        item.regexPattern ||
        ''
    );
    if (!pattern) {
        return null;
    }

    const name = item.name || item.label || item.scriptName || nameHint || 'regex';
    const flags = item.flags || item.modifiers || '';
    const replace = (
        item.replace ||
        item.replacement ||
        item.replaceString ||
        ''
    );
    const description = item.description || item.comment || '';

    // 处理 enabled/disabled 状态
    let enabled = true;
    if ('enabled' in item) {
        const enabledValue = item.enabled;
        if (typeof enabledValue === 'string' && enabledValue.trim() === '') {
            enabled = true;
        } else {
            enabled = coerceBool(enabledValue);
        }
    } else if ('disabled' in item) {
        enabled = !coerceBool(item.disabled);
    }

    const scope = item.placement || item.scope || [];

    return {
        name,
        description,
        pattern,
        replace,
        flags,
        enabled,
        scope: Array.isArray(scope) ? scope : [],
    };
}

/**
 * 从块中提取正则
 * 复刻 Python 后端的 _extract_from_block()
 * 
 * @param {*} block - 数据块
 * @returns {Array} 提取的正则列表
 */
function extractFromBlock(block) {
    const results = [];
    if (!block) {
        return results;
    }

    // 列表格式
    if (Array.isArray(block)) {
        for (const item of block) {
            const normalized = normalizeRegexItem(item);
            if (normalized) {
                results.push(normalized);
            }
        }
        return results;
    }

    // 字符串格式
    if (typeof block === 'string') {
        const normalized = normalizeRegexItem(block);
        if (normalized) {
            results.push(normalized);
        }
        return results;
    }

    if (typeof block !== 'object') {
        return results;
    }

    // 若本身就是规则对象
    const normalized = normalizeRegexItem(block);
    if (normalized) {
        results.push(normalized);
        return results;
    }

    // RegexBinding / 扩展格式：{ regexes: [...] }
    if (Array.isArray(block.regexes)) {
        for (let idx = 0; idx < (block.regexes || []).length; idx++) {
            const item = block.regexes[idx];
            const nameHint = block.name || `regex_${idx}`;
            const norm = normalizeRegexItem(item, nameHint);
            if (norm) {
                results.push(norm);
            }
        }
        return results;
    }

    // 普通字典：遍历各 key
    for (const [key, value] of Object.entries(block)) {
        if (value === null || value === undefined) {
            continue;
        }
        if (typeof value === 'string') {
            const norm = normalizeRegexItem(value, String(key));
            if (norm) {
                results.push(norm);
            }
            continue;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            // RegexBinding 格式
            if (Array.isArray(value.regexes)) {
                for (let idx = 0; idx < (value.regexes || []).length; idx++) {
                    const item = value.regexes[idx];
                    const nameHint = value.name || `${key}_${idx}`;
                    const norm = normalizeRegexItem(item, nameHint);
                    if (norm) {
                        results.push(norm);
                    }
                }
                continue;
            }

            const norm = normalizeRegexItem(value, String(key));
            if (norm) {
                results.push(norm);
                continue;
            }

            // 其他脚本格式
            if (value.script) {
                const pattern = value.find || value.pattern || '';
                if (pattern) {
                    results.push({
                        name: String(key),
                        description: (value.script || '').substring(0, 100) || 'Script based regex',
                        pattern: pattern,
                        replace: value.replace || '',
                        flags: '',
                        enabled: !coerceBool(value.disabled),
                        scope: [],
                    });
                }
            }
            continue;
        }

        if (Array.isArray(value)) {
            // 嵌套列表
            for (const item of value) {
                const norm = normalizeRegexItem(item, String(key));
                if (norm) {
                    results.push(norm);
                }
            }
        }
    }

    return results;
}

/**
 * 从多个块中提取并去重正则
 * 复刻 Python 后端的 extract_regex_from_blocks()
 * 
 * @param {Array} blocks - 数据块列表
 * @returns {Array} 去重后的正则列表
 */
function extractRegexFromBlocks(blocks) {
    const merged = [];
    const seen = new Set();

    for (const block of blocks) {
        for (const item of extractFromBlock(block)) {
            const key = `${item.pattern || ''}__${item.flags || ''}__${item.replace || ''}`;
            if (!item.pattern) {
                continue;
            }
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(item);
        }
    }

    return merged;
}

// ==================== 预设绑定正则 ====================

/**
 * 从预设数据中提取正则
 * 复刻 Python 后端的 extract_regex_from_preset_data()
 * 
 * 这是提取预设绑定正则的核心函数
 * 
 * @param {Object} raw - 预设原始数据
 * @returns {Array} 提取的正则列表
 */
function extractRegexFromPresetData(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }

    const extensions = raw.extensions || {};
    const extensionSettings = raw.extension_settings || {};

    const candidates = [
        raw.regex,
        raw.regexes,
        raw.regular_expressions,
        extensions.regex,
        extensions.regexes,
        extensions.regular_expressions,
        extensionSettings.regex,
        extensionSettings.regexes,
        extensionSettings.regular_expressions,
        extensions.regex_scripts,
        extensionSettings.regex_scripts,
        extensions.scripts,
        extensionSettings.scripts,
        // SPreset 格式
        (extensions.SPreset || {}).regex,
        (extensions.SPreset || {}).regexes,
        (extensionSettings.SPreset || {}).regex,
        (extensionSettings.SPreset || {}).regexes,
        // SPreset.RegexBinding 格式
        ((extensions.SPreset || {}).RegexBinding || {}).regexes,
        ((extensionSettings.SPreset || {}).RegexBinding || {}).regexes,
        raw.regex_scripts,
        raw.regexScripts,
    ];

    // prompts 中嵌入的 regex
    const prompts = raw.prompts;
    if (Array.isArray(prompts)) {
        for (const prompt of prompts) {
            if (prompt && typeof prompt === 'object' && 'regex' in prompt) {
                candidates.push(prompt.regex);
            }
        }
    }

    return extractRegexFromBlocks(candidates);
}

// ==================== 全局正则 ====================

/**
 * 从 settings.json 中提取全局正则
 * 复刻 Python 后端的 extract_global_regex_from_settings()
 * 
 * 这是提取全局正则的核心函数（重中之重）
 * 
 * @param {Object} raw - settings.json 原始数据
 * @returns {Array} 提取的全局正则列表
 */
function extractGlobalRegexFromSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return [];
    }

    const merged = [];
    const seen = new Set();

    function merge(items) {
        for (const item of items || []) {
            const key = `${item.pattern || ''}__${item.flags || ''}__${item.replace || ''}`;
            if (!item.pattern) {
                continue;
            }
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(item);
        }
    }

    // 先按 st-external-bridge 的思路，从可疑对象中抽取
    const baseBlocks = [
        raw,
        raw.extensions,
        raw.extension_settings,
        raw.client_settings,
        raw.clientSettings,
        raw.frontend,
    ];
    for (const block of baseBlocks) {
        if (block && typeof block === 'object') {
            merge(extractRegexFromPresetData(block));
        }
    }

    // 再补充 find/replace / regex_scripts 等常见全局来源
    const frontend = raw.frontend || {};
    const clientSettings = raw.client_settings || raw.clientSettings || {};
    const extensionSettings = raw.extension_settings || {};
    const extensions = raw.extensions || {};

    const extraBlocks = [
        raw.regex_scripts,
        raw.regexScripts,
        raw.find_replace,
        raw.findReplace,
        raw.find_and_replace,
        raw.findAndReplace,
        raw.global_regex,
        raw.globalRegex,
        frontend.regex_scripts,
        frontend.find_replace,
        frontend.find_and_replace,
        clientSettings.regex_scripts,
        clientSettings.find_replace,
        clientSettings.find_and_replace,
        extensionSettings.regex_scripts,
        extensionSettings.find_replace,
        extensionSettings.find_and_replace,
        extensionSettings.regex,
        extensionSettings.regexes,
        extensions.regex,
        extensions.regexes,
    ];
    for (const block of extraBlocks) {
        if (block === null || block === undefined) {
            continue;
        }
        merge(extractRegexFromBlocks([block]));
    }

    return merged;
}

// ==================== 文件读取 ====================

/**
 * 获取 settings.json 路径
 */
function findSettingsInDataRoot(dataDir) {
    if (!dataDir || !fs.existsSync(dataDir)) return null;
    try {
        const stat = fs.statSync(dataDir);
        if (!stat.isDirectory()) return null;
    } catch (e) {
        return null;
    }

    const defaultPath = path.join(dataDir, 'default-user', 'settings.json');
    if (fs.existsSync(defaultPath)) {
        return defaultPath;
    }

    try {
        const entries = fs.readdirSync(dataDir);
        for (const entry of entries) {
            const entryPath = path.join(dataDir, entry);
            try {
                if (!fs.statSync(entryPath).isDirectory()) continue;
                const candidate = path.join(entryPath, 'settings.json');
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            } catch (e) {
                continue;
            }
        }
    } catch (e) {
        return null;
    }

    return null;
}

function getSettingsPath() {
    const stDataDir = config.getDataRoot();
    if (!stDataDir) {
        return null;
    }

    const candidates = [];
    if (path.basename(stDataDir).toLowerCase() === 'data') {
        const fromDataRoot = findSettingsInDataRoot(stDataDir);
        if (fromDataRoot) {
            candidates.push(fromDataRoot);
        }
    }

    // 尝试多个可能的位置
    candidates.push(
        path.join(stDataDir, 'settings.json'),
        path.join(stDataDir, '..', 'settings.json'),
        path.join(config.getStRoot(), 'data', 'settings.json'),
    );

    const seen = new Set();
    for (const p of candidates) {
        if (!p || seen.has(p)) continue;
        seen.add(p);
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return null;
}

/**
 * 获取正则脚本目录
 */
function getRegexDir() {
    const stDataDir = config.getDataRoot();
    if (!stDataDir) {
        return null;
    }

    const candidates = [
        path.join(stDataDir, 'regex'),
        // SillyTavern 扩展目录格式
        path.join(stDataDir, 'scripts', 'extensions', 'regex'),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return null;
}

/**
 * 获取预设目录
 */
function getPresetsDir() {
    const stDataDir = config.getDataRoot();
    if (!stDataDir) {
        return null;
    }

    const candidates = [
        path.join(stDataDir, 'OpenAI Settings'),
        path.join(stDataDir, 'presets'),
        path.join(stDataDir, 'TextGen Settings'),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return null;
}

/**
 * 列出正则脚本文件
 * 复刻 Python 后端的 list_regex_scripts() / _list_regex_scripts_local()
 * 
 * @returns {Array} 正则脚本列表
 */
function listRegexScripts() {
    const regexDir = getRegexDir();
    if (!regexDir) {
        console.warn('[ST Manager] 未找到正则脚本目录');
        return [];
    }

    const scripts = [];

    try {
        const files = fs.readdirSync(regexDir);
        for (const filename of files) {
            if (!filename.toLowerCase().endsWith('.json')) {
                continue;
            }

            const filepath = path.join(regexDir, filename);
            try {
                const stat = fs.statSync(filepath);
                if (!stat.isFile()) {
                    continue;
                }

                const content = fs.readFileSync(filepath, 'utf-8');
                const data = JSON.parse(content);

                scripts.push({
                    id: filename.replace(/\.json$/i, ''),
                    filename: filename,
                    name: data.scriptName || data.name || filename.replace(/\.json$/i, ''),
                    enabled: !coerceBool(data.disabled),
                    find_regex: data.findRegex || '',
                    replace_string: data.replaceString || '',
                    filepath: filepath,
                    data: data,
                });
            } catch (e) {
                console.warn(`[ST Manager] 读取正则脚本 ${filename} 失败:`, e.message);
            }
        }
    } catch (e) {
        console.error(`[ST Manager] 扫描正则脚本目录失败:`, e.message);
    }

    console.log(`[ST Manager] 从本地读取 ${scripts.length} 个正则脚本`);
    return scripts;
}

/**
 * 获取全局正则
 * 复刻 Python 后端的 get_global_regex()
 * 
 * @param {string} settingsPath - 可选的 settings.json 路径
 * @returns {Object} { path, regexes, count, error? }
 */
function getGlobalRegex(settingsPath = null) {
    const p = settingsPath || getSettingsPath();
    if (!p) {
        return { path: null, regexes: [], count: 0 };
    }

    try {
        const content = fs.readFileSync(p, 'utf-8');
        const raw = JSON.parse(content);
        const regexes = extractGlobalRegexFromSettings(raw);
        return { path: p, regexes: regexes, count: regexes.length };
    } catch (e) {
        console.warn(`[ST Manager] 读取全局正则失败:`, e.message);
        return { path: p, regexes: [], count: 0, error: e.message };
    }
}

/**
 * 汇总全局正则 + 预设绑定正则
 * 复刻 Python 后端的 aggregate_regex()
 * 
 * @param {string} presetsPath - 可选的预设目录路径
 * @param {string} settingsPath - 可选的 settings.json 路径
 * @returns {Object} { global, presets, stats }
 */
function aggregateRegex(presetsPath = null, settingsPath = null) {
    const presetsDir = presetsPath || getPresetsDir();
    const presetSets = [];

    if (presetsDir && fs.existsSync(presetsDir)) {
        try {
            const files = fs.readdirSync(presetsDir);
            for (const filename of files) {
                if (!filename.toLowerCase().endsWith('.json')) {
                    continue;
                }
                const filePath = path.join(presetsDir, filename);
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const raw = JSON.parse(content);
                    const regexes = extractRegexFromPresetData(raw);
                    if (regexes.length > 0) {
                        const presetId = filename.replace(/\.json$/i, '');
                        presetSets.push({
                            presetId: presetId,
                            presetName: raw.name || raw.title || presetId,
                            regexes: regexes,
                            regexCount: regexes.length,
                        });
                    }
                } catch (e) {
                    console.warn(`[ST Manager] 读取预设正则失败 ${filename}:`, e.message);
                }
            }
        } catch (e) {
            console.error(`[ST Manager] 扫描预设目录失败:`, e.message);
        }
    }

    const globalRegex = getGlobalRegex(settingsPath);
    const presetRuleCount = presetSets.reduce((sum, p) => sum + (p.regexCount || 0), 0);

    return {
        global: globalRegex,
        presets: presetSets,
        stats: {
            presetGroups: presetSets.length,
            presetRules: presetRuleCount,
            total: (globalRegex.count || 0) + presetRuleCount,
        },
    };
}

// ==================== 导出 ====================

module.exports = {
    // 工具函数
    coerceBool,
    normalizeRegexItem,
    extractFromBlock,
    extractRegexFromBlocks,
    
    // 核心提取函数
    extractRegexFromPresetData,
    extractGlobalRegexFromSettings,
    
    // 文件读取
    getSettingsPath,
    getRegexDir,
    getPresetsDir,
    listRegexScripts,
    getGlobalRegex,
    aggregateRegex,
};
