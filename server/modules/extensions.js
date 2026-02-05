/**
 * 扩展管理模块
 *
 * 支持三种扩展类型：regex, scripts (tavern_helper), quick_replies
 * 支持两种来源：global (library/extensions) 和 resource (library/resources/<folder>/extensions)
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { resolveInside } = require('../utils/safePath');

function getLibraryRoot() {
    return path.join(config.getPluginDataDir(), 'library');
}

function normalizeMode(mode) {
    if (mode === 'scripts') return 'scripts';
    if (mode === 'quick_replies') return 'quick_replies';
    return 'regex';
}

function getGlobalDir(mode) {
    const root = getLibraryRoot();
    switch (normalizeMode(mode)) {
        case 'scripts':
            return path.join(root, 'extensions', 'scripts');
        case 'quick_replies':
            return path.join(root, 'extensions', 'quick-replies');
        case 'regex':
        default:
            return path.join(root, 'extensions', 'regex');
    }
}

function getAllGlobalDirs() {
    return [
        getGlobalDir('regex'),
        getGlobalDir('scripts'),
        getGlobalDir('quick_replies'),
    ];
}

function getResourceRoot() {
    return path.join(getLibraryRoot(), 'resources');
}

function getResourceSubDir(mode) {
    const subs = config.getResourceSubDirs();
    switch (normalizeMode(mode)) {
        case 'scripts':
            return subs.scripts;
        case 'quick_replies':
            return subs.quickreplies;
        case 'regex':
        default:
            return subs.regexes;
    }
}

function getAllResourceSubDirs() {
    const subs = config.getResourceSubDirs();
    return [subs.regexes, subs.scripts, subs.quickreplies];
}

function toItem(pluginDataDir, fullPath, filename, type, sourceFolder = '') {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);

    let name = filename;
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        name = data.scriptName || data.name || filename;
    }

    const item = {
        id: type === 'resource' ? `resource::${sourceFolder}::${filename}` : `global::${filename}`,
        name,
        filename,
        type,
        path: path.relative(pluginDataDir, fullPath).replace(/\\/g, '/'),
        mtime: stat.mtimeMs,
        size: stat.size,
    };

    if (sourceFolder) {
        item.sourceFolder = sourceFolder;
    }

    return item;
}

/**
 * 列出扩展文件
 */
function listExtensions(mode = 'regex', filterType = 'all', search = '') {
    const items = [];
    const pluginDataDir = config.getPluginDataDir();
    const targetGlobalDir = getGlobalDir(mode);
    const targetResSub = getResourceSubDir(mode);
    const resourcesRoot = getResourceRoot();
    const searchLower = (search || '').toLowerCase().trim();

    if (filterType === 'all' || filterType === 'global') {
        if (fs.existsSync(targetGlobalDir)) {
            try {
                const files = fs.readdirSync(targetGlobalDir);
                for (const filename of files) {
                    if (!filename.toLowerCase().endsWith('.json')) continue;
                    const fullPath = resolveInside(targetGlobalDir, filename);
                    if (!fullPath || !fs.existsSync(fullPath)) continue;

                    try {
                        const item = toItem(pluginDataDir, fullPath, filename, 'global');
                        if (!item) continue;

                        if (searchLower) {
                            const haystack = `${item.name} ${item.filename}`.toLowerCase();
                            if (!haystack.includes(searchLower)) continue;
                        }

                        items.push(item);
                    } catch (e) {
                        // skip invalid files
                    }
                }
            } catch (e) {
                console.error(`[ST Manager] 扫描全局 ${mode} 目录失败:`, e);
            }
        }
    }

    if (filterType === 'all' || filterType === 'resource') {
        if (fs.existsSync(resourcesRoot)) {
            try {
                const folders = fs.readdirSync(resourcesRoot);
                for (const folder of folders) {
                    const folderPath = resolveInside(resourcesRoot, folder);
                    if (!folderPath || !fs.existsSync(folderPath)) continue;

                    let folderStat;
                    try {
                        folderStat = fs.statSync(folderPath);
                    } catch (e) {
                        continue;
                    }
                    if (!folderStat.isDirectory()) continue;

                    const targetDir = resolveInside(resourcesRoot, path.join(folder, targetResSub));
                    if (!targetDir || !fs.existsSync(targetDir)) continue;

                    let files = [];
                    try {
                        files = fs.readdirSync(targetDir);
                    } catch (e) {
                        continue;
                    }

                    for (const filename of files) {
                        if (!filename.toLowerCase().endsWith('.json')) continue;
                        const fullPath = resolveInside(targetDir, filename);
                        if (!fullPath || !fs.existsSync(fullPath)) continue;

                        try {
                            const item = toItem(pluginDataDir, fullPath, filename, 'resource', folder);
                            if (!item) continue;

                            if (searchLower) {
                                const haystack = `${item.name} ${item.filename} ${item.sourceFolder || ''}`.toLowerCase();
                                if (!haystack.includes(searchLower)) continue;
                            }

                            items.push(item);
                        } catch (e) {
                            // skip invalid files
                        }
                    }
                }
            } catch (e) {
                console.error(`[ST Manager] 扫描资源 ${mode} 目录失败:`, e);
            }
        }
    }

    items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return items;
}

