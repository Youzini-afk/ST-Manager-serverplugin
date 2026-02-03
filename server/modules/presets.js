/**
 * 预设管理模块
 * 
 * 完整复刻 Python 后端的 presets.py 功能
 * 包括预设绑定正则的提取
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const regex = require('./regex');

/**
 * 预设类型定义
 */
const PRESET_TYPES = {
    OPENAI: 'openai',
    TEXTGEN: 'textgen',
    NOVEL: 'novel',
    KOBOLD: 'kobold',
};

/**
 * 预设目录映射
 */
const PRESET_DIRS = {
    openai: 'OpenAI Settings',
    textgen: 'TextGen Settings',
    novel: 'NovelAI Settings',
    kobold: 'KoboldAI Settings',
};

/**
 * 获取预设目录路径
 */
function getPresetDir(presetType = 'openai') {
    const dataRoot = config.getDataRoot();
    const dirName = PRESET_DIRS[presetType] || PRESET_DIRS.openai;
    return path.join(dataRoot, dirName);
}

/**
 * 解析预设文件，提取采样器参数
 */
function parsePresetContent(data) {
    const samplers = {};
    
    // OpenAI 类型参数
    if ('temperature' in data) samplers.temperature = data.temperature;
    if ('top_p' in data) samplers.top_p = data.top_p;
    if ('top_k' in data) samplers.top_k = data.top_k;
    if ('frequency_penalty' in data) samplers.frequency_penalty = data.frequency_penalty;
    if ('presence_penalty' in data) samplers.presence_penalty = data.presence_penalty;
    if ('max_tokens' in data) samplers.max_tokens = data.max_tokens;
    if ('max_length' in data) samplers.max_length = data.max_length;
    
    // TextGen 类型参数
    if ('rep_pen' in data) samplers.rep_pen = data.rep_pen;
    if ('rep_pen_range' in data) samplers.rep_pen_range = data.rep_pen_range;
    if ('typical_p' in data) samplers.typical_p = data.typical_p;
    if ('tfs' in data) samplers.tfs = data.tfs;
    if ('top_a' in data) samplers.top_a = data.top_a;
    if ('mirostat_mode' in data) samplers.mirostat_mode = data.mirostat_mode;
    if ('mirostat_tau' in data) samplers.mirostat_tau = data.mirostat_tau;
    if ('mirostat_eta' in data) samplers.mirostat_eta = data.mirostat_eta;
    
    // NovelAI 参数
    if ('cfg_scale' in data) samplers.cfg_scale = data.cfg_scale;
    if ('phrase_rep_pen' in data) samplers.phrase_rep_pen = data.phrase_rep_pen;
    
    return samplers;
}

/**
 * 检测预设类型
 */
function detectPresetType(data) {
    // 根据特征字段判断
    if ('oai_model' in data || 'chat_completion_source' in data) {
        return 'openai';
    }
    if ('api_type' in data && data.api_type === 'kobold') {
        return 'kobold';
    }
    if ('model' in data && typeof data.model === 'string' && data.model.includes('novel')) {
        return 'novel';
    }
    if ('preset' in data || 'api_type' in data) {
        return 'textgen';
    }
    
    return 'openai'; // 默认
}

/**
 * 列出预设
 * 
 * @param {Object} options - 选项
 * @returns {Object} 预设列表
 */
function listPresets(options = {}) {
    const { type = 'all', search = '', page = 1, pageSize = 50 } = options;
    
    const items = [];
    const typesToScan = type === 'all' ? Object.keys(PRESET_DIRS) : [type];
    
    for (const presetType of typesToScan) {
        const dir = getPresetDir(presetType);
        if (!fs.existsSync(dir)) continue;
        
        try {
            const files = fs.readdirSync(dir);
            
            for (const file of files) {
                if (!file.toLowerCase().endsWith('.json')) continue;
                
                const fullPath = path.join(dir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (!stat.isFile()) continue;
                    
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const data = JSON.parse(content);
                    
                    const name = file.replace('.json', '');
                    const samplers = parsePresetContent(data);
                    
                    // 提取预设绑定正则
                    const regexes = regex.extractRegexFromPresetData(data);
                    const extensions = data.extensions || {};
                    const regexScripts = extensions.regex_scripts || [];
                    const regexCount = Array.isArray(regexScripts) ? regexScripts.length : 0;
                    
                    const item = {
                        id: `${presetType}::${file}`,
                        name,
                        filename: file,
                        type: presetType,
                        path: fullPath,
                        mtime: stat.mtimeMs,
                        size: stat.size,
                        samplers,
                        // 常用字段快速访问
                        temperature: samplers.temperature,
                        maxTokens: samplers.max_tokens || samplers.max_length,
                        // 正则绑定信息
                        regexCount: regexCount,
                        extractedRegexCount: regexes.length,
                    };
                    
                    items.push(item);
                } catch (e) {
                    // 解析失败，跳过
                }
            }
        } catch (e) {
            console.error(`[ST Manager] 扫描预设目录失败 ${dir}:`, e);
        }
    }
    
    // 搜索过滤
    let filtered = items;
    if (search) {
        const searchLower = search.toLowerCase();
        filtered = items.filter(item => {
            const haystack = `${item.name} ${item.filename} ${item.type}`.toLowerCase();
            return haystack.includes(searchLower);
        });
    }
    
    // 按修改时间倒序
    filtered.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    
    // 分页
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    
    return {
        success: true,
        items: filtered.slice(start, end),
        total,
        page,
        pageSize,
    };
}

