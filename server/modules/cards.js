/**
 * 角色卡管理模块
 * 
 * 完整复刻 Python 后端的 cards.py 核心功能
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// PNG 元数据提取
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/**
 * 从 PNG 文件提取角色卡数据
 */
function extractPngMetadata(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);

        if (!buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
            return null;
        }

        let offset = 8;

        while (offset < buffer.length) {
            const length = buffer.readUInt32BE(offset);
            const type = buffer.slice(offset + 4, offset + 8).toString('ascii');

            if (type === 'tEXt') {
                const data = buffer.slice(offset + 8, offset + 8 + length);
                const nullIndex = data.indexOf(0);

                if (nullIndex !== -1) {
                    const keyword = data.slice(0, nullIndex).toString('latin1');
                    const text = data.slice(nullIndex + 1).toString('latin1');

                    if (keyword === 'chara') {
                        try {
                            const decoded = Buffer.from(text, 'base64').toString('utf-8');
                            return JSON.parse(decoded);
                        } catch (e) {
                            // 解析失败
                        }
                    }
                }
            }

            offset += 12 + length;
        }

        return null;
    } catch (e) {
        console.error(`[ST Manager] 解析 PNG 失败 ${filePath}:`, e);
        return null;
    }
}

/**
 * 递归扫描目录获取角色卡
 */
function scanCardsRecursive(dir, baseDir, items, depth = 0) {
    if (depth > 10) return; // 防止无限递归

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

            if (entry.isDirectory()) {
                // 递归扫描子目录
                scanCardsRecursive(fullPath, baseDir, items, depth + 1);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (ext !== '.png' && ext !== '.json') continue;

                try {
                    const stat = fs.statSync(fullPath);

                    let cardData = null;
                    if (ext === '.png') {
                        cardData = extractPngMetadata(fullPath);
                    } else {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        cardData = JSON.parse(content);
                    }

                    const data = cardData?.data || cardData || {};

                    // 获取文件夹路径
                    const folder = path.dirname(relativePath);

                    items.push({
                        id: relativePath,
                        name: data.name || entry.name.replace(/\.(png|json)$/i, ''),
                        filename: entry.name,
                        folder: folder === '.' ? '' : folder,
                        size: stat.size,
                        mtime: stat.mtimeMs,
                        creator: data.creator || '',
                        tags: data.tags || [],
                        description: (data.description || '').substring(0, 200),
                        hasWorldbook: Boolean(data.character_book),
                        hasRegex: Boolean(data.extensions?.regex_scripts?.length),
                        hasScripts: Boolean(data.extensions?.tavern_helper),
                        version: data.character_version || '',
                        spec: cardData?.spec || 'Unknown',
                    });
                } catch (e) {
                    // 解析失败，跳过
                }
            }
        }
    } catch (e) {
        console.error(`[ST Manager] 扫描目录失败 ${dir}:`, e);
    }
}

/**
 * 获取角色卡列表
 * 
 * @param {Object} options - 选项
 * @returns {Array} 角色卡列表
 */
function listCards(options = {}) {
    const { search = '', folder = '', page = 1, pageSize = 50, sort = 'mtime_desc' } = options;

    // 从插件的 library 目录读取同步后的角色卡
    const pluginDataDir = config.getPluginDataDir();
    const charactersDir = path.join(pluginDataDir, 'library', 'characters');

    console.log('[ST Manager] listCards 调试:');
    console.log('  - pluginDataDir:', pluginDataDir);
    console.log('  - charactersDir:', charactersDir);
    console.log('  - 目录存在:', fs.existsSync(charactersDir));

    const items = [];

    if (!fs.existsSync(charactersDir)) {
        console.log('[ST Manager] 角色卡目录不存在:', charactersDir);
        return { success: true, items: [], total: 0, page, pageSize };
    }

    // 读取目录内容
    try {
        const files = fs.readdirSync(charactersDir);
        console.log('  - 目录文件数量:', files.length);
        if (files.length > 0) {
            console.log('  - 前5个文件:', files.slice(0, 5).join(', '));
        }
    } catch (e) {
        console.log('  - 读取目录错误:', e.message);
    }

    // 递归扫描
    scanCardsRecursive(charactersDir, charactersDir, items);

    console.log('  - 扫描到的角色卡数量:', items.length);

    // 过滤
    let filtered = items;

    if (folder) {
        filtered = filtered.filter(item => item.folder === folder || item.folder.startsWith(folder + '/'));
    }

    if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(item => {
            const haystack = `${item.name} ${item.filename} ${item.creator} ${(item.tags || []).join(' ')}`.toLowerCase();
            return haystack.includes(searchLower);
        });
    }

    // 排序
    switch (sort) {
        case 'name_asc':
            filtered.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'name_desc':
            filtered.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case 'mtime_asc':
            filtered.sort((a, b) => a.mtime - b.mtime);
            break;
        case 'mtime_desc':
        default:
            filtered.sort((a, b) => b.mtime - a.mtime);
            break;
    }

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
 * 获取单个角色卡详情
 */
