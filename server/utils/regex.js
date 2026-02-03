/**
 * 正则脚本工具模块
 * 
 * 移植自 Python 后端的 core/utils/regex.py
 * 用于标准化、提取和导出全局正则脚本
 */

const fs = require('fs');
const path = require('path');

/**
 * 将布尔值或类布尔值转换为真正的布尔值
 */
function coerceBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'enabled'].includes(lowered)) return true;
        if (['false', '0', 'no', 'off', 'disabled', ''].includes(lowered)) return false;
        return true;
    }
    return Boolean(value);
}

/**
 * 将各种格式的正则条目标准化为统一结构
 * @param {any} item - 原始正则条目
 * @param {string} nameHint - 备用名称
 * @returns {Object|null} 标准化后的正则对象，无效则返回 null
 */
function normalizeRegexItem(item, nameHint = null) {
    if (item === null || item === undefined) return null;

    // 字符串格式
    if (typeof item === 'string') {
        const pattern = item.trim();
        if (!pattern) return null;
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

    if (typeof item !== 'object') return null;

    // 提取 pattern (支持多种字段名)
    const pattern =
        item.pattern ||
        item.regex ||
        item.expression ||
        item.match ||
        item.findRegex ||
        item.find ||
        item.regexPattern ||
        '';

    if (!pattern) return null;

    const name = item.name || item.label || item.scriptName || nameHint || 'regex';
    const flags = item.flags || item.modifiers || '';
    const replace = item.replace || item.replacement || item.replaceString || '';
    const description = item.description || item.comment || '';

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
 * 从数据块中提取正则规则
 */
function extractFromBlock(block) {
    const results = [];
    if (!block) return results;

    // 列表格式
    if (Array.isArray(block)) {
        for (const item of block) {
            const normalized = normalizeRegexItem(item);
            if (normalized) results.push(normalized);
        }
        return results;
    }

    // 字符串格式
    if (typeof block === 'string') {
        const normalized = normalizeRegexItem(block);
        if (normalized) results.push(normalized);
        return results;
    }

    if (typeof block !== 'object') return results;

    // 若本身就是规则对象
    const normalized = normalizeRegexItem(block);
    if (normalized) {
        results.push(normalized);
        return results;
    }

    // RegexBinding / 扩展格式：{ regexes: [...] }
    if (Array.isArray(block.regexes)) {
        for (let idx = 0; idx < block.regexes.length; idx++) {
            const item = block.regexes[idx];
            const nameHint = block.name || `regex_${idx}`;
            const norm = normalizeRegexItem(item, nameHint);
            if (norm) results.push(norm);
        }
        return results;
    }

    // 普通字典：遍历各 key
    for (const [key, value] of Object.entries(block)) {
        if (value === null || value === undefined) continue;

        if (typeof value === 'string') {
            const norm = normalizeRegexItem(value, key);
            if (norm) results.push(norm);
            continue;
        }

        if (typeof value === 'object' && !Array.isArray(value)) {
            // RegexBinding 格式
            if (Array.isArray(value.regexes)) {
                for (let idx = 0; idx < value.regexes.length; idx++) {
                    const item = value.regexes[idx];
                    const nameHint = value.name || `${key}_${idx}`;
                    const norm = normalizeRegexItem(item, nameHint);
                    if (norm) results.push(norm);
                }
                continue;
            }

            const norm = normalizeRegexItem(value, key);
            if (norm) {
                results.push(norm);
                continue;
            }

            // 脚本格式
            if (value.script) {
                const pattern = value.find || value.pattern || '';
                if (pattern) {
                    results.push({
                        name: key,
                        description: (value.script || '').substring(0, 100) || 'Script based regex',
                        pattern,
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
            for (const item of value) {
                const norm = normalizeRegexItem(item, key);
                if (norm) results.push(norm);
            }
        }
    }

    return results;
}

/**
 * 从多个数据块提取正则并去重
 */
function extractRegexFromBlocks(blocks) {
    const merged = [];
    const seen = new Set();

    for (const block of blocks) {
        for (const item of extractFromBlock(block)) {
            const key = `${item.pattern || ''}__${item.flags || ''}__${item.replace || ''}`;
            if (!item.pattern) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(item);
        }
    }

    return merged;
}

/**
 * 从 settings.json 提取全局正则
 * @param {Object} raw - settings.json 的原始内容
 * @returns {Array} 提取到的正则规则列表
 */
function extractGlobalRegexFromSettings(raw) {
    if (typeof raw !== 'object' || raw === null) return [];

    const merged = [];
    const seen = new Set();

    function merge(items) {
        for (const item of items || []) {
            const key = `${item.pattern || ''}__${item.flags || ''}__${item.replace || ''}`;
            if (!item.pattern) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(item);
        }
    }

    // 从常见的对象路径提取
    const baseBlocks = [
        raw,
        raw.extensions,
        raw.extension_settings,
        raw.client_settings,
        raw.clientSettings,
        raw.frontend,
    ].filter(Boolean);

    for (const block of baseBlocks) {
        if (typeof block === 'object') {
            merge(extractRegexFromPresetData(block));
        }
    }

    // 补充其他常见来源
    const extraBlocks = [
        raw.regex_scripts,
        raw.regexScripts,
        raw.find_replace,
        raw.findReplace,
        raw.find_and_replace,
        raw.findAndReplace,
        raw.global_regex,
        raw.globalRegex,
        (raw.frontend || {}).regex_scripts,
        (raw.frontend || {}).find_replace,
        (raw.frontend || {}).find_and_replace,
        (raw.client_settings || {}).regex_scripts,
        (raw.client_settings || {}).find_replace,
        (raw.client_settings || {}).find_and_replace,
        (raw.clientSettings || {}).regex_scripts,
        (raw.clientSettings || {}).find_replace,
        (raw.clientSettings || {}).find_and_replace,
        (raw.extension_settings || {}).regex_scripts,
        (raw.extension_settings || {}).find_replace,
        (raw.extension_settings || {}).find_and_replace,
        (raw.extension_settings || {}).regex,
        (raw.extension_settings || {}).regexes,
        (raw.extensions || {}).regex,
        (raw.extensions || {}).regexes,
    ].filter(Boolean);

    for (const block of extraBlocks) {
        merge(extractRegexFromBlocks([block]));
    }

    return merged;
}

/**
 * 从预设数据提取正则
 */
function extractRegexFromPresetData(raw) {
    if (typeof raw !== 'object' || raw === null) return [];

    const candidates = [
        raw.regex,
        raw.regexes,
        raw.regular_expressions,
        (raw.extensions || {}).regex,
        (raw.extensions || {}).regexes,
        (raw.extensions || {}).regular_expressions,
        (raw.extension_settings || {}).regex,
        (raw.extension_settings || {}).regexes,
        (raw.extension_settings || {}).regular_expressions,
        (raw.extensions || {}).regex_scripts,
        (raw.extension_settings || {}).regex_scripts,
        (raw.extensions || {}).scripts,
        (raw.extension_settings || {}).scripts,
        ((raw.extensions || {}).SPreset || {}).regex,
        ((raw.extensions || {}).SPreset || {}).regexes,
        ((raw.extension_settings || {}).SPreset || {}).regex,
        ((raw.extension_settings || {}).SPreset || {}).regexes,
        (((raw.extensions || {}).SPreset || {}).RegexBinding || {}).regexes,
        (((raw.extension_settings || {}).SPreset || {}).RegexBinding || {}).regexes,
        raw.regex_scripts,
        raw.regexScripts,
    ].filter(Boolean);

    // prompts 中嵌入的 regex
    const prompts = raw.prompts;
    if (Array.isArray(prompts)) {
        for (const prompt of prompts) {
            if (typeof prompt === 'object' && prompt && 'regex' in prompt) {
                candidates.push(prompt.regex);
            }
        }
    }

    return extractRegexFromBlocks(candidates);
}

/**
 * 安全的文件名处理
 */
function sanitizeFilename(name) {
    return String(name || '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 100);
}

/**
 * 导出全局正则到目标目录
 * @param {string} settingsPath - settings.json 路径
 * @param {string} targetDir - 目标目录
 * @returns {Object} { success, failed, files }
 */
function exportGlobalRegex(settingsPath, targetDir) {
    const result = { success: 0, failed: 0, files: [] };

    if (!settingsPath || !fs.existsSync(settingsPath)) {
        return result;
    }

    let raw;
    try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        raw = JSON.parse(content);
    } catch (e) {
        console.warn('[ST Manager] 读取 settings.json 失败:', e.message);
        return result;
    }

    // 提取正则条目
    const regexItems = [];
    const rawList = (raw.extension_settings || {}).regex;

    if (Array.isArray(rawList) && rawList.length > 0) {
        // 直接使用原始格式
        for (const item of rawList) {
            if (typeof item === 'object' && item && (item.findRegex || item.scriptName)) {
                regexItems.push(item);
            }
        }
    } else {
        // 使用通用提取
        const extracted = extractGlobalRegexFromSettings(raw);
        for (let idx = 0; idx < extracted.length; idx++) {
            const item = extracted[idx];
            regexItems.push({
                scriptName: item.name || `Global Regex ${idx + 1}`,
                findRegex: item.pattern || '',
                replaceString: item.replace || '',
                disabled: !item.enabled,
                placement: Array.isArray(item.scope) ? item.scope : [],
                flags: item.flags || ''
            });
        }
    }

    if (regexItems.length === 0) {
        return result;
    }

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    // 读取已存在的导出文件，用于去重
    const existingFilenames = new Set();
    const existingExports = new Map();

    try {
        const files = fs.readdirSync(targetDir);
        for (const f of files) {
            if (!f.startsWith('global__') || !f.toLowerCase().endsWith('.json')) continue;

            existingFilenames.add(f);
            const filePath = path.join(targetDir, f);

            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (typeof data !== 'object' || data.__source !== 'settings.json') continue;

                let name = data.scriptName || data.name;
                if (!name) {
                    let base = path.basename(f, '.json');
                    if (base.startsWith('global__')) base = base.substring(8);
                    name = base.replace(/^[_\- ]+/, '') || f;
                }
                name = String(name).trim();

                const signature = JSON.stringify(data, Object.keys(data).sort());
                if (!existingExports.has(name)) existingExports.set(name, []);
                existingExports.get(name).push({
                    path: filePath,
                    filename: f,
                    signature
                });
            } catch (e) {
                continue;
            }
        }
    } catch (e) {
        // 忽略
    }

    // 生成唯一文件名
    function uniqueFilename(baseName) {
        const safeName = sanitizeFilename(baseName) || 'global';
        let candidate = `global__${safeName}.json`;

        if (!existingFilenames.has(candidate) && !fs.existsSync(path.join(targetDir, candidate))) {
            existingFilenames.add(candidate);
            return candidate;
        }

        let idx = 1;
        while (true) {
            candidate = `global__${safeName}__${idx}.json`;
            if (!existingFilenames.has(candidate) && !fs.existsSync(path.join(targetDir, candidate))) {
                existingFilenames.add(candidate);
                return candidate;
            }
            idx++;
        }
    }

    // 导出每个正则条目
    for (let idx = 0; idx < regexItems.length; idx++) {
        try {
            const item = regexItems[idx];
            const name = item.scriptName || item.name || `global_${idx + 1}`;

            const payload = { ...item };
            if (!payload.scriptName) payload.scriptName = name;
            payload.__source = 'settings.json';

            const signature = JSON.stringify(payload, Object.keys(payload).sort());

            // 检查是否已存在相同内容的文件
            let filePath = null;
            const entries = existingExports.get(String(name).trim()) || [];
            for (const entry of entries) {
                if (entry.signature === signature) {
                    filePath = entry.path;
                    break;
                }
            }

            if (!filePath) {
                const filename = uniqueFilename(name);
                filePath = path.join(targetDir, filename);
            }

            fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
            result.success++;
            result.files.push(path.basename(filePath));
        } catch (e) {
            console.warn('[ST Manager] 写入全局正则文件失败:', e.message);
            result.failed++;
        }
    }

    return result;
}

module.exports = {
    coerceBool,
    normalizeRegexItem,
    extractFromBlock,
    extractRegexFromBlocks,
    extractGlobalRegexFromSettings,
    extractRegexFromPresetData,
    exportGlobalRegex,
    sanitizeFilename,
};
