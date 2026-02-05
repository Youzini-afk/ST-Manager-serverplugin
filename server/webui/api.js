/**
 * Web UI API 兼容层
 * 
 * 完整复刻 Python 后端的所有 API 端点
 * 使前端 JS 无需任何修改即可工作
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// 导入核心模块
let cards, worldInfo, presets, extensions, automation, backup, config, regex, resources;
// 导入正则工具
const regexUtils = require('../utils/regex');
const { isPathInside, resolveInside } = require('../utils/safePath');
// 导入 ST 客户端
const { STClient, getStClient, refreshStClient } = require('../services/st_client');

// ============ ST 本地路径探测/校验 ============

function _safeStat(p) {
    try {
        return fs.statSync(p);
    } catch (e) {
        return null;
    }
}

function _isDir(p) {
    const stat = _safeStat(p);
    return stat ? stat.isDirectory() : false;
}

function _isFile(p) {
    const stat = _safeStat(p);
    return stat ? stat.isFile() : false;
}

function _expandUserPath(inputPath) {
    if (!inputPath) return '';
    let expanded = inputPath;
    const username = process.env.USERNAME || process.env.USER || '';
    expanded = expanded.replace('{user}', username);
    if (expanded.startsWith('~')) {
        expanded = path.join(os.homedir(), expanded.slice(1));
    }
    return expanded;
}

function _normalizeInputPath(inputPath) {
    if (typeof inputPath !== 'string') return '';
    let cleaned = inputPath.trim();
    if (!cleaned) return '';
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
    }
    cleaned = _expandUserPath(cleaned);
    return path.resolve(path.normalize(cleaned));
}

function _openFolder(folderPath) {
    try {
        if (!folderPath || !_isDir(folderPath)) return false;
        let cmd = '';
        let args = [];
        if (process.platform === 'win32') {
            cmd = 'explorer.exe';
            args = [folderPath];
        } else if (process.platform === 'darwin') {
            cmd = 'open';
            args = [folderPath];
        } else {
            cmd = 'xdg-open';
            args = [folderPath];
        }
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return true;
    } catch (e) {
        return false;
    }
}

function _getAllowedRoots() {
    const roots = [];
    if (!config) return roots;
    const cfg = (typeof config.get === 'function') ? config.get() : {};
    const candidates = [
        config.getPluginDataDir && config.getPluginDataDir(),
        config.getDataRoot && config.getDataRoot(),
        config.getBackupRoot && config.getBackupRoot(),
        config.getStRoot && config.getStRoot(),
    ];
    for (const candidate of candidates) {
        if (candidate && _isDir(candidate)) {
            roots.push(path.resolve(candidate));
        }
    }
    const extraRoots = Array.isArray(cfg.allowed_abs_resource_roots) ? cfg.allowed_abs_resource_roots : [];
    for (const root of extraRoots) {
        if (typeof root !== 'string') continue;
        const normalized = _normalizeInputPath(root);
        if (normalized && _isDir(normalized)) {
            roots.push(normalized);
        }
    }
    return roots;
}

function _isPathAllowed(targetPath, roots) {
    if (!targetPath) return false;
    return (roots || []).some(root => isPathInside(root, targetPath));
}

function _normalizeStRoot(inputPath) {
    if (!inputPath) return '';
    let normalized = path.normalize(inputPath);
    if (_isFile(normalized)) {
        normalized = path.dirname(normalized);
    }

    const parts = normalized.split(path.sep);
    const lowerParts = parts.map(p => p.toLowerCase());
    const root = path.parse(normalized).root;

    if (lowerParts.length && lowerParts[lowerParts.length - 1] === 'public') {
        return path.dirname(normalized) || normalized;
    }

    if (lowerParts.includes('data')) {
        let dataIdx = -1;
        for (let i = lowerParts.length - 1; i >= 0; i--) {
            if (lowerParts[i] === 'data') {
                dataIdx = i;
                break;
            }
        }
        if (dataIdx >= 0) {
            const base = path.join(root, ...parts.slice(1, dataIdx));
            if (base) return base;
        }
    }

    if (lowerParts.length && lowerParts[lowerParts.length - 1] === 'default-user') {
        const parent = path.dirname(normalized);
        if (path.basename(parent).toLowerCase() === 'data') {
            return path.dirname(parent) || normalized;
        }
        return parent || normalized;
    }

    return normalized;
}

function _validateStPath(inputPath) {
    if (!inputPath || !fs.existsSync(inputPath)) return false;
    const normalized = path.normalize(inputPath);

    const indicators = [
        path.join(normalized, 'data'),
        path.join(normalized, 'data', 'default-user'),
        path.join(normalized, 'public'),
        path.join(normalized, 'server.js'),
        path.join(normalized, 'start.sh'),
        path.join(normalized, 'Start.bat'),
        path.join(normalized, 'package.json'),
        path.join(normalized, 'config.yaml'),
        path.join(normalized, 'settings.json'),
        path.join(normalized, 'characters'),
        path.join(normalized, 'worlds'),
    ];
    if (indicators.some(p => fs.existsSync(p))) return true;

    try {
        if (path.basename(normalized).toLowerCase() === 'default-user') {
            return true;
        }
    } catch (e) {
        return false;
    }

    let dataDir = normalized;
    if (path.basename(normalized).toLowerCase() !== 'data') {
        dataDir = path.join(normalized, 'data');
    }
    if (_isDir(dataDir)) {
        try {
            const entries = fs.readdirSync(dataDir);
            for (const entry of entries) {
                const entryPath = path.join(dataDir, entry);
                if (!_isDir(entryPath)) continue;
                if (fs.existsSync(path.join(entryPath, 'settings.json'))) return true;
                if (fs.existsSync(path.join(entryPath, 'characters')) || fs.existsSync(path.join(entryPath, 'worlds'))) {
                    return true;
                }
            }
        } catch (e) {
            return false;
        }
    }
    return false;
}

function _countFiles(dir, exts) {
    if (!_isDir(dir)) return 0;
    const allow = (exts || []).map(e => e.toLowerCase());
    let count = 0;
    try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
            const fullPath = path.join(dir, f);
            const stat = _safeStat(fullPath);
            if (!stat || !stat.isFile()) continue;
            const ext = path.extname(f).toLowerCase();
            if (!allow.length || allow.includes(ext)) {
                count += 1;
            }
        }
    } catch (e) {
        return 0;
    }
    return count;
}

function _getPresetsDirFromUserDir(userDir) {
    if (!userDir) return null;
    const candidates = [
        path.join(userDir, 'OpenAI Settings'),
        path.join(userDir, 'presets'),
        path.join(userDir, 'TextGen Settings'),
    ];
    for (const p of candidates) {
        if (_isDir(p)) return p;
    }
    return null;
}

function _getRegexDirFromUserDir(userDir) {
    if (!userDir) return null;
    const candidates = [
        path.join(userDir, 'regex'),
        path.join(userDir, 'scripts', 'extensions', 'regex'),
        path.join(userDir, 'extensions', 'regex'),
    ];
    for (const p of candidates) {
        if (_isDir(p)) return p;
    }
    return null;
}

function _getSettingsPathFromUserDir(userDir) {
    if (!userDir) return null;
    const candidate = path.join(userDir, 'settings.json');
    return _isFile(candidate) ? candidate : null;
}

function _collectStResources(userDir) {
    const resources = {};
    if (!userDir) return resources;

    const charactersDir = path.join(userDir, 'characters');
    resources.characters = {
        path: charactersDir,
        count: _countFiles(charactersDir, ['.png', '.json']),
    };

    const worldsDir = path.join(userDir, 'worlds');
    resources.worlds = {
        path: worldsDir,
        count: _countFiles(worldsDir, ['.json']),
    };

    const presetsDir = _getPresetsDirFromUserDir(userDir);
    resources.presets = {
        path: presetsDir,
        count: _countFiles(presetsDir, ['.json']),
    };

    const quickRepliesDir = path.join(userDir, 'QuickReplies');
    resources.quick_replies = {
        path: quickRepliesDir,
        count: _countFiles(quickRepliesDir, ['.json']),
    };

    const regexDir = _getRegexDirFromUserDir(userDir);
    const scriptCount = _countFiles(regexDir, ['.json']);
    let globalCount = 0;
    let settingsPath = _getSettingsPathFromUserDir(userDir);
    if (settingsPath) {
        try {
            const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            const items = regex && regex.extractGlobalRegexFromSettings
                ? regex.extractGlobalRegexFromSettings(raw)
                : [];
            globalCount = Array.isArray(items) ? items.length : 0;
        } catch (e) {
            globalCount = 0;
        }
    }
    resources.regex = {
        path: regexDir || settingsPath,
        count: scriptCount + globalCount,
        script_count: scriptCount,
        global_count: globalCount,
    };

    return resources;
}

function _normalizeSlash(input) {
    return String(input || '').replace(/\\/g, '/');
}

function _sanitizeFileName(name) {
    const base = path.basename(String(name || '').trim());
    const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    return cleaned || 'unnamed';
}

function _sanitizeFolderSegment(name) {
    const cleaned = _sanitizeFileName(name).replace(/\.+$/g, '').trim();
    return cleaned || 'unnamed';
}

function _sanitizeRelativeFolder(input) {
    if (typeof input !== 'string') return '';
    const normalized = _normalizeSlash(input).trim().replace(/^\/+|\/+$/g, '');
    if (!normalized) return '';
    if (normalized.includes('..')) return '';
    if (path.isAbsolute(normalized)) return '';
    const parts = normalized
        .split('/')
        .map(_sanitizeFolderSegment)
        .filter(Boolean);
    return parts.join('/');
}

function _getPluginDataDir() {
    return config ? config.getPluginDataDir() : path.join(__dirname, '..', '..', 'data');
}

function _getLibraryRoot() {
    return path.join(_getPluginDataDir(), 'library');
}

function _getLibraryCharactersDir() {
    return path.join(_getLibraryRoot(), 'characters');
}

function _getLibraryResourcesDir() {
    return path.join(_getLibraryRoot(), 'resources');
}

function _getLibraryAssetsDir() {
    return path.join(_getLibraryRoot(), 'assets');
}

function _getDefaultCardImagePath(staticDir) {
    return path.join(staticDir, 'images', 'default_card.png');
}

function _findSidecarImage(cardPath) {
    if (!cardPath) return null;
    const dir = path.dirname(cardPath);
    const name = path.basename(cardPath, path.extname(cardPath));
    const exts = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.bmp'];
    for (const ext of exts) {
        const candidate = path.join(dir, `${name}${ext}`);
        if (_isFile(candidate)) {
            return candidate;
        }
    }
    return null;
}

function _resolveUiKey(uiData, cardId) {
    const normalizedId = _normalizeSlash(cardId || '').trim();
    if (!normalizedId) return '';
    if (uiData[normalizedId]) return normalizedId;

    const ext = path.extname(normalizedId).toLowerCase();
    if (ext === '.png') {
        const alt = normalizedId.slice(0, -4) + '.json';
        if (uiData[alt]) return alt;
    } else if (ext === '.json') {
        const alt = normalizedId.slice(0, -5) + '.png';
        if (uiData[alt]) return alt;
    }

    const parent = _normalizeSlash(path.posix.dirname(normalizedId));
    if (parent && parent !== '.' && uiData[parent]) {
        return parent;
    }
    return normalizedId;
}

function _resolveCardResourceBinding(cardId) {
    const uiData = config ? config.loadUiData() : {};
    const uiKey = _resolveUiKey(uiData, cardId);
    const rawFolder = uiData[uiKey]?.resource_folder || '';
    const folder = _sanitizeRelativeFolder(rawFolder);
    const resourcesRoot = _getLibraryResourcesDir();
    const fullPath = folder ? resolveInside(resourcesRoot, folder) : null;
    return {
        uiData,
        uiKey,
        folder,
        fullPath,
        exists: Boolean(fullPath && _isDir(fullPath)),
    };
}

function _saveCardResourceFolder(cardId, folder) {
    if (!config) return { success: false, msg: '配置模块未初始化' };
    const normalizedCardId = _normalizeSlash(cardId || '').trim();
    if (!normalizedCardId) return { success: false, msg: '缺少卡片 ID' };

    const uiData = config.loadUiData();
    const uiKey = _resolveUiKey(uiData, normalizedCardId);

    if (!uiData[uiKey] || typeof uiData[uiKey] !== 'object') {
        uiData[uiKey] = {};
    }

    if (!folder) {
        uiData[uiKey].resource_folder = '';
        config.saveUiData(uiData);
        return { success: true, resource_folder: '' };
    }

    const normalizedFolder = _sanitizeRelativeFolder(folder);
    if (!normalizedFolder) {
        return { success: false, msg: '资源目录名称非法' };
    }

    const resourcesRoot = _getLibraryResourcesDir();
    const fullPath = resolveInside(resourcesRoot, normalizedFolder);
    if (!fullPath) {
        return { success: false, msg: '资源目录路径非法' };
    }

    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }

    uiData[uiKey].resource_folder = normalizedFolder;
    config.saveUiData(uiData);
    return { success: true, resource_folder: normalizedFolder, resource_full_path: fullPath };
}

function _getCardDisplayName(cardId) {
    const card = cards ? cards.getCard(cardId) : null;
    const data = card?.data?.data || card?.data || {};
    return data.name || path.basename(String(cardId || ''), path.extname(String(cardId || ''))) || String(cardId || '');
}

function _createCardResourceFolder(cardId) {
    const name = _getCardDisplayName(cardId);
    const baseFolder = _sanitizeFolderSegment(name);
    const resourcesRoot = _getLibraryResourcesDir();
    if (!fs.existsSync(resourcesRoot)) {
        fs.mkdirSync(resourcesRoot, { recursive: true });
    }

    let folder = baseFolder;
    let fullPath = resolveInside(resourcesRoot, folder);
    let index = 1;
    while (fullPath && fs.existsSync(fullPath)) {
        folder = `${baseFolder}_${index}`;
        fullPath = resolveInside(resourcesRoot, folder);
        index += 1;
    }
    if (!fullPath) {
        return { success: false, msg: '无法创建资源目录' };
    }

    fs.mkdirSync(fullPath, { recursive: true });
    return _saveCardResourceFolder(cardId, folder);
}

function _movePathToTrash(sourcePath, options = {}) {
    const targetPath = path.resolve(path.normalize(sourcePath || ''));
    if (!targetPath || !fs.existsSync(targetPath)) {
        return { success: false, error: '路径不存在' };
    }
    const trashRoot = config ? config.getTrashPath() : null;
    if (!trashRoot) {
        return { success: false, error: '回收站路径不可用' };
    }
    if (!fs.existsSync(trashRoot)) {
        fs.mkdirSync(trashRoot, { recursive: true });
    }

    const prefix = options.prefix ? `${_sanitizeFolderSegment(options.prefix)}_` : '';
    const basename = path.basename(targetPath);
    const stamp = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const targetName = `${prefix}${stamp}_${basename}`;
    const trashPath = path.join(trashRoot, targetName);

    try {
        fs.renameSync(targetPath, trashPath);
        return { success: true, trashPath };
    } catch (err) {
        try {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
                fs.cpSync(targetPath, trashPath, { recursive: true });
                fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
                fs.copyFileSync(targetPath, trashPath);
                fs.unlinkSync(targetPath);
            }
            return { success: true, trashPath };
        } catch (fallbackErr) {
            return { success: false, error: fallbackErr.message || err.message };
        }
    }
}

function _relativeToPluginData(fullPath) {
    return path.relative(_getPluginDataDir(), fullPath).replace(/\\/g, '/');
}

function _getResourceSubDirMap() {
    const sub = config ? config.getResourceSubDirs() : {
        lorebooks: 'lorebooks',
        regexes: path.join('extensions', 'regex'),
        scripts: path.join('extensions', 'tavern_helper'),
        quickreplies: path.join('extensions', 'quick-replies'),
    };
    return {
        lorebooks: 'lorebooks',
        regex: sub.regexes,
        scripts: sub.scripts,
        quick_replies: sub.quickreplies,
        presets: 'presets',
    };
}

function _listResourceFiles(folderName) {
    const normalizedFolder = _sanitizeRelativeFolder(folderName);
    if (!normalizedFolder) {
        return { success: false, msg: 'folder_name is required' };
    }

    const resourcesRoot = _getLibraryResourcesDir();
    const targetDir = resolveInside(resourcesRoot, normalizedFolder);
    if (!targetDir) {
        return { success: false, msg: '非法路径' };
    }

    const result = {
        skins: [],
        lorebooks: [],
        regex: [],
        scripts: [],
        quick_replies: [],
        presets: [],
    };

    if (!fs.existsSync(targetDir)) {
        return { success: true, files: result };
    }

    const imgExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
    try {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (imgExts.has(ext)) {
                result.skins.push(entry.name);
            }
        }
    } catch (e) {
        // ignore root scan errors
    }

    const subMap = _getResourceSubDirMap();
    for (const [category, subPath] of Object.entries(subMap)) {
        if (category === 'lorebooks' || category === 'presets' || category === 'regex' || category === 'scripts' || category === 'quick_replies') {
            const subDir = resolveInside(targetDir, subPath);
            if (!subDir || !fs.existsSync(subDir)) continue;

            try {
                const entries = fs.readdirSync(subDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
                    const fullPath = path.join(subDir, entry.name);
                    const stat = fs.statSync(fullPath);
                    result[category].push({
                        name: entry.name,
                        path: _relativeToPluginData(fullPath),
                        mtime: stat.mtimeMs,
                    });
                }
            } catch (e) {
                // ignore subdir scan errors
            }
        }
    }

    result.skins.sort();
    for (const key of ['lorebooks', 'regex', 'scripts', 'quick_replies', 'presets']) {
        result[key].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }

    return { success: true, files: result };
}

function _splitBuffer(buffer, delimiter) {
    const parts = [];
    let offset = 0;
    while (offset <= buffer.length) {
        const idx = buffer.indexOf(delimiter, offset);
        if (idx === -1) {
            parts.push(buffer.slice(offset));
            break;
        }
        parts.push(buffer.slice(offset, idx));
        offset = idx + delimiter.length;
    }
    return parts;
}

function _parseMultipartForm(req, maxSize = 30 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const contentType = String(req.headers['content-type'] || '');
        const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!match) {
            reject(new Error('Invalid multipart request'));
            return;
        }
        const boundary = match[1] || match[2];
        if (!boundary) {
            reject(new Error('Multipart boundary missing'));
            return;
        }

        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxSize) {
                reject(new Error('上传文件过大'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('error', (err) => reject(err));
        req.on('end', () => {
            try {
                const body = Buffer.concat(chunks);
                const boundaryMark = Buffer.from(`--${boundary}`);
                const crlf = Buffer.from('\r\n');
                const headerDivider = Buffer.from('\r\n\r\n');
                const fields = {};
                const files = {};
                const rawParts = _splitBuffer(body, boundaryMark);

                for (let part of rawParts) {
                    if (!part || !part.length) continue;
                    if (part.slice(0, 2).equals(crlf)) {
                        part = part.slice(2);
                    }
                    if (!part.length || part.equals(Buffer.from('--')) || part.equals(Buffer.from('--\r\n'))) {
                        continue;
                    }
                    if (part.slice(-2).equals(crlf)) {
                        part = part.slice(0, -2);
                    }
                    if (part.slice(-2).equals(Buffer.from('--'))) {
                        part = part.slice(0, -2);
                    }

                    const headerEnd = part.indexOf(headerDivider);
                    if (headerEnd === -1) continue;

                    const headerText = part.slice(0, headerEnd).toString('utf-8');
                    let content = part.slice(headerEnd + headerDivider.length);
                    if (content.slice(-2).equals(crlf)) {
                        content = content.slice(0, -2);
                    }

                    const headers = {};
                    for (const line of headerText.split('\r\n')) {
                        const sep = line.indexOf(':');
                        if (sep < 0) continue;
                        const key = line.slice(0, sep).trim().toLowerCase();
                        const value = line.slice(sep + 1).trim();
                        headers[key] = value;
                    }
                    const disposition = headers['content-disposition'] || '';
                    const nameMatch = disposition.match(/name="([^"]+)"/i);
                    if (!nameMatch) continue;
                    const fieldName = nameMatch[1];
                    const filenameMatch = disposition.match(/filename="([^"]*)"/i);

                    if (filenameMatch && filenameMatch[1] !== '') {
                        const fileObj = {
                            filename: filenameMatch[1],
                            contentType: headers['content-type'] || 'application/octet-stream',
                            data: content,
                        };
                        if (!files[fieldName]) {
                            files[fieldName] = fileObj;
                        } else if (Array.isArray(files[fieldName])) {
                            files[fieldName].push(fileObj);
                        } else {
                            files[fieldName] = [files[fieldName], fileObj];
                        }
                    } else {
                        fields[fieldName] = content.toString('utf-8');
                    }
                }

                resolve({ fields, files });
            } catch (err) {
                reject(err);
            }
        });
    });
}

function _ensureDir(dirPath) {
    if (!dirPath) return;
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function _asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function _pickMultipartFile(files, fieldName = 'file') {
    const bucket = files ? files[fieldName] : null;
    if (!bucket) return null;
    return Array.isArray(bucket) ? (bucket[0] || null) : bucket;
}

function _pickMultipartFiles(files, fieldName = 'files') {
    const bucket = files ? files[fieldName] : null;
    if (!bucket) return [];
    return Array.isArray(bucket) ? bucket : [bucket];
}

function _getPluginRoot() {
    if (config && typeof config.getPluginRoot === 'function') {
        return config.getPluginRoot();
    }
    return path.resolve(path.join(_getPluginDataDir(), '..'));
}

function _getSystemBackupsDir() {
    return path.join(_getPluginDataDir(), 'system', 'backups');
}

function _getBatchUploadRoot() {
    const tempDir = (config && typeof config.getTempDir === 'function')
        ? config.getTempDir()
        : path.join(_getPluginDataDir(), 'temp');
    return path.join(tempDir, 'batch_upload');
}

function _getClipboardFilePath() {
    const dbDir = (config && typeof config.getDbDir === 'function')
        ? config.getDbDir()
        : path.join(_getPluginDataDir(), 'system', 'db');
    return path.join(dbDir, 'wi_clipboard.json');
}

function _readClipboardItems() {
    const filePath = _getClipboardFilePath();
    if (!fs.existsSync(filePath)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function _writeClipboardItems(items) {
    const filePath = _getClipboardFilePath();
    _ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
}

function _sortClipboardItems(items) {
    return (items || []).sort((a, b) => {
        const orderA = Number.isFinite(a.sort_order) ? a.sort_order : 0;
        const orderB = Number.isFinite(b.sort_order) ? b.sort_order : 0;
        if (orderA !== orderB) return orderA - orderB;
        return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
    });
}

function _makeClipboardId() {
    return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function _deepSortObject(value) {
    if (Array.isArray(value)) {
        return value.map(_deepSortObject);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = _deepSortObject(value[key]);
    }
    return sorted;
}

function _normalizeCardDataForDiff(rawData) {
    if (!rawData || typeof rawData !== 'object') {
        return rawData;
    }
    const cloned = JSON.parse(JSON.stringify(rawData));
    const targets = [cloned];
    if (cloned.data && typeof cloned.data === 'object' && !Array.isArray(cloned.data)) {
        targets.push(cloned.data);
    }
    for (const target of targets) {
        if (Array.isArray(target.alternate_greetings)) {
            target.alternate_greetings = target.alternate_greetings
                .filter(v => typeof v === 'string')
                .map(v => v.trim())
                .filter(Boolean);
        }
    }
    return _deepSortObject(cloned);
}

function _hashJsonPayload(payload) {
    const normalized = _deepSortObject(payload);
    return crypto.createHash('sha1').update(JSON.stringify(normalized), 'utf-8').digest('hex');
}

function _estimateTokenCount(dataBlock) {
    if (!dataBlock || typeof dataBlock !== 'object') return 0;
    const pieces = [];
    const fields = [
        'name',
        'description',
        'first_mes',
        'mes_example',
        'personality',
        'scenario',
        'creator_notes',
        'system_prompt',
        'post_history_instructions',
    ];
    for (const field of fields) {
        const value = dataBlock[field];
        if (typeof value === 'string' && value.trim()) {
            pieces.push(value);
        }
    }
    if (Array.isArray(dataBlock.alternate_greetings)) {
        for (const val of dataBlock.alternate_greetings) {
            if (typeof val === 'string' && val.trim()) {
                pieces.push(val);
            }
        }
    }
    const totalChars = pieces.join('\n').length;
    return Math.max(0, Math.ceil(totalChars / 4));
}

function _extractCardDataFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === '.png') {
            const parsed = cards && cards.extractPngMetadata ? cards.extractPngMetadata(filePath) : null;
            if (!parsed) return null;
            const block = parsed.data || parsed;
            return {
                raw: parsed,
                data: block,
                name: block.name || path.basename(filePath, ext),
            };
        }
        if (ext === '.json') {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const block = parsed.data || parsed;
            return {
                raw: parsed,
                data: block,
                name: block.name || path.basename(filePath, ext),
            };
        }
    } catch (e) {
        return null;
    }
    return null;
}

function _getAllCardsForStats() {
    if (!cards || typeof cards.listCards !== 'function') return [];
    const result = cards.listCards({ page: 1, pageSize: 999999, sort: 'mtime_desc' });
    return Array.isArray(result.items) ? result.items : [];
}

function _buildCategoryCounts(cardItems) {
    const counts = {};
    for (const item of cardItems || []) {
        const folder = item.folder || item.category || '';
        counts[folder] = (counts[folder] || 0) + 1;
    }
    return counts;
}

function _resolveCardFilePath(cardId) {
    const safeId = _normalizeSlash(cardId || '').trim();
    if (!safeId || safeId.includes('..')) return null;
    return resolveInside(_getLibraryCharactersDir(), safeId);
}

function _resolveWorldInfoPath(filePath) {
    if (!filePath) return null;
    const input = String(filePath).trim();
    if (!input) return null;
    if (path.isAbsolute(input)) {
        const normalized = path.resolve(path.normalize(input));
        const roots = [
            path.join(_getLibraryRoot(), 'lorebooks'),
            path.join(_getLibraryRoot(), 'resources'),
        ];
        return roots.some(root => isPathInside(root, normalized)) ? normalized : null;
    }
    const libraryRoot = _getLibraryRoot();
    return resolveInside(libraryRoot, input);
}

function _resolveReadablePath(rawPath) {
    const input = String(rawPath || '').trim();
    if (!input) return null;
    if (path.isAbsolute(input)) {
        const normalized = path.resolve(path.normalize(input));
        const allowed = _getAllowedRoots();
        return _isPathAllowed(normalized, allowed) ? normalized : null;
    }
    const pluginDataDir = _getPluginDataDir();
    const direct = resolveInside(pluginDataDir, input);
    if (direct && fs.existsSync(direct)) return direct;
    const inLibrary = resolveInside(_getLibraryRoot(), input);
    if (inLibrary && fs.existsSync(inLibrary)) return inLibrary;
    const fromRoot = resolveInside(_getPluginRoot(), input);
    if (fromRoot && fs.existsSync(fromRoot)) return fromRoot;
    return direct || inLibrary || fromRoot;
}

function _resolvePresetFilePath(presetId) {
    const id = String(presetId || '').trim();
    if (!id) return null;
    if (id.startsWith('resource::')) {
        const parts = id.split('::');
        if (parts.length < 3) return null;
        const folder = _sanitizeRelativeFolder(parts[1]);
        const name = _sanitizeFileName(parts.slice(2).join('::'));
        if (!folder || !name) return null;
        return resolveInside(_getLibraryResourcesDir(), path.join(folder, 'presets', `${name.replace(/\.json$/i, '')}.json`));
    }
    const preset = presets && typeof presets.getPreset === 'function' ? presets.getPreset(id) : null;
    if (preset && preset.path && _isFile(preset.path)) return preset.path;
    if (id.includes('::')) {
        const parts = id.split('::');
        if (parts.length >= 2) {
            const type = parts[0];
            const filename = parts.slice(1).join('::');
            const dirMap = presets && presets.PRESET_DIRS ? presets.PRESET_DIRS : {};
            const subDir = dirMap[type];
            if (subDir) {
                return resolveInside(path.join(_getLibraryRoot(), 'presets', subDir), filename);
            }
        }
    }
    return null;
}

function _listResourcePresetItems(filterType = 'all', search = '') {
    const items = [];
    if (filterType === 'global') return items;
    const resourcesRoot = _getLibraryResourcesDir();
    if (!fs.existsSync(resourcesRoot)) return items;
    const searchLower = String(search || '').trim().toLowerCase();
    let folders = [];
    try {
        folders = fs.readdirSync(resourcesRoot);
    } catch (e) {
        return items;
    }
    for (const folder of folders) {
        const folderPath = resolveInside(resourcesRoot, folder);
        if (!folderPath || !_isDir(folderPath)) continue;
        const presetDir = resolveInside(resourcesRoot, path.join(folder, 'presets'));
        if (!presetDir || !_isDir(presetDir)) continue;
        let files = [];
        try {
            files = fs.readdirSync(presetDir);
        } catch (e) {
            continue;
        }
        for (const file of files) {
            if (!file.toLowerCase().endsWith('.json')) continue;
            const fullPath = resolveInside(presetDir, file);
            if (!fullPath || !_isFile(fullPath)) continue;
            let parsed = null;
            try {
                parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            } catch (e) {
                continue;
            }
            const name = path.basename(file, '.json');
            const item = {
                id: `resource::${folder}::${name}`,
                name,
                filename: file,
                type: 'resource',
                sourceFolder: folder,
                path: _relativeToPluginData(fullPath),
                mtime: fs.statSync(fullPath).mtimeMs,
                size: fs.statSync(fullPath).size,
                samplers: presets && typeof presets.parsePresetContent === 'function'
                    ? presets.parsePresetContent(parsed)
                    : {},
            };
            if (searchLower) {
                const haystack = `${item.name} ${item.filename} ${folder}`.toLowerCase();
                if (!haystack.includes(searchLower)) continue;
            }
            items.push(item);
        }
    }
    return items;
}

function _snapshotDirNameFromFilename(filename) {
    const nameNoExt = path.basename(String(filename || ''), path.extname(String(filename || '')));
    return nameNoExt.replace(/[\\/:*?"<>|]/g, '_').trim() || 'unnamed_backup';
}

function _resolveSnapshotTarget(reqData = {}) {
    const type = String(reqData.type || 'card');
    const targetId = String(reqData.id || '').trim();
    const filePath = String(reqData.file_path || '').trim();
    const libraryRoot = _getLibraryRoot();
    const backupsRoot = _getSystemBackupsDir();

    if (!targetId) {
        return { ok: false, msg: 'ID missing' };
    }

    if (type === 'lorebook') {
        if (targetId.startsWith('embedded::')) {
            const realCardId = targetId.replace(/^embedded::/, '');
            const sourcePath = _resolveCardFilePath(realCardId);
            if (!sourcePath || !_isFile(sourcePath)) {
                return { ok: false, msg: `源文件不存在: ${realCardId}` };
            }
            const filename = path.basename(sourcePath);
            return {
                ok: true,
                snapshotType: 'card',
                sourcePath,
                filename,
                targetDir: path.join(backupsRoot, 'cards', _snapshotDirNameFromFilename(filename)),
                targetId: realCardId,
            };
        }
        const sourcePath = _resolveWorldInfoPath(filePath || targetId);
        if (!sourcePath || !_isFile(sourcePath)) {
            return { ok: false, msg: `源文件不存在: ${filePath || targetId}` };
        }
        const filename = path.basename(sourcePath);
        return {
            ok: true,
            snapshotType: 'lorebook',
            sourcePath,
            filename,
            targetDir: path.join(backupsRoot, 'lorebooks', _snapshotDirNameFromFilename(filename)),
            targetId,
        };
    }

    const sourcePath = _resolveCardFilePath(targetId);
    if (!sourcePath || !_isFile(sourcePath)) {
        return { ok: false, msg: `源文件不存在: ${targetId}` };
    }
    const filename = path.basename(sourcePath);
    return {
        ok: true,
        snapshotType: 'card',
        sourcePath,
        filename,
        targetDir: path.join(backupsRoot, 'cards', _snapshotDirNameFromFilename(filename)),
        targetId,
    };
}

function _cleanupSnapshots(targetDir, limit, mode = 'manual') {
    if (!fs.existsSync(targetDir)) return;
    const maxKeep = Math.max(1, Number(limit) || (mode === 'auto' ? 5 : 20));
    let files = [];
    try {
        files = fs.readdirSync(targetDir)
            .filter(name => {
                const low = name.toLowerCase();
                if (!low.endsWith('.json') && !low.endsWith('.png')) return false;
                if (mode === 'auto') return name.includes('__AUTO__');
                return !name.includes('__AUTO__');
            })
            .map(name => {
                const fullPath = path.join(targetDir, name);
                let mtime = 0;
                try {
                    mtime = fs.statSync(fullPath).mtimeMs || 0;
                } catch (e) {
                    mtime = 0;
                }
                return { name, fullPath, mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);
    } catch (e) {
        return;
    }
    for (let i = maxKeep; i < files.length; i++) {
        try {
            fs.unlinkSync(files[i].fullPath);
        } catch (e) {
            // ignore cleanup failures
        }
    }
}

function _detectResourceCategory(filename, contentBuffer) {
    const ext = path.extname(filename).toLowerCase();
    let category = '';
    let isLorebook = false;
    let isPreset = false;

    if (ext === '.json') {
        try {
            const parsed = JSON.parse(contentBuffer.toString('utf-8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if ('findRegex' in parsed || 'regex' in parsed || 'scriptName' in parsed) {
                    category = _getResourceSubDirMap().regex;
                } else if (parsed.type === 'script' || 'scripts' in parsed) {
                    category = _getResourceSubDirMap().scripts;
                } else if ('entries' in parsed) {
                    category = _getResourceSubDirMap().lorebooks;
                    isLorebook = true;
                } else if ('qrList' in parsed) {
                    category = _getResourceSubDirMap().quick_replies;
                } else if (
                    'temperature' in parsed ||
                    'max_tokens' in parsed ||
                    'openai_max_tokens' in parsed ||
                    'max_length' in parsed ||
                    'prompt_order' in parsed ||
                    'prompts' in parsed
                ) {
                    category = _getResourceSubDirMap().presets;
                    isPreset = true;
                }
            } else if (Array.isArray(parsed) && parsed[0] === 'scripts') {
                category = _getResourceSubDirMap().scripts;
            } else if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0]?.keys || parsed[0]?.key)) {
                category = _getResourceSubDirMap().lorebooks;
                isLorebook = true;
            }
        } catch (e) {
            // non-json content keeps root category
        }
    }

    return { category, isLorebook, isPreset };
}

/**
 * 初始化 API 模块
 */