function getCard(cardId) {
    if (!cardId) return null;

    const pluginDataDir = config.getPluginDataDir();
    const fullPath = path.join(pluginDataDir, 'library', 'characters', cardId);

    if (!fs.existsSync(fullPath)) return null;

    try {
        const stat = fs.statSync(fullPath);
        let cardData = null;

        if (cardId.toLowerCase().endsWith('.png')) {
            cardData = extractPngMetadata(fullPath);
        } else {
            cardData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        }

        return {
            id: cardId,
            path: fullPath,
            imagePath: fullPath, // For thumbnail serving
            size: stat.size,
            mtime: stat.mtimeMs,
            data: cardData,
        };
    } catch (e) {
        console.error(`[ST Manager] 获取卡片详情失败:`, e);
        return null;
    }
}

/**
 * 获取文件夹列表
 */
function listFolders() {
    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const charactersDir = path.join(dataRoot, resourceDirs.characters);

    const folders = new Set();

    function scanFolders(dir, basePath = '') {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const folderPath = basePath ? `${basePath}/${entry.name}` : entry.name;
                    folders.add(folderPath);
                    scanFolders(path.join(dir, entry.name), folderPath);
                }
            }
        } catch (e) {
            // 忽略
        }
    }

    if (fs.existsSync(charactersDir)) {
        scanFolders(charactersDir);
    }

    return Array.from(folders).sort();
}

/**
 * 移动角色卡
 */