/**
 * 获取单个预设详情
 */
function getPreset(presetId) {
    if (!presetId) return null;
    
    const parts = presetId.split('::');
    if (parts.length < 2) return null;
    
    const presetType = parts[0];
    const filename = parts.slice(1).join('::');
    const dir = getPresetDir(presetType);
    const fullPath = path.join(dir, filename);
    
    if (!fs.existsSync(fullPath)) return null;
    
    try {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const data = JSON.parse(content);
        
        return {
            id: presetId,
            filename,
            type: presetType,
            path: fullPath,
            mtime: stat.mtimeMs,
            size: stat.size,
            data,
            samplers: parsePresetContent(data),
            // 正则绑定
            regexes: regex.extractRegexFromPresetData(data),
            regexScripts: (data.extensions || {}).regex_scripts || [],
        };
    } catch (e) {
        console.error('[ST Manager] 获取预设详情失败:', e);
        return null;
    }
}

/**
 * 保存预设
 */
function savePreset(presetId, data) {
    if (!presetId || !data) {
        return { success: false, error: '缺少必要参数' };
    }
    
    const preset = getPreset(presetId);
    if (!preset) {
        return { success: false, error: '预设不存在' };
    }
    
    try {
        fs.writeFileSync(preset.path, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 保存预设失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 删除预设
 */
function deletePreset(presetId) {
    if (!presetId) {
        return { success: false, error: '缺少预设 ID' };
    }
    
    const preset = getPreset(presetId);
    if (!preset) {
        return { success: false, error: '预设不存在' };
    }
    
    try {
        fs.unlinkSync(preset.path);
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 删除预设失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 上传预设
 */
function uploadPreset(fileContent, filename, targetType = null) {
    if (!fileContent || !filename) {
        return { success: false, error: '缺少文件内容或文件名' };
    }
    
    if (!filename.toLowerCase().endsWith('.json')) {
        return { success: false, error: '仅支持 JSON 文件' };
    }
    
    try {
        const content = fileContent.toString('utf-8');
        const data = JSON.parse(content);
        
        // 检测或使用指定的类型
        const presetType = targetType || detectPresetType(data);
        const dir = getPresetDir(presetType);
        
        // 确保目录存在
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // 安全化文件名
        const safeName = filename.replace(/[\\/*?:"<>|]/g, '_');
        let savePath = path.join(dir, safeName);
        
        // 防重名
        const namePart = path.basename(safeName, '.json');
        let counter = 1;
        while (fs.existsSync(savePath)) {
            savePath = path.join(dir, `${namePart}_${counter}.json`);
            counter++;
        }
        
        fs.writeFileSync(savePath, content, 'utf-8');
        
        return {
            success: true,
            path: savePath,
            filename: path.basename(savePath),
            type: presetType,
        };
    } catch (e) {
        console.error('[ST Manager] 上传预设失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 获取预设统计
 */
function getStats() {
    const result = listPresets({ pageSize: 999999 });
    const items = result.items || [];
    
    const byType = {};
    for (const type of Object.keys(PRESET_DIRS)) {
        byType[type] = items.filter(i => i.type === type).length;
    }
    
    // 统计正则绑定
    const totalRegexCount = items.reduce((sum, i) => sum + (i.regexCount || 0), 0);
    const presetsWithRegex = items.filter(i => (i.regexCount || 0) > 0).length;
    
    return {
        total: items.length,
        byType,
        regex: {
            totalRules: totalRegexCount,
            presetsWithRegex,
        },
    };
}

/**
 * 复制预设
 */
function duplicatePreset(presetId, newName) {
    if (!presetId) {
        return { success: false, error: '缺少预设 ID' };
    }
    
    const preset = getPreset(presetId);
    if (!preset) {
        return { success: false, error: '预设不存在' };
    }
    
    const dir = path.dirname(preset.path);
    const safeName = (newName || `${preset.filename.replace('.json', '')}_copy`).replace(/[\\/*?:"<>|]/g, '_');
    let newPath = path.join(dir, `${safeName}.json`);
    
    // 防重名
    let counter = 1;
    while (fs.existsSync(newPath)) {
        newPath = path.join(dir, `${safeName}_${counter}.json`);
        counter++;
    }
    
    try {
        fs.copyFileSync(preset.path, newPath);
        
        const newId = `${preset.type}::${path.basename(newPath)}`;
        return { success: true, newId, path: newPath };
    } catch (e) {
        console.error('[ST Manager] 复制预设失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 获取预设绑定的正则脚本
 */
function getPresetRegexes(presetId) {
    const preset = getPreset(presetId);
    if (!preset) {
        return { success: false, error: '预设不存在' };
    }
    
    return {
        success: true,
        presetId,
        presetName: preset.filename.replace('.json', ''),
        regexes: preset.regexes || [],
        regexScripts: preset.regexScripts || [],
        count: (preset.regexes || []).length,
    };
}

module.exports = {
    listPresets,
    getPreset,
    savePreset,
    deletePreset,
    uploadPreset,
    duplicatePreset,
    getStats,
    getPresetRegexes,
    PRESET_TYPES,
    PRESET_DIRS,
};
