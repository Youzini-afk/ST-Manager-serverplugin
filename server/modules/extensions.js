/**
 * 扩展管理模块
 * 
 * 完整复刻 Python 后端的 extensions.py 逻辑
 * 支持三种扩展类型：regex, scripts (tavern_helper), quick_replies
 * 支持两种来源：global (全局目录) 和 resource (卡片资源目录)
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const regex = require('./regex');

function getRegexGlobalDir(dataRoot, resourceDirs) {
    const preferred = path.join(dataRoot, 'regex');
    if (fs.existsSync(preferred)) {
        return preferred;
    }

    const legacy = path.join(dataRoot, resourceDirs.regexes);
    if (fs.existsSync(legacy)) {
        return legacy;
    }

    return regex.getRegexDir() || preferred;
}

function getRegexWriteDir(dataRoot, resourceDirs) {
    const preferred = path.join(dataRoot, 'regex');
    if (fs.existsSync(preferred)) {
        return preferred;
    }

    const legacy = path.join(dataRoot, resourceDirs.regexes);
    if (fs.existsSync(legacy)) {
        return legacy;
    }

    return preferred;
}

/**
 * 列出扩展文件
 * 
 * @param {string} mode - 扩展类型: 'regex' | 'scripts' | 'quick_replies'
 * @param {string} filterType - 过滤类型: 'all' | 'global' | 'resource'
 * @param {string} search - 搜索关键词
 * @returns {Array} 扩展列表
 */
function listExtensions(mode = 'regex', filterType = 'all', search = '') {
    const items = [];
    // 从插件的 library 目录读取
    const pluginDataDir = config.getPluginDataDir();
    const libraryRoot = path.join(pluginDataDir, 'library');
    // 以下变量保留用于兼容其他函数
    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const resourcesRoot = config.getResourcesRoot();
    const resourceSubDirs = config.getResourceSubDirs();

    // 确定目标全局目录和资源子目录名
    let targetGlobalDir = '';
    let targetResSub = '';

    switch (mode) {
        case 'scripts':
            targetGlobalDir = path.join(libraryRoot, 'extensions', 'scripts');
            targetResSub = resourceSubDirs.scripts;
            break;
        case 'quick_replies':
            targetGlobalDir = path.join(libraryRoot, 'extensions', 'quick-replies');
            targetResSub = resourceSubDirs.quickreplies;
            break;
        case 'regex':
        default:
            targetGlobalDir = path.join(libraryRoot, 'extensions', 'regex');
            targetResSub = resourceSubDirs.regexes;
            break;
    }

    const searchLower = (search || '').toLowerCase().trim();

    // 1. 扫描全局目录
    if (filterType === 'all' || filterType === 'global') {
        if (fs.existsSync(targetGlobalDir)) {
            try {
                const files = fs.readdirSync(targetGlobalDir);
                for (const f of files) {
                    if (!f.toLowerCase().endsWith('.json')) continue;

                    const fullPath = path.join(targetGlobalDir, f);
                    try {
                        const stat = fs.statSync(fullPath);
                        if (!stat.isFile()) continue;

                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const data = JSON.parse(content);

                        // 获取名称
                        let name = f;
                        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
                            name = data.scriptName || data.name || f;
                        }

                        const item = {
                            id: `global::${f}`,
                            name,
                            filename: f,
                            type: 'global',
                            path: path.relative(dataRoot, fullPath).replace(/\\/g, '/'),
                            mtime: stat.mtimeMs,
                            size: stat.size,
                        };

                        // 搜索过滤
                        if (searchLower) {
                            const haystack = `${item.name} ${item.filename}`.toLowerCase();
                            if (!haystack.includes(searchLower)) continue;
                        }

                        items.push(item);
                    } catch (e) {
                        // 解析失败，跳过
                    }
                }
            } catch (e) {
                console.error(`[ST Manager] 扫描全局 ${mode} 目录失败:`, e);
            }
        }
    }

    // 2. 扫描资源目录 (card_assets/<folder>/extensions/...)
    if (filterType === 'all' || filterType === 'resource') {
        if (fs.existsSync(resourcesRoot)) {
            try {
                const resFolders = fs.readdirSync(resourcesRoot);

                for (const folder of resFolders) {
                    const folderPath = path.join(resourcesRoot, folder);

                    try {
                        const folderStat = fs.statSync(folderPath);
                        if (!folderStat.isDirectory()) continue;

                        // 目标扩展目录
                        const targetDir = path.join(folderPath, targetResSub);
                        if (!fs.existsSync(targetDir)) continue;

                        const files = fs.readdirSync(targetDir);
                        for (const f of files) {
                            if (!f.toLowerCase().endsWith('.json')) continue;

                            const fullPath = path.join(targetDir, f);
                            try {
                                const stat = fs.statSync(fullPath);
                                if (!stat.isFile()) continue;

                                const content = fs.readFileSync(fullPath, 'utf-8');
                                const data = JSON.parse(content);

                                // 获取名称
                                let name = f;
                                if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
                                    name = data.scriptName || data.name || f;
                                }

                                const item = {
                                    id: `resource::${folder}::${f}`,
                                    name,
                                    filename: f,
                                    type: 'resource',
                                    sourceFolder: folder,
                                    path: path.relative(dataRoot, fullPath).replace(/\\/g, '/'),
                                    mtime: stat.mtimeMs,
                                    size: stat.size,
                                };

                                // 搜索过滤
                                if (searchLower) {
                                    const haystack = `${item.name} ${item.filename} ${item.sourceFolder}`.toLowerCase();
                                    if (!haystack.includes(searchLower)) continue;
                                }

                                items.push(item);
                            } catch (e) {
                                // 解析失败，跳过
                            }
                        }
                    } catch (e) {
                        // 跳过无法访问的文件夹
                    }
                }
            } catch (e) {
                console.error(`[ST Manager] 扫描资源 ${mode} 目录失败:`, e);
            }
        }
    }

    // 按修改时间倒序排列
    items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

    return items;
}