function initModules(modules) {
    cards = modules.cards;
    worldInfo = modules.worldInfo;
    presets = modules.presets;
    extensions = modules.extensions;
    automation = modules.automation;
    backup = modules.backup;
    config = modules.config;
    regex = modules.regex;
    resources = modules.resources;
}

/**
 * 注册所有 API 路由
 */
function registerRoutes(app, staticDir) {

    // ============ 系统 API ============

    // 服务器状态（前端轮询用）
    app.get('/api/status', (req, res) => {
        try {
            // 前端期望的格式：{ status: 'ready', message: '', progress: 0, total: 0 }
            const stats = resources ? resources.getStats() : {};
            res.json({
                status: 'ready',  // 服务器已就绪
                message: '资源库已就绪',
                progress: stats.characters || 0,
                total: stats.characters || 0,
                scanning: false,
                version: '2.0.0',
                mode: 'plugin',
                ...stats
            });
        } catch (e) {
            res.json({
                status: 'ready',
                message: '资源库已就绪',
                scanning: false,
                progress: 0,
                total: 0
            });
        }
    });

    // 获取设置
    app.get('/api/get_settings', (req, res) => {
        try {
            const cfg = config ? config.getConfig() : {};
            res.json(cfg);
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 保存设置
    app.post('/api/save_settings', (req, res) => {
        try {
            const newSettings = req.body;
            const result = config ? config.saveConfig(newSettings) : { success: true };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 立即扫描
    app.post('/api/scan_now', (req, res) => {
        try {
            if (resources && resources.rescan) {
                resources.rescan();
            }
            res.json({ success: true, message: '扫描已启动' });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 系统操作
    app.post('/api/system_action', (req, res) => {
        try {
            const { action, ...data } = req.body || {};

            switch (action) {
                case 'open_folder':
                    const requestedPath = data.path || _getPluginDataDir();
                    const normalized = _normalizeInputPath(requestedPath);
                    const allowedRoots = _getAllowedRoots();
                    if (!_isDir(normalized) || !_isPathAllowed(normalized, allowedRoots)) {
                        return res.json({ success: false, msg: '路径不在允许范围内' });
                    }

                    if (!_openFolder(normalized)) {
                        return res.json({ success: false, msg: '打开目录失败' });
                    }
                    res.json({ success: true });
                    break;
                case 'open_card_dir': {
                    const cardId = data.card_id;
                    const cardPath = _resolveCardFilePath(cardId);
                    if (!cardPath || !_isFile(cardPath)) {
                        return res.json({ success: false, msg: '卡片不存在' });
                    }
                    const targetDir = path.dirname(cardPath);
                    if (!_openFolder(targetDir)) {
                        return res.json({ success: false, msg: '打开目录失败' });
                    }
                    return res.json({ success: true });
                }
                case 'backup_data': {
                    const uiDataPath = config ? config.getUiDataPath() : null;
                    if (!uiDataPath || !fs.existsSync(uiDataPath)) {
                        return res.json({ success: false, msg: '未找到 UI 数据文件' });
                    }
                    const backupDir = path.join(_getSystemBackupsDir(), 'system');
                    _ensureDir(backupDir);
                    const ts = new Date().toISOString().replace(/[:.]/g, '-');
                    const targetPath = path.join(backupDir, `ui_data_${ts}.json`);
                    fs.copyFileSync(uiDataPath, targetPath);
                    return res.json({ success: true, msg: '备份完成', path: targetPath });
                }
                case 'open_notes': {
                    const notesDir = path.join(_getLibraryAssetsDir(), 'notes_images');
                    _ensureDir(notesDir);
                    if (!_openFolder(notesDir)) {
                        return res.json({ success: false, msg: '打开目录失败' });
                    }
                    return res.json({ success: true });
                }
                case 'refresh_cache':
                    if (resources && resources.rescan) {
                        resources.rescan();
                    }
                    res.json({ success: true });
                    break;
                default:
                    res.json({ success: true, message: `Unknown action: ${action}` });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 回收站
    app.post('/api/trash/open', (req, res) => {
        try {
            const trashPath = config ? config.getTrashPath() : null;
            if (trashPath && fs.existsSync(trashPath)) {
                if (_openFolder(trashPath)) {
                    res.json({ success: true });
                } else {
                    res.json({ success: false, msg: '打开目录失败' });
                }
            } else {
                res.json({ success: false, msg: '回收站目录不存在' });
            }
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // ============ 角色卡 API ============

    // 获取角色卡列表
    app.get('/api/list_cards', (req, res) => {
        try {
            const {
                page,
                page_size,
                category,
                tags,
                excluded_tags,
                excluded_cats,
                search,
                search_type,
                sort,
                recursive,
                fav_filter,
                favorites_first,
            } = req.query;

            const pageNum = Math.max(1, parseInt(page) || 1);
            const pageSizeNum = Math.max(1, parseInt(page_size) || 50);
            const normalizedCategory = _sanitizeRelativeFolder(category || '');
            const recursiveEnabled = String(recursive) === 'true';
            const includeTags = String(tags || '').split('|||').map(s => s.trim()).filter(Boolean);
            const excludeTags = String(excluded_tags || '').split('|||').map(s => s.trim()).filter(Boolean);
            const excludeCats = String(excluded_cats || '').split('|||').map(s => _sanitizeRelativeFolder(s)).filter(Boolean);
            const searchText = String(search || '').trim().toLowerCase();
            const searchType = String(search_type || 'mix');
            const favFilter = String(fav_filter || 'none');
            const favFirst = String(favorites_first) === 'true';

            const uiData = config ? config.loadUiData() : {};
            const allItems = _getAllCardsForStats().map((item) => {
                const id = item.id;
                const uiKey = _resolveUiKey(uiData, id);
                const ui = uiData[uiKey] || {};
                const categoryPath = _sanitizeRelativeFolder(item.folder || '');
                return {
                    id,
                    filename: item.filename,
                    char_name: item.name || path.basename(item.filename || '', path.extname(item.filename || '')),
                    description: item.description || '',
                    tags: Array.isArray(item.tags) ? item.tags : [],
                    creator: item.creator || '',
                    category: categoryPath,
                    token_count: Number(item.token_count) || 0,
                    file_size: Number(item.size) || 0,
                    last_modified: Math.floor((Number(item.mtime) || 0) / 1000),
                    image_url: item.image_url || `/cards_file/${encodeURIComponent(id)}`,
                    thumb_url: item.thumb_url || `/api/thumbnail/${encodeURIComponent(id)}`,
                    has_worldbook: Boolean(item.hasWorldbook),
                    has_regex: Boolean(item.hasRegex),
                    has_scripts: Boolean(item.hasScripts),
                    char_version: item.version || '',
                    ui_summary: ui.summary || '',
                    source_link: ui.link || '',
                    resource_folder: ui.resource_folder || '',
                    is_favorite: Boolean(ui.is_favorite),
                    is_bundle: Boolean(item.is_bundle),
                };
            });

            const filtered = allItems.filter((item) => {
                if (normalizedCategory) {
                    if (recursiveEnabled) {
                        if (!(item.category === normalizedCategory || item.category.startsWith(`${normalizedCategory}/`))) {
                            return false;
                        }
                    } else if (item.category !== normalizedCategory) {
                        return false;
                    }
                }

                if (excludeCats.length) {
                    for (const blocked of excludeCats) {
                        if (!blocked) continue;
                        if (item.category === blocked || item.category.startsWith(`${blocked}/`)) {
                            return false;
                        }
                    }
                }

                if (includeTags.length) {
                    if (!includeTags.every(tag => item.tags.includes(tag))) return false;
                }
                if (excludeTags.length) {
                    if (excludeTags.some(tag => item.tags.includes(tag))) return false;
                }

                if (favFilter === 'included' && !item.is_favorite) return false;
                if (favFilter === 'excluded' && item.is_favorite) return false;

                if (searchText) {
                    const hayName = (item.char_name || '').toLowerCase();
                    const hayFilename = (item.filename || '').toLowerCase();
                    const hayCreator = (item.creator || '').toLowerCase();
                    const haySummary = (item.ui_summary || '').toLowerCase();
                    const hayTags = (item.tags || []).map(v => String(v).toLowerCase());
                    if (searchType === 'name') {
                        if (!hayName.includes(searchText)) return false;
                    } else if (searchType === 'filename') {
                        if (!hayFilename.includes(searchText)) return false;
                    } else if (searchType === 'tags') {
                        if (!hayTags.some(tag => tag.includes(searchText))) return false;
                    } else if (searchType === 'creator') {
                        if (!hayCreator.includes(searchText)) return false;
                    } else {
                        if (
                            !hayName.includes(searchText)
                            && !hayFilename.includes(searchText)
                            && !haySummary.includes(searchText)
                            && !hayTags.some(tag => tag.includes(searchText))
                        ) {
                            return false;
                        }
                    }
                }
                return true;
            });

            const sortMode = String(sort || 'date_desc');
            const sortFn = (a, b) => {
                if (sortMode === 'date_asc') return (a.last_modified || 0) - (b.last_modified || 0);
                if (sortMode === 'date_desc') return (b.last_modified || 0) - (a.last_modified || 0);
                if (sortMode === 'name_asc') return String(a.char_name || '').localeCompare(String(b.char_name || ''), 'zh-CN');
                if (sortMode === 'name_desc') return String(b.char_name || '').localeCompare(String(a.char_name || ''), 'zh-CN');
                if (sortMode === 'token_asc') return (a.token_count || 0) - (b.token_count || 0);
                if (sortMode === 'token_desc') return (b.token_count || 0) - (a.token_count || 0);
                return (b.last_modified || 0) - (a.last_modified || 0);
            };

            filtered.sort((a, b) => {
                if (favFirst && a.is_favorite !== b.is_favorite) {
                    return a.is_favorite ? -1 : 1;
                }
                return sortFn(a, b);
            });

            const totalCount = filtered.length;
            const start = (pageNum - 1) * pageSizeNum;
            const cardsPage = filtered.slice(start, start + pageSizeNum);

            const allCategories = new Set();
            for (const item of allItems) {
                if (!item.category) continue;
                const parts = item.category.split('/');
                let current = '';
                for (const part of parts) {
                    current = current ? `${current}/${part}` : part;
                    allCategories.add(current);
                }
            }

            const tagSet = new Set();
            for (const item of allItems) {
                for (const tag of item.tags || []) {
                    if (tag) tagSet.add(tag);
                }
            }

            res.json({
                success: true,
                cards: cardsPage,
                total_count: totalCount,
                total: totalCount,
                page: pageNum,
                page_size: pageSizeNum,
                total_pages: Math.ceil(totalCount / pageSizeNum) || 1,
                all_folders: Array.from(allCategories).sort((a, b) => a.localeCompare(b, 'zh-CN')),
                categories: Array.from(allCategories).sort((a, b) => a.localeCompare(b, 'zh-CN')),
                category_counts: _buildCategoryCounts(allItems),
                global_tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-CN')),
                sidebar_tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-CN')),
                library_total: allItems.length,
            });
        } catch (e) {
            console.error('[API] list_cards error:', e);
            res.json({ success: false, msg: e.message, cards: [], total: 0, total_count: 0 });
        }
    });

    // 获取原始元数据
    app.post('/api/get_raw_metadata', (req, res) => {
        try {
            const { id } = req.body || {};
            const card = cards.getCard(id);
            if (card) {
                res.json({ success: true, data: card.rawData || card });
            } else {
                res.json({ success: false, error: '卡片不存在' });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 获取角色卡详情 - 复刻 Python 后端格式
    app.post('/api/get_card_detail', (req, res) => {
        try {
            const { id, preview_wi, force_full_wi, wi_preview_limit, wi_preview_entry_max_chars } = req.body || {};
            const rawCard = cards.getCard(id);

            if (!rawCard) {
                return res.json({ success: false, error: '卡片不存在' });
            }

            // 解析数据块 - 兼容 V2/V3 格式
            const cardData = rawCard.data || {};
            const dataBlock = cardData.data || cardData;
            const extensions = dataBlock.extensions || {};

            // 构造扁平化的卡片对象 (匹配 Python 后端格式)
            const card = {
                id: id,
                filename: path.basename(id),
                char_name: dataBlock.name || '',
                description: dataBlock.description || '',
                first_mes: dataBlock.first_mes || '',
                alternate_greetings: dataBlock.alternate_greetings || [],
                mes_example: dataBlock.mes_example || '',
                creator_notes: dataBlock.creator_notes || '',
                personality: dataBlock.personality || '',
                scenario: dataBlock.scenario || '',
                system_prompt: dataBlock.system_prompt || '',
                post_history_instructions: dataBlock.post_history_instructions || '',
                character_book: dataBlock.character_book || null,
                extensions: extensions,
                tags: dataBlock.tags || [],
                category: id.includes('/') ? id.substring(0, id.lastIndexOf('/')) : '',
                creator: dataBlock.creator || '',
                char_version: dataBlock.character_version || '',
                image_url: `/api/thumbnail/${encodeURIComponent(id)}`,
                thumb_url: `/api/thumbnail/${encodeURIComponent(id)}`,
            };

            // UI 数据
            const uiData = config ? config.loadUiData() : {};
            const uiKey = _resolveUiKey(uiData, id);
            const uiInfo = uiData[uiKey] || {};
            card.ui_summary = uiInfo.summary || '';
            card.source_link = uiInfo.link || '';
            card.resource_folder = uiInfo.resource_folder || '';

            res.json({
                success: true,
                card: card,
                ui_data: uiInfo,
            });
        } catch (e) {
            console.error('[ST Manager] get_card_detail 错误:', e);
            res.json({ success: false, error: e.message });
        }
    });

    // 更新角色卡
    app.post('/api/update_card', (req, res) => {
        try {
            const payload = req.body || {};
            if (cards && typeof cards.updateCard === 'function') {
                const result = cards.updateCard(payload.id, payload);
                return res.json(result);
            }
            const cardId = payload.id;
            if (!cardId) {
                return res.json({ success: false, msg: '缺少卡片 ID' });
            }
            const card = cards.getCard(cardId);
            if (!card || !card.path || !_isFile(card.path)) {
                return res.json({ success: false, msg: '卡片不存在' });
            }
            const ext = path.extname(card.path).toLowerCase();
            if (ext !== '.json') {
                return res.json({ success: false, msg: '当前版本暂不支持直接写回 PNG 卡片' });
            }
            const raw = card.data || {};
            const isWrapped = Boolean(raw && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data));
            const base = isWrapped ? { ...raw } : { ...raw };
            const dataBlock = isWrapped ? { ...(raw.data || {}) } : { ...(raw || {}) };

            const fieldMap = {
                char_name: 'name',
                description: 'description',
                first_mes: 'first_mes',
                mes_example: 'mes_example',
                creator_notes: 'creator_notes',
                personality: 'personality',
                scenario: 'scenario',
                system_prompt: 'system_prompt',
                post_history_instructions: 'post_history_instructions',
                creator: 'creator',
                char_version: 'character_version',
                character_version: 'character_version',
            };
            for (const [from, to] of Object.entries(fieldMap)) {
                if (payload[from] !== undefined) {
                    dataBlock[to] = payload[from];
                }
            }
            if (Array.isArray(payload.alternate_greetings)) {
                dataBlock.alternate_greetings = payload.alternate_greetings;
            }
            if (Array.isArray(payload.tags)) {
                dataBlock.tags = payload.tags;
            }
            if (payload.extensions && typeof payload.extensions === 'object') {
                dataBlock.extensions = payload.extensions;
            }
            if (payload.character_book !== undefined) {
                dataBlock.character_book = payload.character_book;
            }
            if (typeof payload.character_book_raw === 'string' && payload.character_book_raw.trim()) {
                try {
                    dataBlock.character_book = JSON.parse(payload.character_book_raw);
                } catch (e) {
                    return res.json({ success: false, msg: '世界书 JSON 格式错误' });
                }
            }

            if (isWrapped) {
                base.data = dataBlock;
            } else {
                Object.assign(base, dataBlock);
            }
            fs.writeFileSync(card.path, JSON.stringify(base, null, 2), 'utf-8');

            if (config) {
                const uiData = config.loadUiData();
                const uiKey = _resolveUiKey(uiData, cardId);
                if (!uiData[uiKey] || typeof uiData[uiKey] !== 'object') {
                    uiData[uiKey] = {};
                }
                if (payload.ui_summary !== undefined) uiData[uiKey].summary = payload.ui_summary;
                if (payload.source_link !== undefined) uiData[uiKey].link = payload.source_link;
                if (payload.resource_folder !== undefined) uiData[uiKey].resource_folder = _sanitizeRelativeFolder(payload.resource_folder || '');
                config.saveUiData(uiData);
            }

            const display = {
                id: cardId,
                char_name: dataBlock.name || '',
                category: cardId.includes('/') ? cardId.slice(0, cardId.lastIndexOf('/')) : '',
                filename: path.basename(cardId),
            };
            res.json({ success: true, updated_card: display });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 切换收藏
    app.post('/api/toggle_favorite', (req, res) => {
        try {
            const { id } = req.body || {};
            if (!id) {
                return res.json({ success: false, msg: '缺少卡片 ID' });
            }
            if (cards.toggleFavorite) {
                const result = cards.toggleFavorite(id);
                return res.json(result);
            }
            if (!config) return res.json({ success: false, msg: '配置模块未初始化' });
            const uiData = config.loadUiData();
            const uiKey = _resolveUiKey(uiData, id);
            if (!uiData[uiKey] || typeof uiData[uiKey] !== 'object') {
                uiData[uiKey] = {};
            }
            uiData[uiKey].is_favorite = !Boolean(uiData[uiKey].is_favorite);
            config.saveUiData(uiData);
            res.json({ success: true, is_favorite: Boolean(uiData[uiKey].is_favorite) });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 移动卡片
    app.post('/api/move_card', (req, res) => {
        try {
            const { card_ids, target_category } = req.body || {};
            const ids = Array.isArray(card_ids) ? card_ids : [card_ids];
            let successCount = 0;
            const errors = [];

            for (const id of ids) {
                try {
                    const result = cards.moveCard(id, target_category);
                    if (result.success) successCount++;
                    else errors.push(result.error);
                } catch (e) {
                    errors.push(e.message);
                }
            }

            res.json({
                success: successCount > 0,
                moved: successCount,
                total: ids.length,
                category_counts: _buildCategoryCounts(_getAllCardsForStats()),
                errors: errors.length > 0 ? errors : undefined,
                msg: errors.length > 0 ? errors.join('; ') : '',
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 删除角色卡
    app.post('/api/delete_cards', (req, res) => {
        try {
            const { card_ids, delete_resources } = req.body || {};
            const ids = (Array.isArray(card_ids) ? card_ids : [card_ids]).filter(Boolean);
            if (ids.length === 0) {
                return res.json({ success: false, msg: '未提供卡片 ID' });
            }
            const shouldDeleteResources = Boolean(delete_resources);
            let successCount = 0;
            let resourceDeleted = 0;
            const resourceErrors = [];
            const deleteErrors = [];

            const movedResourceFolders = new Set();

            for (const id of ids) {
                const binding = _resolveCardResourceBinding(id);
                const result = cards.deleteCard(id, true);
                if (result.success) {
                    successCount++;
                } else {
                    deleteErrors.push(`${id}: ${result.error || '删除失败'}`);
                }

                if (shouldDeleteResources && binding.folder && binding.fullPath && binding.exists) {
                    if (movedResourceFolders.has(binding.fullPath)) {
                        continue;
                    }
                    movedResourceFolders.add(binding.fullPath);
                    const moveResult = _movePathToTrash(binding.fullPath, { prefix: 'resource' });
                    if (moveResult.success) {
                        resourceDeleted++;
                    } else {
                        resourceErrors.push(`${binding.folder}: ${moveResult.error || '移动失败'}`);
                    }
                }
            }

            res.json({
                success: successCount > 0,
                deleted: successCount,
                total: ids.length,
                deleted_resources: resourceDeleted,
                resource_errors: resourceErrors.length ? resourceErrors : undefined,
                errors: deleteErrors.length ? deleteErrors : undefined,
            });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    app.post('/api/trash/empty', (req, res) => {
        try {
            const trashPath = config ? config.getTrashPath() : null;
            if (!trashPath) {
                return res.json({ success: false, msg: '回收站路径不可用' });
            }
            _ensureDir(trashPath);
            const files = fs.readdirSync(trashPath);
            for (const name of files) {
                const fullPath = resolveInside(trashPath, name);
                if (!fullPath || !fs.existsSync(fullPath)) continue;
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        fs.rmSync(fullPath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(fullPath);
                    }
                } catch (e) {
                    // continue removing remaining entries
                }
            }
            res.json({ success: true, msg: '回收站已清空' });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 检查资源目录
    app.post('/api/check_resource_folders', (req, res) => {
        try {
            const { card_ids } = req.body || {};
            const ids = (Array.isArray(card_ids) ? card_ids : [card_ids]).filter(Boolean);
            const results = {};
            const resourceFolders = [];

            for (const id of ids) {
                const binding = _resolveCardResourceBinding(id);
                results[id] = {
                    has_folder: Boolean(binding.folder),
                    path: binding.fullPath || null,
                };

                if (binding.folder) {
                    resourceFolders.push({
                        card_id: id,
                        card_name: _getCardDisplayName(id),
                        resource_folder: binding.folder,
                        path: binding.fullPath || null,
                        exists: binding.exists,
                    });
                }
            }

            res.json({
                success: true,
                results,
                has_resources: resourceFolders.length > 0,
                resource_folders: resourceFolders,
            });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 随机卡片
    app.post('/api/random_card', (req, res) => {
        try {
            const params = req.body || {};
            const result = cards.listCards({
                folder: params.category,
                tags: params.tags ? params.tags.split(',') : undefined,
                search: params.search,
                pageSize: 1000,
            });

            const pool = result.items || [];
            if (pool.length > 0) {
                const randomIndex = Math.floor(Math.random() * pool.length);
                res.json({ success: true, card: pool[randomIndex] });
            } else {
                res.json({ success: false, error: '没有找到卡片' });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 发送到 SillyTavern
    app.post('/api/send_to_st', (req, res) => {
        try {
            const { card_id } = req.body || {};
            // 在插件模式下，这个功能通过前端扩展实现
            res.json({ success: true, message: '请使用扩展面板发送到酒馆' });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 从 URL 导入
    app.post('/api/import_from_url', (req, res) => {
        try {
            const { url, category } = req.body || {};
            const result = cards.importFromUrl ? cards.importFromUrl(url, category) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 更换头像 (FormData)
    app.post('/api/change_image', (req, res) => {
        try {
            // FormData 处理需要 multer 中间件
            res.json({ success: false, error: '需要 multer 中间件' });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 更新卡片文件
    app.post('/api/update_card_file', (req, res) => {
        try {
            res.json({ success: false, error: '需要 multer 中间件' });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 从 URL 更新卡片
    app.post('/api/update_card_from_url', (req, res) => {
        try {
            const payload = req.body || {};
            const result = cards.updateFromUrl ? cards.updateFromUrl(payload) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 转换为聚合包
    app.post('/api/convert_to_bundle', (req, res) => {
        try {
            const { card_id, bundle_name } = req.body || {};
            const result = cards.convertToBundle ? cards.convertToBundle(card_id, bundle_name) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 切换聚合模式
    app.post('/api/toggle_bundle_mode', (req, res) => {
        try {
            const { folder_path, action } = req.body || {};
            const result = cards.toggleBundleMode ? cards.toggleBundleMode(folder_path, action) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 定位卡片页码
    app.post('/api/find_card_page', (req, res) => {
        try {
            const { card_id, category, sort, page_size } = req.body || {};
            const result = cards.findCardPage ? cards.findCardPage(card_id, { category, sort, pageSize: page_size }) : { success: true, page: 1 };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 创建文件夹
    app.post('/api/create_folder', (req, res) => {
        try {
            const { folder_path, name, parent } = req.body || {};
            let targetPath = folder_path;
            if (!targetPath && name !== undefined) {
                const safeName = _sanitizeFolderSegment(name);
                const normalizedParent = _sanitizeRelativeFolder(parent || '');
                targetPath = normalizedParent ? `${normalizedParent}/${safeName}` : safeName;
            }
            const result = cards.createFolder(targetPath);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 重命名文件夹
    app.post('/api/rename_folder', (req, res) => {
        try {
            const { old_path, new_name } = req.body || {};
            const result = cards.renameFolder(old_path, new_name);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 删除文件夹
    app.post('/api/delete_folder', (req, res) => {
        try {
            const { folder_path, recursive } = req.body || {};
            const result = cards.deleteFolder(folder_path, recursive);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    app.post('/api/move_folder', (req, res) => {
        try {
            const { source_path, target_parent_path, merge_if_exists } = req.body || {};
            const source = _sanitizeRelativeFolder(source_path || '');
            const targetParent = _sanitizeRelativeFolder(target_parent_path || '');
            if (!source) {
                return res.json({ success: false, msg: '源路径不能为空' });
            }

            const charactersDir = _getLibraryCharactersDir();
            const sourceAbs = resolveInside(charactersDir, source);
            if (!sourceAbs || !_isDir(sourceAbs)) {
                return res.json({ success: false, msg: '源文件夹不存在' });
            }

            const sourceName = path.basename(sourceAbs);
            const targetBase = targetParent ? resolveInside(charactersDir, targetParent) : charactersDir;
            if (!targetBase || !_isDir(targetBase)) {
                return res.json({ success: false, msg: '目标路径不存在' });
            }
            const targetAbs = path.join(targetBase, sourceName);
            const sourceNorm = path.resolve(path.normalize(sourceAbs));
            const targetBaseNorm = path.resolve(path.normalize(targetBase));
            if (targetBaseNorm === sourceNorm || targetBaseNorm.startsWith(`${sourceNorm}${path.sep}`)) {
                return res.json({ success: false, msg: '无法将文件夹移动到其子目录中' });
            }

            const newPathPrefix = targetParent ? `${targetParent}/${sourceName}` : sourceName;

            if (!fs.existsSync(targetAbs)) {
                fs.renameSync(sourceAbs, targetAbs);
                if (config) {
                    const uiData = config.loadUiData();
                    const updates = {};
                    for (const [key, value] of Object.entries(uiData)) {
                        if (key === source || key.startsWith(`${source}/`)) {
                            const nextKey = key === source ? newPathPrefix : `${newPathPrefix}${key.slice(source.length)}`;
                            updates[nextKey] = value;
                            delete uiData[key];
                        }
                    }
                    Object.assign(uiData, updates);
                    config.saveUiData(uiData);
                }
                return res.json({
                    success: true,
                    new_path: newPathPrefix,
                    mode: 'move',
                    category_counts: _buildCategoryCounts(_getAllCardsForStats()),
                });
            }

            if (!merge_if_exists) {
                return res.json({ success: false, msg: '目标位置已存在同名文件夹', needs_merge: true });
            }

            const mergeDir = (srcDir, dstDir) => {
                _ensureDir(dstDir);
                const entries = fs.readdirSync(srcDir, { withFileTypes: true });
                for (const entry of entries) {
                    const srcEntry = path.join(srcDir, entry.name);
                    const dstEntry = path.join(dstDir, entry.name);
                    if (entry.isDirectory()) {
                        mergeDir(srcEntry, dstEntry);
                        continue;
                    }
                    let finalTarget = dstEntry;
                    if (fs.existsSync(finalTarget)) {
                        const ext = path.extname(entry.name);
                        const base = path.basename(entry.name, ext);
                        let index = 1;
                        while (fs.existsSync(finalTarget)) {
                            finalTarget = path.join(dstDir, `${base}_${index}${ext}`);
                            index += 1;
                        }
                    }
                    fs.renameSync(srcEntry, finalTarget);
                }
            };

            mergeDir(sourceAbs, targetAbs);
            try {
                fs.rmSync(sourceAbs, { recursive: true, force: true });
            } catch (e) {
                // ignore cleanup errors
            }
            res.json({
                success: true,
                new_path: newPathPrefix,
                mode: 'merge_reload',
                category_counts: _buildCategoryCounts(_getAllCardsForStats()),
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // ============ 标签 API ============

    // 获取所有标签
    app.get('/api/tags', (req, res) => {
        try {
            const tags = cards.getAllTags ? cards.getAllTags() : [];
            res.json({ success: true, tags });
        } catch (e) {
            res.json({ success: false, error: e.message, tags: [] });
        }
    });

    // 批量标签操作
    app.post('/api/batch_tags', (req, res) => {
        try {
            const { card_ids, add_tags, remove_tags, add, remove } = req.body || {};
            const addTags = Array.isArray(add_tags) ? add_tags : (Array.isArray(add) ? add : []);
            const removeTags = Array.isArray(remove_tags) ? remove_tags : (Array.isArray(remove) ? remove : []);
            let result = { success: true };

            if (addTags.length > 0) {
                result = cards.addTags(card_ids, addTags);
            }
            if (removeTags.length > 0) {
                result = cards.removeTags(card_ids, removeTags);
            }

            const updated = Array.isArray(result.results) ? result.results.filter(item => item && item.success).length : 0;
            res.json({
                ...result,
                updated,
                msg: result.error || result.message || '',
            });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 删除标签
    app.post('/api/delete_tags', (req, res) => {
        try {
            const { card_ids, tags, category } = req.body || {};
            const normalizedTags = Array.isArray(tags) ? tags : [];
            if (!normalizedTags.length) {
                return res.json({ success: false, msg: '缺少标签参数' });
            }
            let targetIds = Array.isArray(card_ids) ? card_ids.filter(Boolean) : [];
            if (!targetIds.length && category !== undefined) {
                const allCards = _getAllCardsForStats();
                const normalizedCategory = _sanitizeRelativeFolder(category || '');
                targetIds = allCards
                    .filter(item => {
                        const folder = _sanitizeRelativeFolder(item.folder || '');
                        if (!normalizedCategory) return true;
                        return folder === normalizedCategory || folder.startsWith(`${normalizedCategory}/`);
                    })
                    .map(item => item.id);
            }
            if (!targetIds.length) {
                return res.json({ success: true, updated_cards: 0, total_tags_deleted: 0, msg: '没有匹配的卡片' });
            }
            const result = cards.removeTags(targetIds, normalizedTags);
            const updatedCards = Array.isArray(result.results) ? result.results.filter(item => item && item.success).length : 0;
            res.json({
                ...result,
                updated_cards: updatedCards,
                total_tags_deleted: normalizedTags.length,
                msg: result.error || result.message || '',
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // ============ 世界书 API ============

    // 获取世界书列表
    app.get('/api/world_info/list', (req, res) => {
        try {
            const { search, type, page, page_size } = req.query;
            const result = worldInfo.listWorldbooks(
                type || 'all',
                search || '',
                parseInt(page) || 1,
                parseInt(page_size) || 50
            );

            res.json({
                success: true,
                items: result.items || [],
                total: result.total || 0,
                page: result.page || 1,
                page_size: result.pageSize || 50,
            });
        } catch (e) {
            res.json({ success: false, error: e.message, items: [], total: 0 });
        }
    });

    // 获取世界书详情 - 复刻 Python 后端逻辑
    app.post('/api/world_info/detail', (req, res) => {
        try {
            const { id, source_type, file_path, preview_limit, force_full } = req.body || {};
            console.log('[ST Manager] world_info/detail 请求:', { id, source_type, file_path });

            if (!file_path && !id) {
                return res.json({ success: false, msg: '文件路径为空' });
            }

            // 获取基础目录
            const pluginDataDir = config ? config.getPluginDataDir() : path.join(__dirname, '..', '..', 'data');
            const libraryRoot = path.join(pluginDataDir, 'library');

            // 解析文件路径
            let fullPath = file_path;
            if (file_path && !path.isAbsolute(file_path)) {
                // 相对路径，基于 library 目录
                fullPath = path.join(libraryRoot, file_path);
            } else if (id && !file_path) {
                // 使用 id 解析（兼容旧逻辑）
                const wb = worldInfo.getWorldbook(id);
                if (wb) {
                    return res.json({ success: true, data: wb.data });
                }
                return res.json({ success: false, msg: '世界书不存在' });
            }

            fullPath = path.resolve(path.normalize(fullPath));
            console.log('[ST Manager] 解析后的路径:', fullPath);

            if (!isPathInside(libraryRoot, fullPath)) {
                return res.json({ success: false, msg: '非法路径' });
            }

            if (!fs.existsSync(fullPath)) {
                console.log('[ST Manager] 文件不存在:', fullPath);
                return res.json({ success: false, msg: '文件不存在' });
            }

            // 直接读取文件
            const content = fs.readFileSync(fullPath, 'utf-8');
            let data = JSON.parse(content);

            // 预览模式处理（条目过多时截断）
            let truncated = false;
            let truncatedContent = false;
            let totalEntries = 0;
            let appliedLimit = 0;

            const countEntries = (raw) => {
                if (Array.isArray(raw)) return raw.length;
                if (raw && typeof raw === 'object') {
                    const entries = raw.entries;
                    if (Array.isArray(entries)) return entries.length;
                    if (entries && typeof entries === 'object') return Object.keys(entries).length;
                }
                return 0;
            };

            const sliceEntries = (raw, limit) => {
                if (Array.isArray(raw)) return raw.slice(0, limit);
                if (raw && typeof raw === 'object') {
                    const entries = raw.entries;
                    if (Array.isArray(entries)) {
                        return { ...raw, entries: entries.slice(0, limit) };
                    }
                    if (entries && typeof entries === 'object') {
                        const keys = Object.keys(entries);
                        try { keys.sort((a, b) => parseInt(a) - parseInt(b)); } catch (e) { keys.sort(); }
                        const trimmed = {};
                        keys.slice(0, limit).forEach(k => trimmed[k] = entries[k]);
                        return { ...raw, entries: trimmed };
                    }
                }
                return raw;
            };

            // 应用预览限制
            const limitVal = parseInt(preview_limit) || 300;
            if (!force_full && limitVal > 0) {
                totalEntries = countEntries(data);
                if (totalEntries > limitVal) {
                    data = sliceEntries(data, limitVal);
                    truncated = true;
                    appliedLimit = limitVal;
                }
            }

            console.log('[ST Manager] 返回世界书数据, entries数量:', countEntries(data));

            const resp = { success: true, data };
            if (truncated) {
                resp.truncated = true;
                resp.total_entries = totalEntries;
                resp.preview_limit = appliedLimit;
            }
            if (truncatedContent) {
                resp.truncated_content = true;
            }
            res.json(resp);
        } catch (e) {
            console.error('[ST Manager] world_info/detail 错误:', e);
            res.json({ success: false, msg: e.message });
        }
    });

    // 保存世界书
    app.post('/api/world_info/save', (req, res) => {
        try {
            const { save_mode, file_path, content, compact, name } = req.body || {};
            if (save_mode === 'new_global') {
                const pluginDataDir = config ? config.getPluginDataDir() : path.join(__dirname, '..', '..', 'data');
                const lorebooksDir = path.join(pluginDataDir, 'library', 'lorebooks');
                if (!fs.existsSync(lorebooksDir)) {
                    fs.mkdirSync(lorebooksDir, { recursive: true });
                }

                const baseName = String(name || 'New Worldbook').trim().replace(/[\\/*?:"<>|]/g, '_') || 'New Worldbook';
                let finalName = `${baseName}.json`;
                let counter = 1;
                while (fs.existsSync(path.join(lorebooksDir, finalName))) {
                    finalName = `${baseName}_${counter}.json`;
                    counter++;
                }

                const targetPath = resolveInside(lorebooksDir, finalName);
                if (!targetPath) {
                    return res.json({ success: false, msg: '非法目标路径' });
                }

                const indent = compact ? 0 : 2;
                fs.writeFileSync(targetPath, JSON.stringify(content || {}, null, indent), 'utf-8');
                return res.json({
                    success: true,
                    msg: '世界书已保存',
                    file_path: `lorebooks/${path.basename(targetPath)}`,
                    worldbook_id: `global::${path.basename(targetPath)}`,
                });
            }

            const result = worldInfo.saveWorldbook(file_path, content);
            res.json({
                ...result,
                msg: result.message || result.error || '',
            });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 删除世界书
    app.post('/api/world_info/delete', (req, res) => {
        try {
            const { file_path } = req.body || {};
            const result = worldInfo.deleteWorldbook(file_path);
            res.json({
                ...result,
                msg: result.message || result.error || '',
            });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 上传世界书
    app.post('/api/upload_world_info', async (req, res) => {
        try {
            const { files } = await _parseMultipartForm(req, 30 * 1024 * 1024);
            const uploadFiles = _pickMultipartFiles(files, 'files');
            if (!uploadFiles.length) {
                return res.json({ success: false, msg: '未接收到文件' });
            }

            const lorebooksDir = path.join(_getLibraryRoot(), 'lorebooks');
            _ensureDir(lorebooksDir);
            let successCount = 0;
            const failedList = [];

            for (const file of uploadFiles) {
                const originalName = _sanitizeFileName(file.filename || 'worldbook.json');
                if (!originalName.toLowerCase().endsWith('.json')) {
                    failedList.push(`${originalName} (非JSON格式)`);
                    continue;
                }
                try {
                    JSON.parse(file.data.toString('utf-8'));
                } catch (e) {
                    failedList.push(`${originalName} (JSON解析失败)`);
                    continue;
                }

                const ext = path.extname(originalName);
                const base = path.basename(originalName, ext);
                let finalName = `${base}${ext}`;
                let finalPath = path.join(lorebooksDir, finalName);
                let index = 1;
                while (fs.existsSync(finalPath)) {
                    finalName = `${base}_${index}${ext}`;
                    finalPath = path.join(lorebooksDir, finalName);
                    index += 1;
                }
                fs.writeFileSync(finalPath, file.data);
                successCount += 1;
            }

            let msg = `成功上传 ${successCount} 个世界书。`;
            if (failedList.length) {
                msg += ` 失败/跳过: ${failedList.join(', ')}`;
            }
            res.json({ success: true, count: successCount, msg });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/tools/migrate_lorebooks', (req, res) => {
        try {
            const resourcesRoot = _getLibraryResourcesDir();
            if (!fs.existsSync(resourcesRoot)) {
                return res.json({ success: true, count: 0 });
            }
            let movedCount = 0;
            const folders = fs.readdirSync(resourcesRoot);
            for (const folder of folders) {
                const folderPath = resolveInside(resourcesRoot, folder);
                if (!folderPath || !_isDir(folderPath)) continue;
                const files = fs.readdirSync(folderPath);
                for (const file of files) {
                    if (!file.toLowerCase().endsWith('.json')) continue;
                    const srcPath = resolveInside(folderPath, file);
                    if (!srcPath || !_isFile(srcPath)) continue;
                    let parsed = null;
                    try {
                        parsed = JSON.parse(fs.readFileSync(srcPath, 'utf-8'));
                    } catch (e) {
                        continue;
                    }
                    let isLorebook = false;
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'entries' in parsed) {
                        isLorebook = true;
                    } else if (Array.isArray(parsed) && parsed.length > 0) {
                        const first = parsed[0];
                        if (first && typeof first === 'object' && ('keys' in first || 'key' in first)) {
                            isLorebook = true;
                        }
                    }
                    if (!isLorebook) continue;

                    const lorebooksDir = resolveInside(folderPath, 'lorebooks');
                    if (!lorebooksDir) continue;
                    _ensureDir(lorebooksDir);
                    let targetPath = resolveInside(lorebooksDir, file);
                    if (!targetPath) continue;
                    if (fs.existsSync(targetPath)) {
                        const ext = path.extname(file);
                        const base = path.basename(file, ext);
                        targetPath = resolveInside(lorebooksDir, `${base}_${Date.now()}${ext}`);
                        if (!targetPath) continue;
                    }
                    fs.renameSync(srcPath, targetPath);
                    movedCount += 1;
                }
            }
            res.json({ success: true, count: movedCount });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/export_worldbook_single', (req, res) => {
        try {
            const cardId = _normalizeSlash((req.body || {}).card_id || '').trim();
            if (!cardId) {
                return res.json({ success: false, msg: '角色卡ID缺失' });
            }

            const card = cards && cards.getCard ? cards.getCard(cardId) : null;
            if (!card || !card.data) {
                return res.json({ success: false, msg: '未找到角色卡' });
            }

            const root = card.data.data && typeof card.data.data === 'object'
                ? card.data.data
                : card.data;
            const book = root.character_book;
            if (!book) {
                return res.json({ success: false, msg: '角色卡无世界书' });
            }

            let entriesRaw = [];
            if (Array.isArray(book)) {
                entriesRaw = book;
            } else if (book && typeof book === 'object') {
                if (Array.isArray(book.entries)) {
                    entriesRaw = book.entries;
                } else if (book.entries && typeof book.entries === 'object') {
                    entriesRaw = Object.values(book.entries);
                }
            }

            const exportEntries = {};
            for (let idx = 0; idx < entriesRaw.length; idx += 1) {
                const entry = (entriesRaw[idx] && typeof entriesRaw[idx] === 'object')
                    ? { ...entriesRaw[idx] }
                    : {};
                const normalized = { ...entry };
                normalized.uid = idx;
                normalized.displayIndex = idx;
                normalized.key = Array.isArray(entry.keys)
                    ? entry.keys
                    : (Array.isArray(entry.key) ? entry.key : []);
                normalized.keysecondary = Array.isArray(entry.secondary_keys)
                    ? entry.secondary_keys
                    : (Array.isArray(entry.keysecondary) ? entry.keysecondary : []);

                const enabled = (entry.enabled !== undefined)
                    ? Boolean(entry.enabled)
                    : !Boolean(entry.disable);
                normalized.disable = !enabled;
                if (entry.insertion_order !== undefined) {
                    normalized.order = entry.insertion_order;
                }

                delete normalized.enabled;
                delete normalized.keys;
                delete normalized.secondary_keys;
                delete normalized.insertion_order;
                exportEntries[String(idx)] = normalized;
            }

            const exportPayload = {
                ...(book && typeof book === 'object' ? book : {}),
                entries: exportEntries,
                name: (book && typeof book === 'object' && book.name)
                    ? book.name
                    : `${root.name || 'World Info'}`,
            };

            const safeBase = _sanitizeFileName(`${root.name || 'character'}_worldbook`);
            const filename = `${safeBase.replace(/\.json$/i, '')}.json`;
            const body = JSON.stringify(exportPayload, null, 2);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(body);
        } catch (e) {
            return res.json({ success: false, msg: e.message });
        }
    });

    app.get('/api/wi/clipboard/list', (req, res) => {
        try {
            const items = _sortClipboardItems(_readClipboardItems()).map(item => ({
                db_id: item.db_id,
                content: item.content,
                sort_order: item.sort_order || 0,
            }));
            res.json({ success: true, items });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/wi/clipboard/add', (req, res) => {
        try {
            const { entry, overwrite_id } = req.body || {};
            if (!entry || typeof entry !== 'object') {
                return res.json({ success: false, msg: '条目内容无效' });
            }
            const limit = 50;
            const items = _sortClipboardItems(_readClipboardItems());
            if (overwrite_id) {
                const idx = items.findIndex(item => String(item.db_id) === String(overwrite_id));
                if (idx >= 0) {
                    items[idx].content = entry;
                    items[idx].created_at = Date.now();
                    _writeClipboardItems(items);
                    return res.json({ success: true, msg: '已覆盖条目' });
                }
            }
            if (items.length >= limit) {
                return res.json({ success: false, code: 'FULL', msg: '剪切板已满' });
            }
            const maxOrder = items.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), -1);
            items.push({
                db_id: _makeClipboardId(),
                content: entry,
                sort_order: maxOrder + 1,
                created_at: Date.now(),
            });
            _writeClipboardItems(items);
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/wi/clipboard/delete', (req, res) => {
        try {
            const { db_id } = req.body || {};
            const items = _readClipboardItems().filter(item => String(item.db_id) !== String(db_id));
            _writeClipboardItems(items);
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/wi/clipboard/clear', (req, res) => {
        try {
            _writeClipboardItems([]);
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/wi/clipboard/reorder', (req, res) => {
        try {
            const orderMap = Array.isArray((req.body || {}).order_map) ? req.body.order_map : [];
            const rawItems = _readClipboardItems();
            const indexMap = new Map(orderMap.map((id, idx) => [String(id), idx]));
            const items = rawItems.map(item => ({
                ...item,
                sort_order: indexMap.has(String(item.db_id))
                    ? indexMap.get(String(item.db_id))
                    : (orderMap.length + (Number(item.sort_order) || 0)),
            }));
            _writeClipboardItems(items);
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // ============ 预设 API ============

    // 获取预设列表
    app.get('/api/presets/list', (req, res) => {
        try {
            const { type, filter_type, search, page, page_size } = req.query;
            const effectiveType = type || filter_type || 'all';
            const result = presets.listPresets({
                type: effectiveType === 'resource' ? 'all' : effectiveType,
                search: search || '',
                page: parseInt(page) || 1,
                pageSize: parseInt(page_size) || 50,
            });
            const items = Array.isArray(result.items) ? [...result.items] : [];
            if (effectiveType === 'all' || effectiveType === 'resource') {
                items.push(..._listResourcePresetItems(effectiveType, search || ''));
                items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
            }

            res.json({
                success: true,
                items: items,
                total: items.length,
            });
        } catch (e) {
            res.json({ success: false, error: e.message, items: [], total: 0 });
        }
    });

    // 获取预设详情
    app.get('/api/presets/detail/:id(*)', (req, res) => {
        try {
            const presetId = req.params.id;
            const preset = presets.getPreset(presetId);
            if (preset || String(presetId || '').startsWith('resource::')) {
                let presetData = preset;
                if (!presetData && String(presetId || '').startsWith('resource::')) {
                    const filePath = _resolvePresetFilePath(presetId);
                    if (!filePath || !_isFile(filePath)) {
                        return res.json({ success: false, msg: '预设不存在' });
                    }
                    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    const stat = fs.statSync(filePath);
                    const parts = String(presetId).split('::');
                    presetData = {
                        id: presetId,
                        filename: `${parts.slice(2).join('::')}.json`,
                        type: 'resource',
                        path: filePath,
                        mtime: stat.mtimeMs,
                        size: stat.size,
                        data: raw,
                        samplers: {},
                        regexScripts: ((raw.extensions || {}).regex_scripts || []),
                    };
                }
                // 前端期望 res.preset 包含完整预设数据
                // 需要构造与 Python 后端兼容的格式
                const presetResponse = {
                    id: presetData.id,
                    name: presetData.filename.replace('.json', ''),
                    filename: presetData.filename,
                    type: presetData.type,
                    path: presetData.path,
                    mtime: presetData.mtime,
                    file_size: presetData.size,
                    // 分组数据
                    samplers: presetData.samplers || {},
                    extensions: (presetData.data || {}).extensions || {},
                    // prompts 从原始数据提取
                    prompts: (presetData.data || {}).prompts || [],
                    // 原始数据
                    raw_data: presetData.data,
                    // 正则统计
                    regex_count: presetData.regexScripts ? presetData.regexScripts.length : 0,
                };
                res.json({ success: true, preset: presetResponse });
            } else {
                res.json({ success: false, msg: '预设不存在' });
            }
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/presets/upload', async (req, res) => {
        try {
            const { fields, files } = await _parseMultipartForm(req, 30 * 1024 * 1024);
            const targetType = fields.target_type || null;
            const uploadFiles = _pickMultipartFiles(files, 'files');
            if (!uploadFiles.length) {
                return res.json({ success: false, msg: '未接收到文件' });
            }
            let successCount = 0;
            const failedList = [];
            for (const file of uploadFiles) {
                const result = presets.uploadPreset(file.data, file.filename, targetType);
                if (result && result.success) {
                    successCount += 1;
                } else {
                    failedList.push(file.filename || 'unknown');
                }
            }
            let msg = `成功上传 ${successCount} 个预设文件。`;
            if (failedList.length) {
                msg += ` 失败/跳过: ${failedList.join(', ')}`;
            }
            res.json({ success: true, msg });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/presets/save', (req, res) => {
        try {
            const { id, content } = req.body || {};
            if (!id || content === undefined || content === null) {
                return res.json({ success: false, msg: '缺少必要参数' });
            }
            const filePath = _resolvePresetFilePath(id);
            if (!filePath) {
                return res.json({ success: false, msg: 'Invalid preset ID' });
            }
            _ensureDir(path.dirname(filePath));
            if (typeof content === 'string') {
                fs.writeFileSync(filePath, content, 'utf-8');
            } else {
                fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
            }
            res.json({ success: true, msg: '预设已保存' });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/presets/save-extensions', (req, res) => {
        try {
            const { id, extensions: extPayload } = req.body || {};
            if (!id || extPayload === undefined || extPayload === null || typeof extPayload !== 'object') {
                return res.json({ success: false, msg: '缺少必要参数' });
            }
            const filePath = _resolvePresetFilePath(id);
            if (!filePath || !_isFile(filePath)) {
                return res.json({ success: false, msg: '预设文件不存在' });
            }
            const presetData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (!presetData.extensions || typeof presetData.extensions !== 'object') {
                presetData.extensions = {};
            }
            for (const [key, value] of Object.entries(extPayload)) {
                presetData.extensions[key] = value;
            }
            fs.writeFileSync(filePath, JSON.stringify(presetData, null, 2), 'utf-8');
            res.json({ success: true, msg: '扩展已保存' });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/presets/delete', (req, res) => {
        try {
            const { id } = req.body || {};
            if (!id) return res.json({ success: false, msg: '缺少预设ID' });
            const filePath = _resolvePresetFilePath(id);
            if (!filePath) {
                return res.json({ success: false, msg: 'Invalid preset ID' });
            }
            if (!fs.existsSync(filePath)) {
                return res.json({ success: false, msg: '预设文件不存在' });
            }
            fs.unlinkSync(filePath);
            res.json({ success: true, msg: '预设已删除' });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // ============ 扩展 API ============

    // 获取扩展列表
    app.get('/api/extensions/list', (req, res) => {
        try {
            const { mode, filter_type, filterType, search } = req.query;
            console.log('[ST Manager] extensions/list 请求:', { mode, filter_type, filterType, search });

            const items = extensions.listExtensions(
                mode || 'regex',
                filter_type || filterType || 'all',
                (search || '').trim()
            );

            console.log('[ST Manager] extensions/list 结果:', items.length, '个项目');

            res.json({
                success: true,
                items: items || [],
                total: items.length || 0,
            });
        } catch (e) {
            console.error('[ST Manager] extensions/list 错误:', e);
            res.json({ success: false, error: e.message, items: [], total: 0 });
        }
    });

    // 读取文件内容 (用于扩展编辑器)
    app.post('/api/read_file_content', (req, res) => {
        try {
            const { path: filePath } = req.body || {};
            if (!filePath) {
                return res.json({ success: false, msg: '缺少文件路径' });
            }

            const normalizedPath = _resolveReadablePath(filePath);
            if (!normalizedPath || !_isPathAllowed(normalizedPath, _getAllowedRoots())) {
                return res.json({ success: false, msg: '非法路径' });
            }
            if (!fs.existsSync(normalizedPath)) {
                return res.json({ success: false, msg: '文件不存在' });
            }

            if (normalizedPath.toLowerCase().endsWith('.png')) {
                const parsed = _extractCardDataFromFile(normalizedPath);
                return res.json({ success: true, data: parsed ? parsed.raw : null });
            }

            const content = fs.readFileSync(normalizedPath, 'utf-8');
            try {
                const data = JSON.parse(content);
                res.json({ success: true, data });
            } catch (e) {
                res.json({ success: true, data: content, isRaw: true });
            }
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // ============ SillyTavern 本地目录探测/验证 ============

    // 自动探测 SillyTavern 安装路径 (使用 STClient)
    app.get('/api/st/detect_path', (req, res) => {
        try {
            const client = new STClient();
            const detected = client.detectStPath();

            if (detected) {
                const normalizedDetected = _normalizeStRoot(detected);
                // 收集资源信息
                const resources = {};
                const connection = client.testConnection();
                if (connection.local.resources) {
                    Object.assign(resources, connection.local.resources);
                }

                res.json({
                    success: true,
                    path: normalizedDetected,
                    valid: true,
                    resources: resources
                });
            } else {
                res.json({
                    success: true,
                    path: null,
                    valid: false,
                    message: '未能自动探测到 SillyTavern 安装路径，请手动配置',
                });
            }
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // 验证指定路径是否有效 (使用 STClient)
    app.post('/api/st/validate_path', (req, res) => {
        try {
            const rawPath = _normalizeInputPath((req.body || {}).path);
            if (!rawPath) {
                return res.status(400).json({ success: false, error: '请提供路径' });
            }

            const client = new STClient({ stDataDir: rawPath });
            const isValid = client._validateStPath(rawPath);
            let normalizedPath = isValid ? _normalizeStRoot(rawPath) : rawPath;
            if (!fs.existsSync(normalizedPath)) {
                normalizedPath = rawPath;
            }

            let resourcesInfo = {};
            if (isValid) {
                const connection = client.testConnection();
                if (connection.local.resources) {
                    resourcesInfo = connection.local.resources;
                }
            }

            res.json({
                success: true,
                valid: isValid,
                normalized_path: normalizedPath,
                resources: resourcesInfo,
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // 资源同步 - 从 SillyTavern 复制资源到本地 (使用 STClient 复刻 Python 后端)
    app.post('/api/st/sync', (req, res) => {
        try {
            const { resource_type, resource_ids, use_api, st_data_dir } = req.body || {};

            if (!resource_type) {
                return res.status(400).json({
                    success: false,
                    error: '请指定资源类型',
                    result: { success: 0, failed: 0 }
                });
            }

            // 创建 STClient 实例
            const stPathRaw = _normalizeInputPath(st_data_dir || '');
            const stPath = stPathRaw ? _normalizeStRoot(stPathRaw) : (config ? config.getDataRoot() : null);
            const client = new STClient({ stDataDir: stPath });

            // 获取目标目录 (复刻 Python 的配置映射)
            const pluginDataDir = config ? config.getPluginDataDir() : path.join(__dirname, '..', '..', 'data');
            const targetDirMap = {
                'characters': path.join(pluginDataDir, 'library', 'characters'),
                'worlds': path.join(pluginDataDir, 'library', 'lorebooks'),
                'presets': path.join(pluginDataDir, 'library', 'presets', 'OpenAI Settings'),
                'regex': path.join(pluginDataDir, 'library', 'extensions', 'regex'),
                'quick_replies': path.join(pluginDataDir, 'library', 'extensions', 'quick-replies'),
            };

            const targetDir = targetDirMap[resource_type];
            if (!targetDir) {
                return res.json({
                    success: false,
                    error: `未知资源类型: ${resource_type}`,
                    result: { success: 0, failed: 0 }
                });
            }

            // 确保目标目录存在
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            let result;
            if (resource_ids && resource_ids.length > 0) {
                // 同步指定资源
                result = {
                    success: 0,
                    failed: 0,
                    skipped: 0,
                    errors: [],
                    synced: []
                };
                for (const resId of resource_ids) {
                    const syncResult = client.syncResource(resource_type, resId, targetDir, use_api);
                    if (syncResult.success) {
                        result.success++;
                        result.synced.push(resId);
                    } else {
                        result.failed++;
                        result.errors.push(`${resId}: ${syncResult.msg}`);
                    }
                }
            } else {
                // 同步全部
                result = client.syncAllResources(resource_type, targetDir, use_api);
            }

            // 正则同步：补充全局正则（settings.json）
            if (resource_type === 'regex') {
                const settingsPath = client.getSettingsPath();
                if (settingsPath) {
                    const globalResult = regexUtils.exportGlobalRegex(settingsPath, targetDir);
                    result.global_regex = globalResult;
                    if (globalResult.success) {
                        result.success += globalResult.success;
                    }
                    if (globalResult.failed) {
                        result.failed += globalResult.failed;
                    }
                }
            }

            // 触发资源刷新
            if (result.success > 0 && resources && resources.rescan) {
                try {
                    resources.rescan();
                } catch (e) {
                    console.warn('[ST Manager] 触发重新扫描失败:', e.message);
                }
            }

            res.json({
                success: true,
                resource_type: resource_type,
                target_dir: targetDir,
                result: result
            });

        } catch (e) {
            console.error('[ST Manager] 同步失败:', e);
            res.status(500).json({
                success: false,
                error: e.message,
                result: { success: 0, failed: 0 }
            });
        }
    });

    // ============ 正则 API ============

    // 获取全局正则
    app.get('/api/regex/global', (req, res) => {
        try {
            const result = regex.getGlobalRegex();
            res.json({ success: true, ...result, data: result });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 聚合正则
    app.get('/api/regex/aggregate', (req, res) => {
        try {
            const result = regex.aggregateRegex();
            res.json({ success: true, ...result, data: result });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // ============ 自动化 API ============

    // 获取规则集列表
    app.get('/api/automation/rulesets', (req, res) => {
        try {
            const rules = automation.listRulesets ? automation.listRulesets() : [];
            const items = rules.map(item => ({
                ...item,
                rule_count: item.rule_count ?? item.ruleCount ?? ((item.rules || []).length || 0),
            }));
            res.json({ success: true, items, rulesets: items });
        } catch (e) {
            res.json({ success: false, msg: e.message, items: [], rulesets: [] });
        }
    });

    // 获取单个规则集
    app.get('/api/automation/rulesets/:id', (req, res) => {
        try {
            const rule = automation.getRuleset ? automation.getRuleset(req.params.id) : null;
            if (rule) {
                res.json({ success: true, data: rule, ruleset: rule });
            } else {
                res.json({ success: false, msg: '规则集不存在' });
            }
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 保存规则集
    app.post('/api/automation/rulesets', (req, res) => {
        try {
            const ruleset = { ...(req.body || {}) };
            if (!ruleset.oldId && ruleset.id) {
                ruleset.oldId = ruleset.id;
            }
            const result = automation.saveRuleset ? automation.saveRuleset(ruleset) : { success: false, error: '功能未实现' };
            res.json({
                ...result,
                msg: result.error || result.message || '',
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 删除规则集
    app.delete('/api/automation/rulesets/:id', (req, res) => {
        try {
            const result = automation.deleteRuleset ? automation.deleteRuleset(req.params.id) : { success: false, error: '功能未实现' };
            res.json({
                ...result,
                msg: result.error || result.message || '',
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 执行规则
    app.post('/api/automation/execute', (req, res) => {
        try {
            const payload = req.body || {};
            const { card_ids, ruleset_id } = payload;
            const recursive = payload.recursive !== false;
            const hasCategoryFilter = Object.prototype.hasOwnProperty.call(payload, 'category');
            const category = _normalizeSlash(String(payload.category || '').trim());

            let targetIds = Array.isArray(card_ids)
                ? card_ids.map(id => _normalizeSlash(id)).filter(Boolean)
                : [];

            if ((!targetIds.length) && hasCategoryFilter) {
                const listed = cards && cards.listCards
                    ? cards.listCards({ page: 1, pageSize: 999999, sort: 'mtime_desc' })
                    : { items: [] };
                const items = Array.isArray(listed?.items) ? listed.items : [];
                targetIds = items
                    .filter(item => {
                        const folder = _normalizeSlash(item.folder || item.category || '');
                        if (!category) {
                            return recursive ? true : !folder;
                        }
                        return recursive
                            ? (folder === category || folder.startsWith(`${category}/`))
                            : folder === category;
                    })
                    .map(item => _normalizeSlash(item.id))
                    .filter(Boolean);
            }

            targetIds = Array.from(new Set(targetIds));
            if (hasCategoryFilter && !targetIds.length) {
                return res.json({ success: false, msg: '未找到需要处理的卡片' });
            }

            const result = automation.execute
                ? automation.execute(ruleset_id, targetIds.length ? targetIds : null, Boolean(payload.dry_run))
                : { success: false, error: '功能未实现' };
            res.json({
                ...result,
                msg: result.error || result.message || '',
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 设置全局规则集
    app.post('/api/automation/global_setting', (req, res) => {
        try {
            const { ruleset_id } = req.body || {};
            const payload = { active_automation_ruleset: ruleset_id || null };
            const result = config && config.update ? config.update(payload) : { success: true };
            res.json({
                ...result,
                msg: result.error || result.message || '',
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.get('/api/automation/global_setting', (req, res) => {
        try {
            const cfg = config && config.get ? config.get() : {};
            res.json({ success: true, ruleset_id: cfg.active_automation_ruleset || null });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.get('/api/automation/rulesets/:id/export', (req, res) => {
        try {
            const ruleset = automation && automation.getRuleset ? automation.getRuleset(req.params.id) : null;
            if (!ruleset) {
                return res.status(404).json({ success: false, msg: 'Not found' });
            }
            const exportPayload = JSON.parse(JSON.stringify(ruleset));
            delete exportPayload.id;
            const name = _sanitizeFileName((ruleset.meta && ruleset.meta.name) ? String(ruleset.meta.name) : 'ruleset');
            const filename = `${name.replace(/\.json$/i, '')}.json`;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(JSON.stringify(exportPayload, null, 2));
        } catch (e) {
            return res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/automation/rulesets/import', async (req, res) => {
        try {
            const { files } = await _parseMultipartForm(req, 10 * 1024 * 1024);
            const file = _pickMultipartFile(files, 'file');
            if (!file || !file.data) {
                return res.json({ success: false, msg: 'No file uploaded' });
            }
            if (!String(file.filename || '').toLowerCase().endsWith('.json')) {
                return res.json({ success: false, msg: 'Invalid file type' });
            }
            let content = null;
            try {
                content = JSON.parse(file.data.toString('utf-8'));
            } catch (e) {
                return res.json({ success: false, msg: 'Invalid JSON' });
            }
            if (!content || typeof content !== 'object' || !Array.isArray(content.rules)) {
                return res.json({ success: false, msg: "Invalid ruleset format (missing 'rules')" });
            }
            if (!content.meta || typeof content.meta !== 'object') content.meta = {};
            if (!content.meta.name) {
                content.meta.name = path.basename(file.filename, '.json');
            }
            const saved = automation.saveRuleset ? automation.saveRuleset(content) : { success: false, error: '保存失败' };
            if (!saved.success) {
                return res.json({ success: false, msg: saved.error || saved.message || '保存失败' });
            }
            res.json({ success: true, id: saved.id, name: content.meta.name });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // ============ 备份 API ============

    // 获取备份列表
    app.get('/api/backup/list', (req, res) => {
        try {
            const result = backup.list ? backup.list() : [];
            res.json({ success: true, backups: result });
        } catch (e) {
            res.json({ success: false, msg: e.message, backups: [] });
        }
    });

    // 创建备份
    app.post('/api/backup/create', (req, res) => {
        try {
            const result = backup.trigger ? backup.trigger(req.body || {}) : { success: false, message: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 恢复备份
    app.post('/api/backup/restore', (req, res) => {
        try {
            const { backup_id } = req.body || {};
            const result = backup.restore ? backup.restore(backup_id) : { success: false, message: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/create_snapshot', (req, res) => {
        try {
            const requestData = req.body || {};
            const target = _resolveSnapshotTarget(requestData);
            if (!target.ok) {
                return res.json({ success: false, msg: target.msg || '目标无效' });
            }

            _ensureDir(target.targetDir);
            const settings = config && config.get ? config.get() : {};
            const manualLimit = Math.max(1, Math.min(Number(settings.snapshot_limit_manual) || 20, 200));
            _cleanupSnapshots(target.targetDir, manualLimit, 'manual');

            const label = String(requestData.label || '').trim();
            const ext = path.extname(target.filename) || '.json';
            const nameNoExt = path.basename(target.filename, ext);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const safeLabel = label ? label.replace(/[\\/:*?"<>|]/g, '-') : '';
            const backupName = safeLabel
                ? `${nameNoExt}_${timestamp}__KEY__${safeLabel}${ext}`
                : `${nameNoExt}_${timestamp}${ext}`;
            const backupPath = path.join(target.targetDir, backupName);

            const unsavedContent = requestData.content;
            if (target.sourcePath.toLowerCase().endsWith('.json') && unsavedContent && typeof unsavedContent === 'object') {
                const compact = Boolean(requestData.compact);
                fs.writeFileSync(
                    backupPath,
                    JSON.stringify(unsavedContent, null, compact ? 0 : 2),
                    'utf-8'
                );
            } else {
                fs.copyFileSync(target.sourcePath, backupPath);
            }

            if (target.snapshotType === 'card' && target.sourcePath.toLowerCase().endsWith('.json')) {
                const sidecar = _findSidecarImage(target.sourcePath);
                if (sidecar && _isFile(sidecar)) {
                    const sidecarExt = path.extname(sidecar);
                    const sidecarName = safeLabel
                        ? `${nameNoExt}_${timestamp}__KEY__${safeLabel}${sidecarExt}`
                        : `${nameNoExt}_${timestamp}${sidecarExt}`;
                    const sidecarTarget = path.join(target.targetDir, sidecarName);
                    try {
                        fs.copyFileSync(sidecar, sidecarTarget);
                    } catch (e) {
                        // non-critical
                    }
                }
            }

            res.json({ success: true, msg: '快照已保存', path: backupPath });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/smart_auto_snapshot', (req, res) => {
        try {
            const requestData = req.body || {};
            if (!requestData.content || typeof requestData.content !== 'object') {
                return res.json({ success: false, msg: 'Content empty' });
            }
            const target = _resolveSnapshotTarget(requestData);
            if (!target.ok) {
                return res.json({ success: false, msg: target.msg || '目标无效' });
            }

            _ensureDir(target.targetDir);
            const currentHash = _hashJsonPayload(requestData.content);
            const candidates = fs.readdirSync(target.targetDir)
                .filter(name => name.toLowerCase().endsWith('.json') || name.toLowerCase().endsWith('.png'))
                .map(name => path.join(target.targetDir, name))
                .sort((a, b) => {
                    const mA = fs.statSync(a).mtimeMs || 0;
                    const mB = fs.statSync(b).mtimeMs || 0;
                    return mB - mA;
                })
                .slice(0, 20);

            for (const candidate of candidates) {
                try {
                    if (candidate.toLowerCase().endsWith('.json')) {
                        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
                        const candidateHash = _hashJsonPayload(parsed);
                        if (candidateHash === currentHash) {
                            return res.json({ success: true, status: 'skipped', msg: '内容未变更，跳过备份' });
                        }
                    }
                } catch (e) {
                    // skip unreadable backup
                }
            }

            const settings = config && config.get ? config.get() : {};
            const autoLimit = Math.max(1, Math.min(Number(settings.snapshot_limit_auto) || 5, 50));
            _cleanupSnapshots(target.targetDir, autoLimit, 'auto');

            const ext = path.extname(target.filename) || '.json';
            const nameNoExt = path.basename(target.filename, ext);
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const backupName = `${nameNoExt}_${timestamp}__AUTO__${ext}`;
            const backupPath = path.join(target.targetDir, backupName);

            if (target.sourcePath.toLowerCase().endsWith('.json')) {
                fs.writeFileSync(backupPath, JSON.stringify(requestData.content, null, 0), 'utf-8');
            } else {
                fs.copyFileSync(target.sourcePath, backupPath);
            }

            res.json({ success: true, status: 'created', path: backupPath, msg: '自动快照已生成' });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/list_backups', (req, res) => {
        try {
            const target = _resolveSnapshotTarget(req.body || {});
            if (!target.ok) {
                return res.json({ success: false, msg: target.msg || '目标无效', backups: [] });
            }
            const targetDir = target.targetDir;
            const nameNoExt = path.basename(target.filename, path.extname(target.filename));
            const backups = [];
            if (fs.existsSync(targetDir)) {
                const files = fs.readdirSync(targetDir);
                for (const file of files) {
                    const lower = file.toLowerCase();
                    if (!lower.endsWith('.png') && !lower.endsWith('.json')) continue;
                    if (!file.includes(nameNoExt)) continue;
                    const fullPath = path.join(targetDir, file);
                    if (!_isFile(fullPath)) continue;
                    const stat = fs.statSync(fullPath);
                    const isKey = file.includes('__KEY__');
                    const isAuto = file.includes('__AUTO__');
                    let label = '';
                    if (isKey) {
                        const parts = file.split('__KEY__');
                        if (parts.length > 1) label = path.basename(parts[1], path.extname(parts[1]));
                    } else if (isAuto) {
                        label = 'Auto Save';
                    }
                    backups.push({
                        filename: file,
                        path: fullPath,
                        mtime: Math.floor((stat.mtimeMs || 0) / 1000),
                        size: stat.size,
                        is_key: isKey,
                        is_auto: isAuto,
                        label,
                        ext: path.extname(file),
                    });
                }
            }
            backups.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
            res.json({ success: true, backups, backup_dir: targetDir });
        } catch (e) {
            res.json({ success: false, msg: e.message, backups: [] });
        }
    });

    app.post('/api/restore_backup', (req, res) => {
        try {
            const { backup_path, target_id, type, target_file_path } = req.body || {};
            const backupsRoot = _getSystemBackupsDir();
            const backupPath = backup_path
                ? (path.isAbsolute(backup_path) ? path.resolve(path.normalize(backup_path)) : resolveInside(_getPluginRoot(), backup_path))
                : null;
            if (!backupPath || !_isFile(backupPath) || !isPathInside(backupsRoot, backupPath)) {
                return res.json({ success: false, msg: '备份文件丢失' });
            }

            let targetPath = null;
            if (type === 'lorebook') {
                if (String(target_id || '').startsWith('embedded::')) {
                    targetPath = _resolveCardFilePath(String(target_id).replace(/^embedded::/, ''));
                } else {
                    targetPath = _resolveWorldInfoPath(target_file_path || target_id);
                }
            } else {
                targetPath = _resolveCardFilePath(target_id);
            }
            if (!targetPath) {
                return res.json({ success: false, msg: '目标路径解析失败' });
            }
            _ensureDir(path.dirname(targetPath));
            fs.copyFileSync(backupPath, targetPath);

            if (targetPath.toLowerCase().endsWith('.json')) {
                const backupBase = backupPath.slice(0, -path.extname(backupPath).length);
                const targetBase = targetPath.slice(0, -path.extname(targetPath).length);
                const sidecarExts = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.bmp'];
                for (const ext of sidecarExts) {
                    const sidecarBackup = `${backupBase}${ext}`;
                    if (_isFile(sidecarBackup)) {
                        try {
                            fs.copyFileSync(sidecarBackup, `${targetBase}${ext}`);
                        } catch (e) {
                            // ignore sidecar restore errors
                        }
                        break;
                    }
                }
            }

            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/normalize_card_data', (req, res) => {
        try {
            const rawData = req.body;
            if (!rawData || typeof rawData !== 'object') {
                return res.json({ success: false, msg: 'No data provided' });
            }
            const normalized = _normalizeCardDataForDiff(rawData);
            res.json({ success: true, data: normalized });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/open_path', (req, res) => {
        try {
            const { path: rawPath, relative_to_base } = req.body || {};
            if (!rawPath) {
                return res.json({ success: false, msg: 'Path missing' });
            }
            let resolved = null;
            if (relative_to_base) {
                resolved = resolveInside(_getPluginRoot(), String(rawPath));
            } else {
                resolved = _resolveReadablePath(rawPath);
            }
            if (!resolved) {
                return res.status(400).json({ success: false, msg: '非法路径' });
            }
            let targetOpen = resolved;
            if (_isFile(targetOpen)) {
                targetOpen = path.dirname(targetOpen);
            }
            if (!_isDir(targetOpen)) {
                return res.json({ success: false, msg: `路径不存在: ${targetOpen}` });
            }
            if (!_openFolder(targetOpen)) {
                return res.json({ success: false, msg: '打开目录失败' });
            }
            return res.json({ success: true });
        } catch (e) {
            return res.json({ success: false, msg: e.message });
        }
    });

    // ============ 资源 API ============

    // 角色卡原图访问
    app.get('/cards_file/:filename(*)', (req, res) => {
        try {
            const rawFilename = req.params.filename || '';
            const charactersDir = _getLibraryCharactersDir();
            const cardPath = resolveInside(charactersDir, rawFilename);
            const defaultImg = _getDefaultCardImagePath(staticDir);

            if (!cardPath || !_isFile(cardPath)) {
                if (_isFile(defaultImg)) {
                    return res.sendFile(defaultImg);
                }
                return res.status(404).end();
            }

            if (cardPath.toLowerCase().endsWith('.json')) {
                const sidecar = _findSidecarImage(cardPath);
                if (sidecar && _isFile(sidecar)) {
                    return res.sendFile(sidecar);
                }
                if (_isFile(defaultImg)) {
                    return res.sendFile(defaultImg);
                }
                return res.status(404).end();
            }

            return res.sendFile(cardPath);
        } catch (e) {
            res.status(500).end();
        }
    });

    app.post('/api/extensions/upload', async (req, res) => {
        try {
            const { fields, files } = await _parseMultipartForm(req, 30 * 1024 * 1024);
            const targetType = fields.target_type || null;
            const uploadFiles = _pickMultipartFiles(files, 'files');
            if (!uploadFiles.length) {
                return res.json({ success: false, msg: '未接收到文件' });
            }
            let successCount = 0;
            const failedList = [];
            for (const file of uploadFiles) {
                const result = extensions.uploadExtension(file.data, file.filename, targetType);
                if (result && result.success) {
                    successCount += 1;
                } else {
                    failedList.push(file.filename || 'unknown');
                }
            }
            let msg = `成功上传 ${successCount} 个文件。`;
            if (failedList.length) {
                msg += ` 失败/跳过: ${failedList.join(', ')}`;
            }
            res.json({ success: true, msg });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 资源文件访问（library/resources/<folder>/...）
    app.get('/resources_file/:subpath(*)', (req, res) => {
        try {
            const subpath = req.params.subpath || '';
            const resourcesRoot = _getLibraryResourcesDir();
            const fullPath = resolveInside(resourcesRoot, subpath);
            if (!fullPath || !_isFile(fullPath)) {
                return res.status(404).end();
            }
            return res.sendFile(fullPath);
        } catch (e) {
            res.status(500).end();
        }
    });

    // 背景图资源访问
    app.get('/assets/backgrounds/:filename(*)', (req, res) => {
        try {
            const filePath = resolveInside(path.join(_getLibraryAssetsDir(), 'backgrounds'), req.params.filename || '');
            if (filePath && _isFile(filePath)) {
                return res.sendFile(filePath);
            }
            return res.status(404).end();
        } catch (e) {
            res.status(500).end();
        }
    });

    // 笔记图片资源访问
    app.get('/assets/notes/:filename(*)', (req, res) => {
        try {
            const filePath = resolveInside(path.join(_getLibraryAssetsDir(), 'notes_images'), req.params.filename || '');
            if (filePath && _isFile(filePath)) {
                return res.sendFile(filePath);
            }
            return res.status(404).end();
        } catch (e) {
            res.status(500).end();
        }
    });

    // 列出资源目录文件
    app.post('/api/list_resource_files', (req, res) => {
        try {
            const { folder_name } = req.body || {};
            const result = _listResourceFiles(folder_name);
            if (!result.success) {
                return res.json({ success: false, msg: result.msg });
            }
            return res.json(result);
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 列出皮肤
    app.post('/api/list_resource_skins', (req, res) => {
        try {
            const { folder_name } = req.body || {};
            const result = _listResourceFiles(folder_name);
            if (!result.success) {
                return res.json({ success: false, msg: result.msg, skins: [] });
            }
            res.json({ success: true, skins: result.files?.skins || [] });
        } catch (e) {
            res.json({ success: false, msg: e.message, skins: [] });
        }
    });

    // 删除资源文件（移入回收站）
    app.post('/api/delete_resource_file', (req, res) => {
        try {
            const { card_id, filename } = req.body || {};
            if (!card_id || !filename) {
                return res.json({ success: false, msg: '参数缺失' });
            }

            const safeName = _sanitizeFileName(filename);
            if (safeName !== filename || safeName.includes('/') || safeName.includes('\\')) {
                return res.json({ success: false, msg: '非法文件名' });
            }

            const binding = _resolveCardResourceBinding(card_id);
            if (!binding.folder || !binding.fullPath || !binding.exists) {
                return res.json({ success: false, msg: '该卡片未设置资源目录' });
            }

            const target = resolveInside(binding.fullPath, safeName);
            if (!target || !_isFile(target)) {
                return res.json({ success: false, msg: '文件不存在' });
            }

            const moveResult = _movePathToTrash(target, { prefix: 'resource_file' });
            if (!moveResult.success) {
                return res.json({ success: false, msg: moveResult.error || '删除失败' });
            }
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 上传资源文件（multipart/form-data）
    app.post('/api/upload_card_resource', async (req, res) => {
        try {
            const { fields, files } = await _parseMultipartForm(req);
            const cardId = fields.card_id;
            const uploaded = _pickMultipartFile(files, 'file');

            if (!cardId || !uploaded || !uploaded.data) {
                return res.json({ success: false, msg: '参数缺失' });
            }

            const binding = _resolveCardResourceBinding(cardId);
            if (!binding.folder || !binding.fullPath || !binding.exists) {
                return res.json({ success: false, msg: "该卡片尚未设置资源目录，请先在'管理'页创建。" });
            }

            const safeName = _sanitizeFileName(uploaded.filename || 'upload.bin');
            const detection = _detectResourceCategory(safeName, uploaded.data);
            const categoryDir = detection.category || '';
            const saveDir = categoryDir ? resolveInside(binding.fullPath, categoryDir) : binding.fullPath;
            if (!saveDir) {
                return res.json({ success: false, msg: '目标路径非法' });
            }

            if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true });
            }

            const ext = path.extname(safeName);
            const baseName = path.basename(safeName, ext);
            let saveName = safeName;
            let savePath = path.join(saveDir, saveName);
            let index = 1;
            while (fs.existsSync(savePath)) {
                saveName = `${baseName}_${index}${ext}`;
                savePath = path.join(saveDir, saveName);
                index += 1;
            }

            fs.writeFileSync(savePath, uploaded.data);

            res.json({
                success: true,
                msg: `已存入 ${categoryDir || '根目录'}`,
                filename: saveName,
                is_lorebook: detection.isLorebook,
                is_preset: detection.isPreset,
                category: categoryDir,
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 保存独立脚本文件
    app.post('/api/scripts/save', (req, res) => {
        try {
            const { file_path, content } = req.body || {};
            if (!file_path || content === undefined) {
                return res.json({ success: false, msg: '参数缺失' });
            }

            const pluginDataDir = _getPluginDataDir();
            const normalizedPath = path.isAbsolute(file_path)
                ? path.resolve(path.normalize(file_path))
                : resolveInside(pluginDataDir, file_path);

            if (!normalizedPath || !isPathInside(pluginDataDir, normalizedPath)) {
                return res.json({ success: false, msg: '非法路径：禁止访问插件目录之外的文件' });
            }
            if (!normalizedPath.toLowerCase().endsWith('.json')) {
                return res.json({ success: false, msg: '非法文件类型：仅支持 .json' });
            }

            const parentDir = path.dirname(normalizedPath);
            if (!fs.existsSync(parentDir)) {
                return res.json({ success: false, msg: `目标目录不存在: ${parentDir}` });
            }

            fs.writeFileSync(normalizedPath, JSON.stringify(content, null, 2), 'utf-8');
            res.json({ success: true, path: _relativeToPluginData(normalizedPath) });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 上传背景
    app.post('/api/upload_background', async (req, res) => {
        try {
            const { files } = await _parseMultipartForm(req, 15 * 1024 * 1024);
            const uploaded = _pickMultipartFile(files, 'file');
            if (!uploaded || !uploaded.data) {
                return res.json({ success: false, msg: '未找到上传文件' });
            }

            const bgDir = path.join(_getLibraryAssetsDir(), 'backgrounds');
            if (!fs.existsSync(bgDir)) {
                fs.mkdirSync(bgDir, { recursive: true });
            }

            const original = _sanitizeFileName(uploaded.filename || 'background.png');
            const ext = path.extname(original) || '.png';
            const base = path.basename(original, ext) || 'background';
            let finalName = `${base}${ext}`;
            let finalPath = path.join(bgDir, finalName);
            let index = 1;
            while (fs.existsSync(finalPath)) {
                finalName = `${base}_${index}${ext}`;
                finalPath = path.join(bgDir, finalName);
                index += 1;
            }
            fs.writeFileSync(finalPath, uploaded.data);
            res.json({ success: true, url: `/assets/backgrounds/${encodeURIComponent(finalName)}` });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 上传笔记图片
    app.post('/api/upload_note_image', async (req, res) => {
        try {
            const { files } = await _parseMultipartForm(req, 15 * 1024 * 1024);
            const uploaded = _pickMultipartFile(files, 'file');
            if (!uploaded || !uploaded.data) {
                return res.json({ success: false, msg: '未找到上传文件' });
            }

            const notesDir = path.join(_getLibraryAssetsDir(), 'notes_images');
            if (!fs.existsSync(notesDir)) {
                fs.mkdirSync(notesDir, { recursive: true });
            }

            const original = _sanitizeFileName(uploaded.filename || `note_${Date.now()}.png`);
            const ext = path.extname(original) || '.png';
            const base = path.basename(original, ext) || `note_${Date.now()}`;
            let finalName = `${base}${ext}`;
            let finalPath = path.join(notesDir, finalName);
            let index = 1;
            while (fs.existsSync(finalPath)) {
                finalName = `${base}_${index}${ext}`;
                finalPath = path.join(notesDir, finalName);
                index += 1;
            }
            fs.writeFileSync(finalPath, uploaded.data);
            res.json({
                success: true,
                filename: finalName,
                url: `/assets/notes/${encodeURIComponent(finalName)}`,
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 将皮肤设为封面（目前支持 JSON 卡片）
    app.post('/api/set_skin_cover', (req, res) => {
        try {
            const { card_id, skin_filename, save_old } = req.body || {};
            if (!card_id || !skin_filename) {
                return res.json({ success: false, msg: '参数缺失' });
            }

            const card = cards.getCard(card_id);
            if (!card || !card.path || !_isFile(card.path)) {
                return res.json({ success: false, msg: '卡片不存在' });
            }
            if (!card.path.toLowerCase().endsWith('.json')) {
                return res.json({ success: false, msg: '当前版本仅支持 JSON 卡片换肤' });
            }

            const binding = _resolveCardResourceBinding(card_id);
            if (!binding.folder || !binding.fullPath || !binding.exists) {
                return res.json({ success: false, msg: '资源目录不存在' });
            }

            const safeSkinName = _sanitizeFileName(skin_filename);
            const skinPath = resolveInside(binding.fullPath, safeSkinName);
            if (!skinPath || !_isFile(skinPath)) {
                return res.json({ success: false, msg: '皮肤文件不存在' });
            }

            if (save_old) {
                const oldSidecar = _findSidecarImage(card.path);
                if (oldSidecar && _isFile(oldSidecar)) {
                    const oldExt = path.extname(oldSidecar);
                    const archived = resolveInside(binding.fullPath, `prev_cover_${Date.now()}${oldExt}`);
                    if (archived) {
                        fs.copyFileSync(oldSidecar, archived);
                    }
                }
            }

            const cardDir = path.dirname(card.path);
            const cardBase = path.basename(card.path, '.json');
            const skinExt = path.extname(safeSkinName) || '.png';
            const targetPath = path.join(cardDir, `${cardBase}${skinExt}`);
            fs.copyFileSync(skinPath, targetPath);

            res.json({ success: true, msg: '封面已更新' });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 设置资源目录
    app.post('/api/set_resource_folder', (req, res) => {
        try {
            const { card_id, resource_path } = req.body || {};
            const result = _saveCardResourceFolder(card_id, resource_path || '');
            if (!result.success) {
                return res.json({ success: false, msg: result.msg });
            }
            res.json({ success: true, resource_folder: result.resource_folder });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 打开资源目录
    app.post('/api/open_resource_folder', (req, res) => {
        try {
            const { card_id } = req.body || {};
            const binding = _resolveCardResourceBinding(card_id);
            if (!binding.folder || !binding.fullPath || !binding.exists) {
                return res.json({ success: false, msg: '资源目录不存在' });
            }
            if (_openFolder(binding.fullPath)) {
                res.json({ success: true });
            } else {
                res.json({ success: false, msg: '打开目录失败' });
            }
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    // 创建资源目录
    app.post('/api/create_resource_folder', (req, res) => {
        try {
            const { card_id } = req.body || {};
            const result = _createCardResourceFolder(card_id);
            if (!result.success) {
                return res.json({ success: false, msg: result.msg || '创建失败' });
            }
            res.json({ success: true, resource_folder: result.resource_folder });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/upload/stage', async (req, res) => {
        try {
            const { fields, files } = await _parseMultipartForm(req, 80 * 1024 * 1024);
            let targetCategory = String(fields.category || '').trim();
            if (targetCategory === '根目录') targetCategory = '';
            targetCategory = _sanitizeRelativeFolder(targetCategory);

            const charactersDir = _getLibraryCharactersDir();
            const targetBaseDir = targetCategory ? resolveInside(charactersDir, targetCategory) : charactersDir;
            if (!targetBaseDir) {
                return res.status(400).json({ success: false, msg: '非法目标路径' });
            }
            _ensureDir(targetBaseDir);

            const uploadFiles = _pickMultipartFiles(files, 'files');
            if (!uploadFiles.length) {
                return res.json({ success: false, msg: '未接收到文件' });
            }

            const batchId = crypto.randomBytes(16).toString('hex');
            const stageRoot = _getBatchUploadRoot();
            const stageDir = path.join(stageRoot, batchId);
            _ensureDir(stageDir);

            const report = [];

            for (const file of uploadFiles) {
                if (!file || !file.data) continue;
                const rawName = _sanitizeFileName(file.filename || 'upload.bin');
                let stagedName = rawName;
                let stagePath = path.join(stageDir, stagedName);
                let suffix = 1;
                while (fs.existsSync(stagePath)) {
                    const ext = path.extname(rawName);
                    const base = path.basename(rawName, ext);
                    stagedName = `${base}_${suffix}${ext}`;
                    stagePath = path.join(stageDir, stagedName);
                    suffix += 1;
                }
                fs.writeFileSync(stagePath, file.data);

                const parsed = _extractCardDataFromFile(stagePath);
                if (!parsed) {
                    try { fs.unlinkSync(stagePath); } catch (e) {}
                    report.push({
                        filename: stagedName,
                        status: 'error',
                        msg: '无法读取卡片元数据 (非有效PNG/JSON)',
                    });
                    continue;
                }

                const newInfo = {
                    char_name: parsed.name || path.basename(stagedName, path.extname(stagedName)),
                    token_count: _estimateTokenCount(parsed.data),
                    file_size: file.data.length,
                    preview_url: `/api/temp_preview/${batchId}/${encodeURIComponent(stagedName)}`,
                };

                const targetPath = path.join(targetBaseDir, stagedName);
                let status = 'ok';
                let existingInfo = null;
                if (fs.existsSync(targetPath)) {
                    status = 'conflict';
                    const existingParsed = _extractCardDataFromFile(targetPath);
                    const stat = fs.statSync(targetPath);
                    const relId = targetCategory ? `${targetCategory}/${stagedName}` : stagedName;
                    existingInfo = {
                        char_name: existingParsed ? existingParsed.name : path.basename(stagedName, path.extname(stagedName)),
                        token_count: existingParsed ? _estimateTokenCount(existingParsed.data) : 0,
                        file_size: stat.size,
                        mtime: Math.floor((stat.mtimeMs || 0) / 1000),
                        preview_url: `/cards_file/${encodeURIComponent(relId)}?t=${Math.floor((stat.mtimeMs || 0) / 1000)}`,
                    };
                }

                report.push({
                    filename: stagedName,
                    status,
                    new_info: newInfo,
                    existing_info: existingInfo,
                });
            }

            res.json({ success: true, batch_id: batchId, report });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.post('/api/upload/commit', (req, res) => {
        try {
            const data = req.body || {};
            const batchId = String(data.batch_id || '').trim();
            const decisions = Array.isArray(data.decisions) ? data.decisions : [];
            let category = String(data.category || '').trim();
            if (category === '根目录') category = '';
            category = _sanitizeRelativeFolder(category);

            if (!batchId || batchId.includes('/') || batchId.includes('\\') || batchId.includes('..')) {
                return res.status(400).json({ success: false, msg: '非法批次ID' });
            }

            const stageDir = resolveInside(_getBatchUploadRoot(), batchId);
            if (!stageDir || !_isDir(stageDir)) {
                return res.json({ success: false, msg: 'Upload session expired' });
            }

            const charactersDir = _getLibraryCharactersDir();
            const targetBaseDir = category ? resolveInside(charactersDir, category) : charactersDir;
            if (!targetBaseDir) {
                return res.status(400).json({ success: false, msg: '非法目标路径' });
            }
            _ensureDir(targetBaseDir);

            const settings = config && config.get ? config.get() : {};
            const autoRename = settings.auto_rename_on_import !== false;
            let successCount = 0;
            const newCards = [];

            for (const decision of decisions) {
                const sourceName = _sanitizeFileName(decision.filename || '');
                const action = String(decision.action || 'import');
                const srcPath = resolveInside(stageDir, sourceName);
                if (!srcPath || !_isFile(srcPath)) continue;
                if (action === 'skip') continue;

                const parsed = _extractCardDataFromFile(srcPath);
                const ext = path.extname(sourceName) || '.png';
                let targetFilename = sourceName;

                if (autoRename && parsed && parsed.name) {
                    const safeBase = _sanitizeFolderSegment(parsed.name);
                    targetFilename = `${safeBase}${ext}`;
                }

                let dstPath = path.join(targetBaseDir, targetFilename);
                const hasConflict = fs.existsSync(dstPath);
                if (hasConflict) {
                    if (action === 'overwrite') {
                        try {
                            fs.unlinkSync(dstPath);
                        } catch (e) {
                            try {
                                fs.rmSync(dstPath, { recursive: true, force: true });
                            } catch (err) {}
                        }
                    } else {
                        const base = path.basename(targetFilename, ext);
                        let counter = 1;
                        while (fs.existsSync(dstPath)) {
                            targetFilename = `${base}_${counter}${ext}`;
                            dstPath = path.join(targetBaseDir, targetFilename);
                            counter += 1;
                        }
                    }
                }

                fs.renameSync(srcPath, dstPath);

                const relId = category ? `${category}/${targetFilename}` : targetFilename;
                const stat = fs.statSync(dstPath);
                const finalParsed = _extractCardDataFromFile(dstPath);
                const dataBlock = finalParsed ? finalParsed.data : {};
                const charName = finalParsed ? finalParsed.name : path.basename(targetFilename, ext);
                const mtimeSec = Math.floor((stat.mtimeMs || 0) / 1000);
                const cardObj = {
                    id: relId,
                    filename: targetFilename,
                    char_name: charName,
                    description: dataBlock.description || '',
                    first_mes: dataBlock.first_mes || '',
                    mes_example: dataBlock.mes_example || '',
                    alternate_greetings: Array.isArray(dataBlock.alternate_greetings) ? dataBlock.alternate_greetings : [],
                    creator_notes: dataBlock.creator_notes || '',
                    personality: dataBlock.personality || '',
                    scenario: dataBlock.scenario || '',
                    system_prompt: dataBlock.system_prompt || '',
                    post_history_instructions: dataBlock.post_history_instructions || '',
                    char_version: dataBlock.character_version || '',
                    character_book: dataBlock.character_book || null,
                    extensions: dataBlock.extensions || {},
                    ui_summary: '',
                    source_link: '',
                    is_favorite: false,
                    token_count: _estimateTokenCount(dataBlock),
                    file_size: stat.size,
                    tags: Array.isArray(dataBlock.tags) ? dataBlock.tags : [],
                    category: category,
                    creator: dataBlock.creator || '',
                    last_modified: mtimeSec,
                    image_url: `/cards_file/${encodeURIComponent(relId)}?t=${mtimeSec}`,
                    thumb_url: `/api/thumbnail/${encodeURIComponent(relId)}?t=${mtimeSec}`,
                    is_bundle: false,
                };
                newCards.push(cardObj);
                successCount += 1;
            }

            try {
                fs.rmSync(stageDir, { recursive: true, force: true });
            } catch (e) {
                // ignore temp cleanup errors
            }

            res.json({
                success: true,
                count: successCount,
                new_cards: newCards,
                category_counts: _buildCategoryCounts(_getAllCardsForStats()),
            });
        } catch (e) {
            res.json({ success: false, msg: e.message });
        }
    });

    app.get('/api/temp_preview/:batch/:filename(*)', (req, res) => {
        try {
            const batchId = String(req.params.batch || '').trim();
            const filename = req.params.filename || '';
            if (!batchId || batchId.includes('/') || batchId.includes('\\') || batchId.includes('..')) {
                return res.status(400).end();
            }
            const stageDir = resolveInside(_getBatchUploadRoot(), batchId);
            if (!stageDir || !_isDir(stageDir)) {
                return res.status(404).end();
            }
            const filePath = resolveInside(stageDir, filename);
            if (!filePath || !_isFile(filePath)) {
                return res.status(404).end();
            }
            return res.sendFile(filePath);
        } catch (e) {
            return res.status(500).end();
        }
    });

    // ============ 缩略图 ============

    // 获取缩略图
    app.get('/api/thumbnail/:id(*)', (req, res) => {
        try {
            const id = req.params.id;
            const card = cards.getCard(id);

            if (card && card.imagePath && fs.existsSync(card.imagePath)) {
                res.sendFile(card.imagePath);
            } else {
                // 返回默认图片
                const defaultImg = path.join(staticDir, 'images', 'default_card.png');
                if (fs.existsSync(defaultImg)) {
                    res.sendFile(defaultImg);
                } else {
                    res.status(404).end();
                }
            }
        } catch (e) {
            res.status(500).end();
        }
    });

    // 直接访问缩略图 (兼容 Python 的路径格式)
    app.get('/thumbnails/:filename(*)', (req, res) => {
        try {
            const filename = req.params.filename;
            const thumbPath = config ? config.getThumbnailPath() : null;

            if (thumbPath) {
                const filePath = resolveInside(thumbPath, filename);
                if (filePath && fs.existsSync(filePath)) {
                    res.sendFile(filePath);
                    return;
                }
            }

            // 尝试从卡片获取
            const card = cards.getCard(filename.replace(/\.[^.]+$/, ''));
            if (card && card.imagePath && fs.existsSync(card.imagePath)) {
                res.sendFile(card.imagePath);
            } else {
                const defaultImg = path.join(staticDir, 'images', 'default_card.png');
                if (fs.existsSync(defaultImg)) {
                    res.sendFile(defaultImg);
                } else {
                    res.status(404).end();
                }
            }
        } catch (e) {
            res.status(500).end();
        }
    });

    console.log('[ST Manager] API 路由已注册');
}

module.exports = {
    initModules,
    registerRoutes,
};
