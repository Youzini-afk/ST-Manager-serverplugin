/**
 * ST Client - SillyTavern 资源读取服务
 * 
 * 完整复刻 Python 后端的 st_client.py
 * 
 * 支持两种读取模式：
 * 1. 本地文件系统读取 - 直接读取 SillyTavern 的数据目录
 * 2. API 读取 - 通过 st-api-wrapper 接口读取（需要 SillyTavern 运行）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// SillyTavern 常见安装路径候选
const ST_PATH_CANDIDATES = [
    // Windows 常见路径
    'D:\\SillyTavern',
    'E:\\SillyTavern',
    'C:\\SillyTavern',
    'D:\\Programs\\SillyTavern',
    'E:\\Programs\\SillyTavern',
    // 用户目录
    path.join(os.homedir(), 'SillyTavern'),
    // Linux/macOS 常见路径
    '/opt/SillyTavern',
    path.join(os.homedir(), 'SillyTavern'),
];

// SillyTavern 数据目录结构 (相对于用户数据目录)
const ST_DATA_STRUCTURE = {
    characters: 'characters',
    worlds: 'worlds',
    presets: 'OpenAI Settings',
    regex: 'regex',
    scripts: 'scripts',
    quick_replies: 'QuickReplies',
    settings: 'settings.json',
};

class STClient {
    /**
     * 初始化 ST 客户端
     * @param {Object} options - 配置选项
     * @param {string} options.stDataDir - SillyTavern 安装目录路径
     * @param {string} options.stUrl - SillyTavern API URL
     */
    constructor(options = {}) {
        this.stDataDir = options.stDataDir || '';
        this.stUrl = options.stUrl || 'http://127.0.0.1:8000';
        this.stUsername = options.stUsername || '';
        this.stPassword = options.stPassword || '';
        this.timeout = 30000;
        this.cache = {};
        this.cacheTtl = 60000; // 60秒缓存
    }

    // ==================== 路径探测 ====================

    /**
     * 自动探测 SillyTavern 安装路径
     * @returns {string|null} 探测到的路径
     */
    detectStPath() {
        // 如果已配置，先验证
        if (this.stDataDir && fs.existsSync(this.stDataDir)) {
            if (this._validateStPath(this.stDataDir)) {
                return this.stDataDir;
            }
        }

        // 遍历候选路径
        for (const candidate of ST_PATH_CANDIDATES) {
            if (fs.existsSync(candidate) && this._validateStPath(candidate)) {
                console.log(`[STClient] 探测到 SillyTavern 路径: ${candidate}`);
                return candidate;
            }
        }

        console.warn('[STClient] 未能自动探测到 SillyTavern 安装路径');
        return null;
    }

    /**
     * 验证路径是否为有效的 SillyTavern 安装目录
     */
    _validateStPath(p) {
        if (!p || !fs.existsSync(p)) return false;

        const normalized = path.normalize(p);
        const indicators = [
            path.join(normalized, 'data'),
            path.join(normalized, 'data', 'default-user'),
            path.join(normalized, 'public'),
            path.join(normalized, 'server.js'),
            path.join(normalized, 'Start.bat'),
            path.join(normalized, 'start.sh'),
            path.join(normalized, 'package.json'),
            path.join(normalized, 'config.yaml'),
            path.join(normalized, 'settings.json'),
            path.join(normalized, 'characters'),
            path.join(normalized, 'worlds'),
        ];

        if (indicators.some(p => fs.existsSync(p))) {
            return true;
        }

        // 允许传入 default-user 直接目录
        if (path.basename(normalized).toLowerCase() === 'default-user') {
            return true;
        }

        // 允许传入 data 目录
        const dataDir = path.basename(normalized).toLowerCase() === 'data'
            ? normalized
            : path.join(normalized, 'data');

        if (fs.existsSync(dataDir) && this._isDir(dataDir)) {
            try {
                for (const entry of fs.readdirSync(dataDir)) {
                    const entryPath = path.join(dataDir, entry);
                    if (!this._isDir(entryPath)) continue;
                    if (fs.existsSync(path.join(entryPath, 'settings.json'))) return true;
                    if (fs.existsSync(path.join(entryPath, 'characters'))) return true;
                    if (fs.existsSync(path.join(entryPath, 'worlds'))) return true;
                }
            } catch (e) {
                // ignore
            }
        }

        return false;
    }

    _isDir(p) {
        try {
            return fs.existsSync(p) && fs.statSync(p).isDirectory();
        } catch (e) {
            return false;
        }
    }

    _isFile(p) {
        try {
            return fs.existsSync(p) && fs.statSync(p).isFile();
        } catch (e) {
            return false;
        }
    }

    /**
     * 从 data 目录找到用户目录
     */
    _findUserDirFromDataDir(dataDir) {
        if (!dataDir || !this._isDir(dataDir)) return null;

        const defaultUser = path.join(dataDir, 'default-user');
        if (this._isDir(defaultUser)) {
            return defaultUser;
        }

        try {
            const candidates = [];
            for (const name of fs.readdirSync(dataDir)) {
                const userPath = path.join(dataDir, name);
                if (!this._isDir(userPath)) continue;

                let score = 0;
                if (fs.existsSync(path.join(userPath, 'settings.json'))) score += 5;
                for (const sub of ['characters', 'worlds', 'OpenAI Settings', 'presets', 'regex', 'QuickReplies', 'scripts']) {
                    if (fs.existsSync(path.join(userPath, sub))) score += 1;
                }
                if (score > 0) {
                    candidates.push({ score, path: userPath });
                }
            }

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
                return candidates[0].path;
            }
        } catch (e) {
            // ignore
        }

        return null;
    }

    /**
     * 规范化用户数据目录路径
     */
    _normalizeUserDir(inputPath) {
        if (!inputPath) return null;

        try {
            const normalized = path.normalize(inputPath);
            const parts = normalized.split(path.sep);

            // 如果包含 default-user，截取到该目录
            if (parts.includes('default-user')) {
                const idx = parts.indexOf('default-user');
                return parts.slice(0, idx + 1).join(path.sep);
            }

            const base = path.basename(normalized).toLowerCase();

            // 已是用户目录
            if (base === 'default-user') return normalized;
            if (fs.existsSync(path.join(normalized, 'settings.json'))) return normalized;
            if (fs.existsSync(path.join(normalized, 'characters'))) return normalized;

            // 是 data 目录
            if (base === 'data') {
                return this._findUserDirFromDataDir(normalized) || path.join(normalized, 'default-user');
            }

            // 视为根目录
            let dataDir = path.join(normalized, 'data');
            if (!fs.existsSync(dataDir)) {
                const parent = path.dirname(normalized);
                const parentData = path.join(parent, 'data');
                if (fs.existsSync(parentData)) {
                    dataDir = parentData;
                }
            }

            return this._findUserDirFromDataDir(dataDir) || path.join(dataDir, 'default-user');
        } catch (e) {
            return null;
        }
    }

    /**
     * 获取候选根目录列表
     */
    _candidateRoots() {
        const roots = [];
        if (this.stDataDir) {
            roots.push(this.stDataDir);
        }
        if (!this.stDataDir) {
            const detected = this.detectStPath();
            if (detected) roots.push(detected);
        }
        return roots;
    }

    /**
     * 获取候选用户目录列表
     */
    _candidateUserDirs() {
        const candidates = [];
        for (const root of this._candidateRoots()) {
            const userDir = this._normalizeUserDir(root);
            if (userDir) candidates.push(userDir);
        }

        // 添加更多候选
        candidates.push(
            path.join(process.cwd(), 'data', 'default-user'),
            path.join(process.cwd(), '..', 'data', 'default-user'),
            'D:\\SillyTavern\\data\\default-user',
            'E:\\SillyTavern\\data\\default-user',
            'C:\\SillyTavern\\data\\default-user',
        );

        return candidates;
    }

    /**
     * 获取第一个存在的路径
     */
    _firstExistingPath(candidates, wantDir = true) {
        for (const raw of candidates) {
            if (!raw) continue;
            const p = path.normalize(raw);
            if (fs.existsSync(p)) {
                if (wantDir && this._isDir(p)) return p;
                if (!wantDir && this._isFile(p)) return p;
            }
        }
        return null;
    }

    /**
     * 获取 SillyTavern 资源子目录的完整路径
     */
    getStSubdir(resourceType) {
        if (resourceType === 'presets') return this.getPresetsDir();
        if (resourceType === 'regex') return this.getRegexDir();
        if (resourceType === 'settings') return this.getSettingsPath();

        const userDir = this._normalizeUserDir(this.stDataDir || this.detectStPath());
        if (!userDir) return null;

        const subdir = ST_DATA_STRUCTURE[resourceType];
        if (!subdir) return null;

        const fullPath = path.join(userDir, subdir);
        if (fs.existsSync(fullPath)) return fullPath;

        return null;
    }

    /**
     * 获取 settings.json 路径
     */
    getSettingsPath(customPath = null) {
        if (customPath && fs.existsSync(customPath)) return customPath;

        const candidates = [];
        for (const userDir of this._candidateUserDirs()) {
            candidates.push(path.join(userDir, 'settings.json'));
        }
        for (const root of this._candidateRoots()) {
            candidates.push(path.join(root, 'settings.json'));
        }

        return this._firstExistingPath(candidates, false);
    }

    /**
     * 获取预设目录路径
     */
    getPresetsDir(customPath = null) {
        if (customPath && fs.existsSync(customPath)) return customPath;

        const candidates = [];
        for (const userDir of this._candidateUserDirs()) {
            candidates.push(
                path.join(userDir, 'OpenAI Settings'),
                path.join(userDir, 'presets'),
            );
        }
        for (const root of this._candidateRoots()) {
            candidates.push(
                path.join(root, 'OpenAI Settings'),
                path.join(root, 'presets'),
                path.join(root, 'public', 'presets'),
            );
        }

        return this._firstExistingPath(candidates, true);
    }

    /**
     * 获取正则脚本目录路径
     */
    getRegexDir(customPath = null) {
        if (customPath && fs.existsSync(customPath)) return customPath;

        const candidates = [];
        for (const userDir of this._candidateUserDirs()) {
            candidates.push(path.join(userDir, 'regex'));
        }
        for (const root of this._candidateRoots()) {
            candidates.push(
                path.join(root, 'regex'),
                path.join(root, 'public', 'scripts', 'regex'),
            );
        }

        return this._firstExistingPath(candidates, true);
    }

    /**
     * 获取快速回复目录路径
     */
    getQuickRepliesDir(customPath = null) {
        if (customPath && fs.existsSync(customPath)) return customPath;

        const candidates = [];
        for (const userDir of this._candidateUserDirs()) {
            candidates.push(path.join(userDir, 'QuickReplies'));
        }

        return this._firstExistingPath(candidates, true);
    }

    // ==================== 连接测试 ====================

    /**
     * 测试与 SillyTavern 的连接
     */
    testConnection() {
        const result = {
            local: { available: false, path: null, resources: {} },
            api: { available: false, url: this.stUrl, version: null },
        };

        // 测试本地路径
        const stPath = this.stDataDir || this.detectStPath();
        if (stPath) {
            result.local.available = true;
            result.local.path = stPath;

            // 检查各资源目录
            for (const resType of Object.keys(ST_DATA_STRUCTURE)) {
                if (resType === 'settings') continue;

                let subdir;
                if (resType === 'presets') subdir = this.getPresetsDir();
                else if (resType === 'regex') subdir = this.getRegexDir();
                else subdir = this.getStSubdir(resType);

                if (subdir) {
                    try {
                        const files = fs.readdirSync(subdir);
                        const count = files.filter(f => f.endsWith('.json') || f.endsWith('.png')).length;
                        result.local.resources[resType] = count;
                    } catch (e) {
                        result.local.resources[resType] = 0;
                    }
                }
            }
        }

        return result;
    }

    // ==================== 资源同步 ====================

    /**
     * 同步单个资源
     */
    syncResource(resourceType, resId, targetDir, useApi = false) {
        try {
            const srcDir = this.getStSubdir(resourceType);
            if (!srcDir) {
                return { success: false, msg: '未找到源目录' };
            }

            const srcPath = path.join(srcDir, resId);
            if (!fs.existsSync(srcPath)) {
                return { success: false, msg: '源文件不存在' };
            }

            // 确保目标目录存在
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            const destPath = path.join(targetDir, resId);
            fs.copyFileSync(srcPath, destPath);

            return { success: true, msg: '同步成功' };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    }

    /**
     * 同步全部资源
     */
    syncAllResources(resourceType, targetDir, useApi = false) {
        const result = {
            success: 0,
            failed: 0,
            skipped: 0,
            errors: [],
            synced: [],
        };

        try {
            const srcDir = this.getStSubdir(resourceType);
            if (!srcDir || !fs.existsSync(srcDir)) {
                result.errors.push('未找到源目录');
                return result;
            }

            // 确保目标目录存在
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            const files = fs.readdirSync(srcDir);
            for (const file of files) {
                const srcPath = path.join(srcDir, file);

                try {
                    const stat = fs.statSync(srcPath);
                    if (!stat.isFile()) continue;

                    // 检查扩展名
                    const ext = path.extname(file).toLowerCase();
                    if (resourceType === 'characters' && ext !== '.png' && ext !== '.json') continue;
                    if (resourceType !== 'characters' && ext !== '.json') continue;

                    const destPath = path.join(targetDir, file);

                    // 检查是否需要复制
                    let needsCopy = true;
                    if (fs.existsSync(destPath)) {
                        const destStat = fs.statSync(destPath);
                        if (destStat.mtimeMs >= stat.mtimeMs && destStat.size === stat.size) {
                            needsCopy = false;
                            result.skipped++;
                        }
                    }

                    if (needsCopy) {
                        fs.copyFileSync(srcPath, destPath);
                        result.success++;
                        result.synced.push(file);
                    }
                } catch (e) {
                    result.failed++;
                    result.errors.push(`${file}: ${e.message}`);
                }
            }
        } catch (e) {
            result.errors.push(e.message);
        }

        return result;
    }

    // ==================== 角色卡读取 ====================

    /**
     * 列出所有角色卡
     */
    listCharacters(useApi = false) {
        return this._listCharactersLocal();
    }

    _listCharactersLocal() {
        const charsDir = this.getStSubdir('characters');
        if (!charsDir) {
            console.warn('[STClient] 未找到角色卡目录');
            return [];
        }

        const characters = [];
        try {
            for (const filename of fs.readdirSync(charsDir)) {
                if (!filename.endsWith('.png')) continue;

                try {
                    const filepath = path.join(charsDir, filename);
                    const charData = this._readCharacterCard(filepath);
                    if (charData) {
                        characters.push({
                            id: filename.replace('.png', ''),
                            filename: filename,
                            name: charData.name || filename,
                            description: (charData.description || '').substring(0, 200),
                            creator: charData.creator || '',
                            tags: charData.tags || [],
                            filepath: filepath,
                        });
                    }
                } catch (e) {
                    console.warn(`[STClient] 读取角色卡 ${filename} 失败:`, e.message);
                }
            }
        } catch (e) {
            console.error('[STClient] 扫描角色卡目录失败:', e);
        }

        console.log(`[STClient] 从本地读取 ${characters.length} 个角色卡`);
        return characters;
    }

    /**
     * 从 PNG 文件读取角色卡数据
     */
    _readCharacterCard(filepath) {
        try {
            const buffer = fs.readFileSync(filepath);

            // 验证 PNG 签名
            const signature = buffer.slice(0, 8);
            if (signature.toString('hex') !== '89504e470d0a1a0a') {
                return null;
            }

            let offset = 8;
            while (offset < buffer.length) {
                const length = buffer.readUInt32BE(offset);
                const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
                const data = buffer.slice(offset + 8, offset + 8 + length);

                if (type === 'tEXt') {
                    const nullPos = data.indexOf(0);
                    if (nullPos !== -1) {
                        const keyword = data.slice(0, nullPos).toString('latin1');
                        const text = data.slice(nullPos + 1);

                        if (keyword === 'chara' || keyword === 'ccv3') {
                            try {
                                const decoded = Buffer.from(text.toString('latin1'), 'base64');
                                const jsonData = JSON.parse(decoded.toString('utf-8'));
                                // V2/V3 格式
                                if (jsonData.data) return jsonData.data;
                                return jsonData;
                            } catch (e) {
                                // ignore
                            }
                        }
                    }
                }

                if (type === 'IEND') break;
                offset += 12 + length; // 4 (length) + 4 (type) + length + 4 (CRC)
            }
        } catch (e) {
            console.error(`[STClient] 解析角色卡失败 ${filepath}:`, e.message);
        }

        return null;
    }

    // ==================== 世界书读取 ====================

    /**
     * 列出所有世界书
     */
    listWorldBooks(useApi = false) {
        return this._listWorldBooksLocal();
    }

    _listWorldBooksLocal() {
        const worldsDir = this.getStSubdir('worlds');
        if (!worldsDir) {
            console.warn('[STClient] 未找到世界书目录');
            return [];
        }

        const worldBooks = [];
        try {
            for (const entry of fs.readdirSync(worldsDir)) {
                if (entry.startsWith('.')) continue;

                const entryPath = path.join(worldsDir, entry);

                try {
                    const stat = fs.statSync(entryPath);

                    if (stat.isFile() && entry.endsWith('.json')) {
                        const wbData = this._readWorldBookFile(entryPath);
                        if (wbData) {
                            const entries = wbData.entries || {};
                            worldBooks.push({
                                id: entry.replace('.json', ''),
                                filename: entry,
                                name: wbData.name || entry,
                                description: wbData.description || '',
                                entries_count: typeof entries === 'object' ? Object.keys(entries).length : 0,
                                filepath: entryPath,
                            });
                        }
                    } else if (stat.isDirectory()) {
                        const wiFile = path.join(entryPath, 'world_info.json');
                        if (fs.existsSync(wiFile)) {
                            const wbData = this._readWorldBookFile(wiFile);
                            if (wbData) {
                                const entries = wbData.entries || {};
                                worldBooks.push({
                                    id: entry,
                                    filename: entry,
                                    name: wbData.name || entry,
                                    description: wbData.description || '',
                                    entries_count: typeof entries === 'object' ? Object.keys(entries).length : 0,
                                    filepath: wiFile,
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[STClient] 读取世界书 ${entry} 失败:`, e.message);
                }
            }
        } catch (e) {
            console.error('[STClient] 扫描世界书目录失败:', e);
        }

        console.log(`[STClient] 从本地读取 ${worldBooks.length} 本世界书`);
        return worldBooks;
    }

    _readWorldBookFile(filepath) {
        try {
            const content = fs.readFileSync(filepath, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            console.error(`[STClient] 解析世界书失败 ${filepath}:`, e.message);
            return null;
        }
    }

    // ==================== 正则脚本读取 ====================

    /**
     * 列出所有正则脚本
     */
    listRegexScripts(useApi = false) {
        return this._listRegexScriptsLocal();
    }

    _listRegexScriptsLocal() {
        const regexDir = this.getRegexDir();
        if (!regexDir) {
            console.warn('[STClient] 未找到正则脚本目录');
            return [];
        }

        const scripts = [];
        try {
            for (const filename of fs.readdirSync(regexDir)) {
                if (!filename.endsWith('.json')) continue;

                try {
                    const filepath = path.join(regexDir, filename);
                    const content = fs.readFileSync(filepath, 'utf-8');
                    const data = JSON.parse(content);

                    const scriptId = filename.replace('.json', '');
                    scripts.push({
                        id: scriptId,
                        filename: filename,
                        name: data.scriptName || scriptId,
                        enabled: data.enabled !== false,
                        find_regex: data.findRegex || '',
                        replace_string: data.replaceString || '',
                        filepath: filepath,
                        data: data,
                    });
                } catch (e) {
                    console.warn(`[STClient] 读取正则脚本 ${filename} 失败:`, e.message);
                }
            }
        } catch (e) {
            console.error('[STClient] 扫描正则脚本目录失败:', e);
        }

        console.log(`[STClient] 从本地读取 ${scripts.length} 个正则脚本`);
        return scripts;
    }

    // ==================== 预设读取 ====================

    /**
     * 列出所有预设
     */
    listPresets(useApi = false) {
        return this._listPresetsLocal();
    }

    _listPresetsLocal() {
        const presetsDir = this.getPresetsDir();
        if (!presetsDir) {
            console.warn('[STClient] 未找到预设目录');
            return [];
        }

        const presets = [];
        try {
            for (const filename of fs.readdirSync(presetsDir)) {
                if (!filename.endsWith('.json')) continue;

                try {
                    const filepath = path.join(presetsDir, filename);
                    const content = fs.readFileSync(filepath, 'utf-8');
                    const data = JSON.parse(content);

                    const presetId = filename.replace('.json', '');
                    presets.push({
                        id: presetId,
                        filename: filename,
                        name: data.name || data.title || presetId,
                        description: data.description || data.note || '',
                        temperature: data.temperature,
                        max_tokens: data.max_tokens || data.openai_max_tokens,
                        filepath: filepath,
                    });
                } catch (e) {
                    console.warn(`[STClient] 读取预设 ${filename} 失败:`, e.message);
                }
            }
        } catch (e) {
            console.error('[STClient] 扫描预设目录失败:', e);
        }

        console.log(`[STClient] 从本地读取 ${presets.length} 个预设`);
        return presets;
    }

    // ==================== 快速回复读取 ====================

    /**
     * 列出所有快速回复
     */
    listQuickReplies(useApi = false) {
        return this._listQuickRepliesLocal();
    }

    _listQuickRepliesLocal() {
        const qrDir = this.getQuickRepliesDir();
        if (!qrDir) {
            console.warn('[STClient] 未找到快速回复目录');
            return [];
        }

        const quickReplies = [];
        try {
            for (const filename of fs.readdirSync(qrDir)) {
                if (!filename.endsWith('.json')) continue;

                try {
                    const filepath = path.join(qrDir, filename);
                    const content = fs.readFileSync(filepath, 'utf-8');
                    const data = JSON.parse(content);

                    const qrId = filename.replace('.json', '');
                    quickReplies.push({
                        id: qrId,
                        filename: filename,
                        name: data.name || data.setName || qrId,
                        filepath: filepath,
                        data: data,
                    });
                } catch (e) {
                    console.warn(`[STClient] 读取快速回复 ${filename} 失败:`, e.message);
                }
            }
        } catch (e) {
            console.error('[STClient] 扫描快速回复目录失败:', e);
        }

        console.log(`[STClient] 从本地读取 ${quickReplies.length} 个快速回复`);
        return quickReplies;
    }
}

// 单例实例
let _stClientInstance = null;

function getStClient(options = {}) {
    if (!_stClientInstance) {
        _stClientInstance = new STClient(options);
    }
    return _stClientInstance;
}

function refreshStClient(options = {}) {
    _stClientInstance = new STClient(options);
    return _stClientInstance;
}

module.exports = {
    STClient,
    getStClient,
    refreshStClient,
};