/**
 * 获取单个扩展内容
 */
function getExtension(extensionId) {
    if (!extensionId) return null;

    const parts = String(extensionId).split('::');
    const resourcesRoot = getResourceRoot();

    if (parts[0] === 'global' && parts.length >= 2) {
        const filename = parts.slice(1).join('::');
        for (const dir of getAllGlobalDirs()) {
            const fullPath = resolveInside(dir, filename);
            if (!fullPath || !fs.existsSync(fullPath)) continue;

            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                return {
                    id: extensionId,
                    filename,
                    type: 'global',
                    path: fullPath,
                    data: JSON.parse(content),
                };
            } catch (e) {
                console.error('[ST Manager] 读取扩展失败:', e);
            }
        }
    } else if (parts[0] === 'resource' && parts.length >= 3) {
        const folder = parts[1];
        const filename = parts.slice(2).join('::');

        for (const subDir of getAllResourceSubDirs()) {
            const fullPath = resolveInside(resourcesRoot, path.join(folder, subDir, filename));
            if (!fullPath || !fs.existsSync(fullPath)) continue;

            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                return {
                    id: extensionId,
                    filename,
                    type: 'resource',
                    sourceFolder: folder,
                    path: fullPath,
                    data: JSON.parse(content),
                };
            } catch (e) {
                console.error('[ST Manager] 读取扩展失败:', e);
            }
        }
    }

    return null;
}

/**
 * 保存扩展
 */
function saveExtension(extensionId, data) {
    if (!extensionId || !data) {
        return { success: false, error: '缺少必要参数' };
    }

    const ext = getExtension(extensionId);
    if (!ext) {
        return { success: false, error: '扩展不存在' };
    }

    try {
        fs.writeFileSync(ext.path, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 保存扩展失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 删除扩展
 */
function deleteExtension(extensionId) {
    if (!extensionId) {
        return { success: false, error: '缺少扩展 ID' };
    }

    const ext = getExtension(extensionId);
    if (!ext) {
        return { success: false, error: '扩展不存在' };
    }

    try {
        fs.unlinkSync(ext.path);
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 删除扩展失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 上传扩展
 */
function uploadExtension(fileContent, filename, targetType = null) {
    if (!fileContent || !filename) {
        return { success: false, error: '缺少文件内容或文件名' };
    }

    if (!filename.toLowerCase().endsWith('.json')) {
        return { success: false, error: '仅支持 JSON 文件' };
    }

    try {
        const content = fileContent.toString('utf-8');
        const data = JSON.parse(content);

        let isRegex = false;
        let isScript = false;
        let isQr = false;

        if (typeof data === 'object' && data !== null) {
            if ('findRegex' in data || 'regex' in data || 'scriptName' in data) {
                isRegex = true;
            }
            if (data.type === 'script' || 'scripts' in data) {
                isScript = true;
            }
            if ('qrList' in data || 'quickReplies' in data || 'entries' in data) {
                isQr = true;
            } else if ('version' in data && 'name' in data && 'disableSend' in data) {
                isQr = true;
            } else if (data.type === 'quick_reply' || 'setName' in data) {
                isQr = true;
            }
        } else if (Array.isArray(data) && data.length > 0 && data[0] === 'scripts') {
            isScript = true;
        }

        let mode = null;
        if (targetType === 'regex' && isRegex) mode = 'regex';
        else if (targetType === 'scripts' && isScript) mode = 'scripts';
        else if (targetType === 'quick_replies' && isQr) mode = 'quick_replies';
        else if (isScript) mode = 'scripts';
        else if (isRegex) mode = 'regex';
        else if (isQr) mode = 'quick_replies';

        if (!mode) {
            return { success: false, error: '无法识别文件类型' };
        }

        const finalDir = getGlobalDir(mode);
        if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
        }

        const safeName = filename.replace(/[\\/*?:"<>|]/g, '_');
        let savePath = path.join(finalDir, safeName);
        const namePart = path.basename(safeName, '.json');

        let counter = 1;
        while (fs.existsSync(savePath)) {
            savePath = path.join(finalDir, `${namePart}_${counter}.json`);
            counter++;
        }

        fs.writeFileSync(savePath, content, 'utf-8');

        return {
            success: true,
            path: savePath,
            filename: path.basename(savePath),
        };
    } catch (e) {
        console.error('[ST Manager] 上传扩展失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 获取扩展统计
 */
function getStats() {
    const regexList = listExtensions('regex', 'all', '');
    const scriptsList = listExtensions('scripts', 'all', '');
    const qrList = listExtensions('quick_replies', 'all', '');

    return {
        regex: {
            total: regexList.length,
            global: regexList.filter(i => i.type === 'global').length,
            resource: regexList.filter(i => i.type === 'resource').length,
        },
        scripts: {
            total: scriptsList.length,
            global: scriptsList.filter(i => i.type === 'global').length,
            resource: scriptsList.filter(i => i.type === 'resource').length,
        },
        quickReplies: {
            total: qrList.length,
            global: qrList.filter(i => i.type === 'global').length,
            resource: qrList.filter(i => i.type === 'resource').length,
        },
    };
}

module.exports = {
    listExtensions,
    getExtension,
    saveExtension,
    deleteExtension,
    uploadExtension,
    getStats,
};

