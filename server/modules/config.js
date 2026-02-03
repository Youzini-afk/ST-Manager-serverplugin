/**
 * 配置模块
 */

const fs = require('fs');
const path = require('path');

// 数据目录
let dataRoot = '';
let configPath = '';
let pluginConfig = {};

/**
 * 初始化配置
 */
function init() {
    // 酒馆数据目录
    dataRoot = path.join(process.cwd(), 'data', 'default-user');
    
    // 插件配置目录
    const pluginDataDir = path.join(process.cwd(), 'data', 'plugins', 'st-manager');
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
}

/**
 * 获取数据根目录
 */
function getDataRoot() {
    return dataRoot;
}

/**
 * 获取资源目录映射
 */
function getResourceDirs() {
    return {
        characters: 'characters',
        worldbooks: 'worlds',
        presets: 'OpenAI Settings',
        regexes: path.join('scripts', 'extensions', 'regex'),
        scripts: path.join('scripts', 'extensions', 'tavern_helper'),
        quickreplies: path.join('scripts', 'extensions', 'quick-replies'),
    };
}

/**
 * 获取备份目录
 */
function getBackupRoot() {
    return pluginConfig.backupPath || path.join(process.cwd(), 'data', 'backups');
}

/**
 * 获取规则集目录
 */
function getRulesDir() {
    return path.join(process.cwd(), 'data', 'plugins', 'st-manager', 'automation');
}

/**
 * 获取配置
 */
function get() {
    return {
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

module.exports = {
    init,
    getDataRoot,
    getResourceDirs,
    getBackupRoot,
    getRulesDir,
    get,
    update,
};
