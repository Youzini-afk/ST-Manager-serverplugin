/**
 * 配置模块
 * 
 * 完整复刻 Python 后端的配置逻辑
 * - 支持 SillyTavern 的目录结构
 * - 支持资源目录 (card_assets) 用于扫描资源绑定的 regex/scripts/lorebooks
 */

const fs = require('fs');
const path = require('path');

// ============ 全局状态 ============
let stRoot = '';           // SillyTavern 根目录
let dataRoot = '';         // 用户数据目录 (data/default-user)
let configPath = '';       // 插件配置文件路径
let pluginConfig = {};     // 插件配置对象
let pluginDataDir = '';    // 插件数据目录

/**
 * 初始化配置
 */
function init() {
    // SillyTavern 根目录
    stRoot = process.cwd();
    
    // 酒馆用户数据目录
    dataRoot = path.join(stRoot, 'data', 'default-user');
    
    // 插件数据目录
    pluginDataDir = path.join(stRoot, 'data', 'plugins', 'st-manager');
    if (!fs.existsSync(pluginDataDir)) {
        fs.mkdirSync(pluginDataDir, { recursive: true });
    }
    
    configPath = path.join(pluginDataDir, 'config.json');
    
    // 加载配置
    if (fs.existsSync(configPath)) {
        try {
            pluginConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (e) {
            console.error('[ST Manager] 加载配置失败:', e);
            pluginConfig = {};
        }
    }
    
    console.log('[ST Manager] 配置初始化完成');
    console.log('[ST Manager] SillyTavern 根目录:', stRoot);
    console.log('[ST Manager] 用户数据目录:', dataRoot);
}

/**
 * 获取 SillyTavern 根目录
 */
function getStRoot() {
    return stRoot;
}

/**
 * 获取用户数据根目录
 */
function getDataRoot() {
    return dataRoot;
}

/**
 * 获取插件数据目录
 */
function getPluginDataDir() {
    return pluginDataDir;
}

/**
 * 获取资源目录映射（相对于 dataRoot）
 * 
 * 这与 SillyTavern 的实际目录结构一致：
 * - characters: 角色卡 PNG/JSON 文件
 * - worlds: 世界书 JSON 文件  
 * - OpenAI Settings: 预设文件
 * - scripts/extensions/regex: 全局正则脚本
 * - scripts/extensions/tavern_helper: 全局 ST 脚本
 * - scripts/extensions/quick-replies: 快速回复
 */
function getResourceDirs() {
    return {
        characters: 'characters',
        worldbooks: 'worlds',
        presets: 'OpenAI Settings',
        // 全局扩展目录
        regexes: path.join('scripts', 'extensions', 'regex'),
        scripts: path.join('scripts', 'extensions', 'tavern_helper'),
        quickreplies: path.join('scripts', 'extensions', 'quick-replies'),
    };
}

/**
 * 获取资源绑定目录（card_assets）
 * 
 * 这是 Python 后端的 resources_dir 概念
 * 每个角色可以有自己的资源文件夹，内含:
 *   - lorebooks/    (资源世界书)
 *   - extensions/regex/    (资源正则脚本)
 *   - extensions/tavern_helper/    (资源 ST 脚本)
 *   - extensions/quick-replies/    (资源快速回复)
 */
function getResourcesRoot() {
    // 优先使用配置的路径，否则使用默认路径
    const customPath = pluginConfig.resourcesDir;
    if (customPath && fs.existsSync(customPath)) {
        return customPath;
    }
    // SillyTavern 默认的 card_assets 目录
    return path.join(stRoot, 'data', 'default-user', 'card_assets');
}

/**
 * 获取资源子目录名称映射
 * 
 * 用于在 card_assets/<角色文件夹>/ 下查找对应资源
 */
function getResourceSubDirs() {
    return {
        lorebooks: 'lorebooks',
        regexes: path.join('extensions', 'regex'),
        scripts: path.join('extensions', 'tavern_helper'),
        quickreplies: path.join('extensions', 'quick-replies'),
    };
}

/**
 * 获取备份目录
 */
function getBackupRoot() {
    return pluginConfig.backupPath || path.join(stRoot, 'data', 'backups', 'st-manager');
}

/**
 * 获取规则集目录
 */
function getRulesDir() {
    const dir = path.join(pluginDataDir, 'automation');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * 获取 UI 数据文件路径
 * 用于存储卡片与资源文件夹的绑定关系
 */
function getUiDataPath() {
    return path.join(pluginDataDir, 'ui_data.json');
}

/**
 * 加载 UI 数据
 */
function loadUiData() {
    const uiPath = getUiDataPath();
    if (fs.existsSync(uiPath)) {
        try {
            return JSON.parse(fs.readFileSync(uiPath, 'utf-8'));
        } catch (e) {
            console.error('[ST Manager] 加载 UI 数据失败:', e);
        }
    }
    return {};
}

/**
 * 保存 UI 数据
 */
function saveUiData(data) {
    const uiPath = getUiDataPath();
    try {
        fs.writeFileSync(uiPath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error('[ST Manager] 保存 UI 数据失败:', e);
        return false;
    }
}

/**
 * 获取配置
 */
function get() {
    return {
        stRoot,
        dataRoot,
        resourcesRoot: getResourcesRoot(),
        backupPath: getBackupRoot(),
        backup: pluginConfig.backup || {
            enabled: false,
            schedule: 'disabled',
            hour: 3,
            retentionDays: 30,
        },
        autoSync: pluginConfig.autoSync !== false,
        trackChanges: pluginConfig.trackChanges !== false,
    };
}

/**
 * 更新配置
 */
function update(newConfig) {
    Object.assign(pluginConfig, newConfig);
    
    try {
        fs.writeFileSync(configPath, JSON.stringify(pluginConfig, null, 2), 'utf-8');
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 保存配置失败:', e);
        return { success: false, message: e.message };
    }
}

/**
 * 确保目录存在
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * 获取完整路径
 */
function getFullPath(relativePath, base = dataRoot) {
    if (path.isAbsolute(relativePath)) {
        return relativePath;
    }
    return path.join(base, relativePath);
}

module.exports = {
    init,
    getStRoot,
    getDataRoot,
    getPluginDataDir,
    getResourceDirs,
    getResourcesRoot,
    getResourceSubDirs,
    getBackupRoot,
    getRulesDir,
    getUiDataPath,
    loadUiData,
    saveUiData,
    get,
    update,
    ensureDir,
    getFullPath,
};