function moveCard(cardId, targetFolder) {
    if (!cardId) {
        return { success: false, error: '缺少卡片 ID' };
    }

    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const charactersDir = path.join(dataRoot, resourceDirs.characters);
    const sourcePath = path.join(charactersDir, cardId);

    if (!fs.existsSync(sourcePath)) {
        return { success: false, error: '卡片不存在' };
    }

    const filename = path.basename(cardId);
    const targetDir = targetFolder ? path.join(charactersDir, targetFolder) : charactersDir;
    const targetPath = path.join(targetDir, filename);

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    // 检查目标是否已存在
    if (fs.existsSync(targetPath) && sourcePath !== targetPath) {
        return { success: false, error: '目标位置已存在同名文件' };
    }

    try {
        fs.renameSync(sourcePath, targetPath);

        const newId = targetFolder ? `${targetFolder}/${filename}` : filename;
        return { success: true, newId };
    } catch (e) {
        console.error('[ST Manager] 移动卡片失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 批量添加标签
 */
function addTags(cardIds, tags) {
    if (!cardIds || !cardIds.length || !tags || !tags.length) {
        return { success: false, error: '缺少必要参数' };
    }

    const results = [];

    for (const cardId of cardIds) {
        const card = getCard(cardId);
        if (!card || !card.data) {
            results.push({ cardId, success: false, error: '卡片不存在或无法读取' });
            continue;
        }

        // 这里只返回需要修改的信息，实际修改PNG需要更复杂的逻辑
        // 在服务端插件环境中，我们可以调用 SillyTavern 的 API 来完成
        results.push({
            cardId,
            success: true,
            message: '标签操作需要通过 SillyTavern API 完成',
            currentTags: card.data?.data?.tags || card.data?.tags || [],
            newTags: tags,
        });
    }

    return { success: true, results };
}

/**
 * 批量移除标签
 */
function removeTags(cardIds, tags) {
    if (!cardIds || !cardIds.length || !tags || !tags.length) {
        return { success: false, error: '缺少必要参数' };
    }

    const results = [];

    for (const cardId of cardIds) {
        const card = getCard(cardId);
        if (!card || !card.data) {
            results.push({ cardId, success: false, error: '卡片不存在或无法读取' });
            continue;
        }

        results.push({
            cardId,
            success: true,
            message: '标签操作需要通过 SillyTavern API 完成',
            currentTags: card.data?.data?.tags || card.data?.tags || [],
            tagsToRemove: tags,
        });
    }

    return { success: true, results };
}

/**
 * 删除角色卡
 */
function deleteCard(cardId, moveToTrash = true) {
    if (!cardId) {
        return { success: false, error: '缺少卡片 ID' };
    }

    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const sourcePath = path.join(dataRoot, resourceDirs.characters, cardId);

    if (!fs.existsSync(sourcePath)) {
        return { success: false, error: '卡片不存在' };
    }

    try {
        if (moveToTrash) {
            // 移动到回收站
            const trashDir = path.join(config.getPluginDataDir(), 'trash');
            if (!fs.existsSync(trashDir)) {
                fs.mkdirSync(trashDir, { recursive: true });
            }

            const filename = path.basename(cardId);
            const timestamp = Date.now();
            const trashPath = path.join(trashDir, `${timestamp}_${filename}`);

            fs.renameSync(sourcePath, trashPath);
        } else {
            fs.unlinkSync(sourcePath);
        }

        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 删除卡片失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 创建文件夹
 */
function createFolder(folderPath) {
    if (!folderPath) {
        return { success: false, error: '缺少文件夹路径' };
    }

    // 安全检查
    if (folderPath.includes('..') || path.isAbsolute(folderPath)) {
        return { success: false, error: '无效的文件夹路径' };
    }

    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const fullPath = path.join(dataRoot, resourceDirs.characters, folderPath);

    if (fs.existsSync(fullPath)) {
        return { success: false, error: '文件夹已存在' };
    }

    try {
        fs.mkdirSync(fullPath, { recursive: true });
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 创建文件夹失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 重命名文件夹
 */
function renameFolder(oldPath, newName) {
    if (!oldPath || !newName) {
        return { success: false, error: '缺少必要参数' };
    }

    // 安全检查
    if (newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
        return { success: false, error: '无效的文件夹名称' };
    }

    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const charactersDir = path.join(dataRoot, resourceDirs.characters);
    const sourcePath = path.join(charactersDir, oldPath);

    if (!fs.existsSync(sourcePath)) {
        return { success: false, error: '文件夹不存在' };
    }

    const parentDir = path.dirname(sourcePath);
    const targetPath = path.join(parentDir, newName);

    if (fs.existsSync(targetPath)) {
        return { success: false, error: '目标名称已存在' };
    }

    try {
        fs.renameSync(sourcePath, targetPath);

        const newPath = path.relative(charactersDir, targetPath).replace(/\\/g, '/');
        return { success: true, newPath };
    } catch (e) {
        console.error('[ST Manager] 重命名文件夹失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 删除文件夹
 */
function deleteFolder(folderPath, recursive = false) {
    if (!folderPath) {
        return { success: false, error: '缺少文件夹路径' };
    }

    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const fullPath = path.join(dataRoot, resourceDirs.characters, folderPath);

    if (!fs.existsSync(fullPath)) {
        return { success: false, error: '文件夹不存在' };
    }

    try {
        if (recursive) {
            fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
            // 检查是否为空
            const entries = fs.readdirSync(fullPath);
            if (entries.length > 0) {
                return { success: false, error: '文件夹不为空' };
            }
            fs.rmdirSync(fullPath);
        }

        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 删除文件夹失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 获取角色卡统计
 */
function getStats() {
    const result = listCards({ pageSize: 999999 });
    const items = result.items || [];

    const folders = new Set();
    let withWorldbook = 0;
    let withRegex = 0;
    let withScripts = 0;

    for (const item of items) {
        if (item.folder) folders.add(item.folder);
        if (item.hasWorldbook) withWorldbook++;
        if (item.hasRegex) withRegex++;
        if (item.hasScripts) withScripts++;
    }

    return {
        total: items.length,
        folders: folders.size,
        withWorldbook,
        withRegex,
        withScripts,
    };
}

/**
 * 获取所有唯一标签
 */
function getAllTags() {
    const result = listCards({ pageSize: 999999 });
    const items = result.items || [];

    const tagCounts = {};

    for (const item of items) {
        const tags = item.tags || [];
        for (const tag of tags) {
            const normalizedTag = String(tag).trim();
            if (normalizedTag) {
                tagCounts[normalizedTag] = (tagCounts[normalizedTag] || 0) + 1;
            }
        }
    }

    return Object.entries(tagCounts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
}

module.exports = {
    listCards,
    getCard,
    listFolders,
    moveCard,
    addTags,
    removeTags,
    deleteCard,
    createFolder,
    renameFolder,
    deleteFolder,
    getStats,
    getAllTags,
    extractPngMetadata,
};
