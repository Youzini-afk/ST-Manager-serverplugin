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
let pluginRoot = '';       // 插件根目录
let legacyPluginDataDir = ''; // 旧插件数据目录 (data/plugins/st-manager)

// ==================== 路径探测 ====================

function _isDir(p) {
    try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch (e) {
        return false;
    }
}

function _looksLikeUserDir(p) {
    if (!_isDir(p)) return false;
    const markers = [
        'settings.json',
        'characters',
        'worlds',
        'OpenAI Settings',
        'presets',
        'regex',
        'QuickReplies',
        'scripts',
    ];
    for (const name of markers) {
        if (fs.existsSync(path.join(p, name))) {
            return true;
        }
    }
    return false;
}

function findUserDirFromDataDir(dataDir) {
    if (!_isDir(dataDir)) return null;

    const defaultUser = path.join(dataDir, 'default-user');
    if (_isDir(defaultUser)) {
        return defaultUser;
    }

    try {
        const entries = fs.readdirSync(dataDir);
        const candidates = [];
        for (const entry of entries) {
            const entryPath = path.join(dataDir, entry);
            if (!_isDir(entryPath)) continue;

            let score = 0;
            if (fs.existsSync(path.join(entryPath, 'settings.json'))) {
                score += 5;
            }
            const subs = ['characters', 'worlds', 'OpenAI Settings', 'presets', 'regex', 'QuickReplies', 'scripts'];
            for (const sub of subs) {
                if (fs.existsSync(path.join(entryPath, sub))) {
                    score += 1;
                }
            }
            if (score > 0) {
                candidates.push({ score, path: entryPath });
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.path.localeCompare(b.path);
            });
            return candidates[0].path;
        }
    } catch (e) {
        return null;
    }

    return null;
}

function resolveUserDataDir(inputPath) {
    if (!inputPath) return null;

    let normalized = path.normalize(inputPath);
    if (!fs.existsSync(normalized)) return null;

    try {
        if (fs.statSync(normalized).isFile()) {
            normalized = path.dirname(normalized);
        }
    } catch (e) {
        return null;
    }

    const parts = normalized.split(path.sep);
    const idx = parts.findIndex(p => p.toLowerCase() === 'default-user');
    if (idx >= 0) {
        return parts.slice(0, idx + 1).join(path.sep);
    }

    if (_looksLikeUserDir(normalized)) {
        return normalized;
    }

    const base = path.basename(normalized).toLowerCase();
    if (base === 'data') {
        const found = findUserDirFromDataDir(normalized);
        return found || path.join(normalized, 'default-user');
    }

    const dataDir = path.join(normalized, 'data');
    if (_isDir(dataDir)) {
        const found = findUserDirFromDataDir(dataDir);
        return found || path.join(dataDir, 'default-user');
    }

    return null;
}

function recomputeDataRoot() {
    let resolved = null;
    if (pluginConfig && pluginConfig.st_data_dir) {
        resolved = resolveUserDataDir(pluginConfig.st_data_dir);
    }
    if (!resolved) {
        const fallback = path.join(stRoot, 'data', 'default-user');
        resolved = resolveUserDataDir(fallback) || fallback;
    }
    dataRoot = resolved;
}

function getPluginRoot() {
    return pluginRoot;
}

function getStorageRoot() {
    return pluginDataDir;
}

function getSystemDir() {
    return path.join(pluginDataDir, 'system');
}

function getTempDir() {
    return path.join(pluginDataDir, 'temp');
}

function getDbDir() {
    return path.join(getSystemDir(), 'db');
}

function getLegacyUiDataPath() {
    if (!legacyPluginDataDir) return '';
    return path.join(legacyPluginDataDir, 'ui_data.json');
}

function migrateLegacyRulesIfNeeded(targetDir) {
    if (!legacyPluginDataDir) return;
    const legacyRulesDir = path.join(legacyPluginDataDir, 'automation');
    if (!fs.existsSync(legacyRulesDir)) return;

    try {
        const hasNewFiles = fs.existsSync(targetDir) && fs.readdirSync(targetDir).some(f => f.endsWith('.json'));
        if (hasNewFiles) return;
    } catch (e) {
        return;
    }

    try {
        const files = fs.readdirSync(legacyRulesDir);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const src = path.join(legacyRulesDir, file);
            const dest = path.join(targetDir, file);
            if (!fs.existsSync(dest)) {
                fs.copyFileSync(src, dest);
            }
        }
    } catch (e) {
        console.error('[ST Manager] 迁移旧规则集失败:', e);
    }
}