/**
 * 获取单个扩展的详细内容
 * 
 * @param {string} extensionId - 扩展 ID (格式: type::folder::filename 或 type::filename)
 * @returns {Object|null} 扩展数据
 */
function getExtension(extensionId) {
    if (!extensionId) return null;

    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const resourcesRoot = config.getResourcesRoot();
    const resourceSubDirs = config.getResourceSubDirs();

    const parts = extensionId.split('::');

    if (parts[0] === 'global' && parts.length >= 2) {
        // 全局扩展
        const filename = parts.slice(1).join('::');

        // 尝试所有可能的全局目录
        const dirs = [
            getRegexGlobalDir(dataRoot, resourceDirs),
            path.join(dataRoot, resourceDirs.scripts),
            path.join(dataRoot, resourceDirs.quickreplies),
        ].filter(Boolean);

        for (const dir of dirs) {
            const fullPath = path.join(dir, filename);
            if (fs.existsSync(fullPath)) {
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
                    console.error(`[ST Manager] 读取扩展失败:`, e);
                }
            }
        }
    } else if (parts[0] === 'resource' && parts.length >= 3) {
        // 资源扩展
        const folder = parts[1];
        const filename = parts.slice(2).join('::');

        // 尝试所有可能的资源子目录
        const subDirs = [
            resourceSubDirs.regexes,
            resourceSubDirs.scripts,
            resourceSubDirs.quickreplies,
        ];

        for (const subDir of subDirs) {
            const fullPath = path.join(resourcesRoot, folder, subDir, filename);
            if (fs.existsSync(fullPath)) {
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
                    console.error(`[ST Manager] 读取扩展失败:`, e);
                }
            }
        }
    }

    return null;
}

/**
 * 保存扩展文件
 * 
 * @param {string} extensionId - 扩展 ID
 * @param {Object} data - 扩展数据
 * @returns {Object} 操作结果
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
        console.error(`[ST Manager] 保存扩展失败:`, e);
        return { success: false, error: e.message };
    }
}

/**
 * 删除扩展文件
 * 
 * @param {string} extensionId - 扩展 ID
 * @returns {Object} 操作结果
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
        console.error(`[ST Manager] 删除扩展失败:`, e);
        return { success: false, error: e.message };
    }
}

/**
 * 上传扩展文件
 * 
 * @param {Buffer} fileContent - 文件内容
 * @param {string} filename - 文件名
 * @param {string} targetType - 目标类型: 'regex' | 'scripts' | 'quick_replies' | null (自动检测)
 * @returns {Object} 操作结果
 */
function uploadExtension(fileContent, filename, targetType = null) {
    if (!fileContent || !filename) {
        return { success: false, error: '缺少文件内容或文件名' };
    }

    if (!filename.toLowerCase().endsWith('.json')) {
        return { success: false, error: '仅支持 JSON 文件' };
    }

    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();

    try {
        const content = fileContent.toString('utf-8');
        const data = JSON.parse(content);

        // 自动检测类型
        let isRegex = false;
        let isScript = false;
        let isQr = false;

        if (typeof data === 'object' && data !== null) {
            // 检测 Regex
            if ('findRegex' in data || 'regex' in data || 'scriptName' in data) {
                isRegex = true;
            }

            // 检测 ST Script (Tavern Helper)
            if (data.type === 'script' || 'scripts' in data) {
                isScript = true;
            }

            // 检测 Quick Reply
            if ('qrList' in data || 'quickReplies' in data || 'entries' in data) {
                isQr = true;
            } else if ('version' in data && 'name' in data && 'disableSend' in data) {
                isQr = true;
            } else if (data.type === 'quick_reply' || 'setName' in data) {
                isQr = true;
            }
        } else if (Array.isArray(data)) {
            // 旧版 ST Script 可能是数组
            if (data.length > 0 && data[0] === 'scripts') {
                isScript = true;
            }
        }

        // 决定保存路径
        let finalDir = null;

        const regexWriteDir = getRegexWriteDir(dataRoot, resourceDirs);

        if (targetType === 'regex' && isRegex) {
            finalDir = regexWriteDir;
        } else if (targetType === 'scripts' && isScript) {
            finalDir = path.join(dataRoot, resourceDirs.scripts);
        } else if (targetType === 'quick_replies' && isQr) {
            finalDir = path.join(dataRoot, resourceDirs.quickreplies);
        } else {
            // 自动归类
            if (isScript) {
                finalDir = path.join(dataRoot, resourceDirs.scripts);
            } else if (isRegex) {
                finalDir = regexWriteDir;
            } else if (isQr) {
                finalDir = path.join(dataRoot, resourceDirs.quickreplies);
            }
        }

        if (!finalDir) {
            return { success: false, error: '无法识别文件类型' };
        }

        // 确保目录存在
        if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
        }

        // 安全化文件名
        const safeName = filename.replace(/[\\/*?:"<>|]/g, '_');
        let savePath = path.join(finalDir, safeName);

        // 防重名
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
        console.error(`[ST Manager] 上传扩展失败:`, e);
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