function ensureStorageLayout() {
    ensureDir(pluginDataDir);
    ensureDir(getSystemDir());
    ensureDir(path.join(getSystemDir(), 'automation'));
    ensureDir(getDbDir());
    ensureDir(path.join(getSystemDir(), 'thumbnails'));
    ensureDir(path.join(getSystemDir(), 'trash'));
    ensureDir(getTempDir());
}

/**
 * 初始化配置
 */
function init() {
    // 检测 SillyTavern 根目录
    // 当作为插件运行时，需要向上查找 SillyTavern 根目录
    let currentDir = process.cwd();
    
    // 如果当前目录在 plugins/ 下，向上查找
    if (currentDir.includes(path.sep + 'plugins' + path.sep)) {
        // 从当前目录向上查找，直到找到包含 server.js 的目录
        while (currentDir !== path.dirname(currentDir)) {
            if (fs.existsSync(path.join(currentDir, 'server.js'))) {
                break;
            }
            currentDir = path.dirname(currentDir);
        }
    }
    
    stRoot = currentDir;
    // 默认酒馆用户数据目录（后续会根据配置再修正）
    dataRoot = path.join(stRoot, 'data', 'default-user');
    
    // 插件数据目录
    pluginRoot = path.resolve(__dirname, '..', '..');
    pluginDataDir = path.join(pluginRoot, 'data');
    legacyPluginDataDir = path.join(stRoot, 'data', 'plugins', 'st-manager');
    ensureStorageLayout();
    
    configPath = path.join(pluginDataDir, 'config.json');
    
    // 加载配置
    if (fs.existsSync(configPath)) {
        try {
            pluginConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (e) {
            console.error('[ST Manager] 加载配置失败:', e);
            pluginConfig = {};
        }
    } else if (legacyPluginDataDir && fs.existsSync(path.join(legacyPluginDataDir, 'config.json'))) {
        try {
            const legacyPath = path.join(legacyPluginDataDir, 'config.json');
            pluginConfig = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
            // 迁移到新位置
            fs.writeFileSync(configPath, JSON.stringify(pluginConfig, null, 2), 'utf-8');
        } catch (e) {
            console.error('[ST Manager] 迁移旧配置失败:', e);
            pluginConfig = {};
        }
    }

    // 根据配置修正用户数据目录
    recomputeDataRoot();
    
    console.log('[ST Manager] 配置初始化完成');
    console.log('[ST Manager] SillyTavern 根目录:', stRoot);
    console.log('[ST Manager] 用户数据目录:', dataRoot);
    
    // 检查角色目录是否存在
    const charsDir = path.join(dataRoot, 'characters');
    if (fs.existsSync(charsDir)) {
        const files = fs.readdirSync(charsDir);
        const pngCount = files.filter(f => f.endsWith('.png')).length;
        console.log('[ST Manager] 检测到角色卡数量:', pngCount);
    } else {
        console.warn('[ST Manager] 警告：角色目录不存在:', charsDir);
    }
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
    // SillyTavern 默认的 card_assets 目录（跟随当前用户数据目录）
    const base = dataRoot || path.join(stRoot, 'data', 'default-user');
    return path.join(base, 'card_assets');
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
    const dir = path.join(getSystemDir(), 'automation');
    ensureDir(dir);
    migrateLegacyRulesIfNeeded(dir);
    return dir;
}

/**
 * 获取 UI 数据文件路径
 * 用于存储卡片与资源文件夹的绑定关系
 */
function getUiDataPath() {
    return path.join(getDbDir(), 'ui_data.json');
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
    } else {
        const legacyPath = getLegacyUiDataPath();
        if (legacyPath && fs.existsSync(legacyPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
                saveUiData(data);
                return data;
            } catch (e) {
                console.error('[ST Manager] 迁移旧 UI 数据失败:', e);
            }
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
        ensureDir(path.dirname(uiPath));
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
        pluginRoot,
        storageRoot: pluginDataDir,
        st_data_dir: pluginConfig.st_data_dir || '',
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
        recomputeDataRoot();
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
    getPluginRoot,
    getPluginDataDir,
    getStorageRoot,
    getSystemDir,
    getTempDir,
    getResourceDirs,
    getResourcesRoot,
    getResourceSubDirs,
    getBackupRoot,
    getRulesDir,
    getUiDataPath,
    loadUiData,
    saveUiData,
    get,
    getConfig: get,  // 别名，兼容 API 调用
    update,
    saveConfig: update,  // 别名，兼容 API 调用
    ensureDir,
    getFullPath,
    resolveUserDataDir,
    findUserDirFromDataDir,
};
