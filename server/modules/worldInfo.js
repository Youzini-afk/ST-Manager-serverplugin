/**
 * 世界书管理模块
 * 
 * 完整复刻 Python 后端的 world_info.py 逻辑
 * 支持三种世界书类型：
 * - global: 全局世界书目录 (worlds/)
 * - resource: 资源绑定世界书 (card_assets/<folder>/lorebooks/)
 * - embedded: 内嵌在角色卡中的世界书
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// PNG 元数据提取 (复用)
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
        return null;
    }
}

/**
 * 标准化世界书条目
 */
function normalizeWiEntries(raw) {
    if (!raw) return [];

    let entries = [];
    if (Array.isArray(raw)) {
        entries = raw;
    } else if (typeof raw === 'object') {
        entries = raw.entries || [];
        if (typeof entries === 'object' && !Array.isArray(entries)) {
            entries = Object.values(entries);
        }
    }

    const normalized = [];
    for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue;

        let keys = entry.keys || entry.key;
        if (typeof keys === 'string') keys = [keys];
        if (!Array.isArray(keys)) keys = [];

        let secKeys = entry.secondary_keys || entry.keysecondary;
        if (typeof secKeys === 'string') secKeys = [secKeys];
        if (!Array.isArray(secKeys)) secKeys = [];

        let enabled = entry.enabled;
        if (enabled === undefined) {
            enabled = !entry.disable;
        }

        normalized.push({
            keys: keys.map(k => String(k).trim().toLowerCase()).filter(k => k).sort(),
            secondary_keys: secKeys.map(k => String(k).trim().toLowerCase()).filter(k => k).sort(),
            content: entry.content || '',
            comment: entry.comment || '',
            enabled: Boolean(enabled),
            constant: Boolean(entry.constant),
            vectorized: Boolean(entry.vectorized),
            position: entry.position ?? entry.pos,
            order: entry.insertion_order || entry.order || 0,
            selective: entry.selective !== false,
            use_regex: Boolean(entry.use_regex),
        });
    }

    normalized.sort((a, b) => {
        const keyA = a.keys.join(',');
        const keyB = b.keys.join(',');
        if (keyA !== keyB) return keyA.localeCompare(keyB);
        if (a.content !== b.content) return a.content.localeCompare(b.content);
        return a.comment.localeCompare(b.comment);
    });

    return normalized;
}

/**
 * 计算世界书内容签名（用于去重）
 */
function computeWiSignature(raw) {
    try {
        const entries = normalizeWiEntries(raw);
        if (entries.length === 0) return null;

        const cleanText = (text) => {
            if (typeof text !== 'string') return '';
            return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\s+/g, ' ').trim();
        };

        const entrySigs = [];
        for (const entry of entries) {
            const content = cleanText(entry.content);
            const comment = cleanText(entry.comment);
            if (!content && !comment) continue;
            entrySigs.push(`${content}||${comment}`);
        }

        entrySigs.sort();
        const payload = entrySigs.join('\n');
        return crypto.createHash('sha1').update(payload, 'utf-8').digest('hex');
    } catch (e) {
        return null;
    }
}

/**
 * 获取世界书条目数
 */
function countEntries(raw) {
    if (!raw) return 0;

    let entries = [];
    if (Array.isArray(raw)) {
        entries = raw;
    } else if (typeof raw === 'object') {
        entries = raw.entries || [];
        if (typeof entries === 'object' && !Array.isArray(entries)) {
            entries = Object.values(entries);
        }
    }

    return entries.length;
}

/**
 * 列出世界书
 * 
 * @param {string} wiType - 类型: 'all' | 'global' | 'resource' | 'embedded'
 * @param {string} search - 搜索关键词
 * @param {number} page - 页码
 * @param {number} pageSize - 每页数量
 * @returns {Object} 列表结果
 */
function listWorldbooks(wiType = 'all', search = '', page = 1, pageSize = 20) {
    const items = [];

    // 从插件的 library 目录读取同步后的世界书
    const pluginDataDir = config.getPluginDataDir();
    const libraryRoot = path.join(pluginDataDir, 'library');

    // Library 目录结构
    const lorebooksDir = path.join(libraryRoot, 'lorebooks');
    const charactersDir = path.join(libraryRoot, 'characters');

    const searchLower = (search || '').toLowerCase().trim();

    // 收集内嵌世界书名称和签名（用于全局去重）
    const embeddedNameSet = new Set();
    const embeddedSigSet = new Set();

    // 收集资源目录（用于排除）
    const resourceLoreDirs = new Set();

    // 1. 预扫描内嵌世界书（如果需要与全局去重）
    if (wiType === 'all' || wiType === 'global') {
        if (fs.existsSync(charactersDir)) {
            try {
                scanEmbeddedWorldbooks(charactersDir, embeddedNameSet, embeddedSigSet);
            } catch (e) {
                console.error('[ST Manager] 预扫描内嵌世界书失败:', e);
            }
        }
    }

    // 2. 扫描全局目录 (library/lorebooks)
    if (wiType === 'all' || wiType === 'global') {
        if (fs.existsSync(lorebooksDir)) {
            scanGlobalWorldbooks(lorebooksDir, items, searchLower, embeddedNameSet, embeddedSigSet, resourceLoreDirs, libraryRoot);
        }
    }

    // 3. 扫描内嵌世界书 (library/characters)
    if (wiType === 'all' || wiType === 'embedded') {
        if (fs.existsSync(charactersDir)) {
            scanEmbeddedWorldbooksForList(charactersDir, items, searchLower);
        }
    }

    // 按修改时间倒序
    items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

    // 分页
    const total = items.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
        success: true,
        items: items.slice(start, end),
        total,
        page,
        pageSize,
    };
}

/**
 * 预扫描内嵌世界书（收集名称和签名）
 */
function scanEmbeddedWorldbooks(charactersDir, nameSet, sigSet) {
    const files = fs.readdirSync(charactersDir);

    for (const file of files) {
        if (!file.toLowerCase().endsWith('.png') && !file.toLowerCase().endsWith('.json')) continue;

        const fullPath = path.join(charactersDir, file);
        try {
            const stat = fs.statSync(fullPath);
            if (!stat.isFile()) continue;

            let cardData = null;
            if (file.toLowerCase().endsWith('.png')) {
                cardData = extractPngMetadata(fullPath);
            } else {
                cardData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            }

            if (!cardData) continue;

            const data = cardData.data || cardData;
            const book = data.character_book;
            if (!book) continue;

            const bookName = book.name || data.character_book_name || `${data.name || file}'s WI`;
            if (bookName) {
                nameSet.add(String(bookName).trim().toLowerCase());
            }

            const sig = computeWiSignature(book);
            if (sig) {
                sigSet.add(sig);
            }
        } catch (e) {
            // 跳过
        }
    }
}

/**
 * 扫描全局世界书目录
 */
function scanGlobalWorldbooks(globalDir, items, search, embeddedNameSet, embeddedSigSet, resourceLoreDirs, dataRoot) {
    const files = fs.readdirSync(globalDir);

    for (const file of files) {
        if (!file.toLowerCase().endsWith('.json')) continue;

        const fullPath = path.join(globalDir, file);

        // 排除资源目录
        const normalizedPath = path.normalize(fullPath);
        let isInResourceDir = false;
        for (const loreDir of resourceLoreDirs) {
            if (normalizedPath.startsWith(loreDir)) {
                isInResourceDir = true;
                break;
            }
        }
        if (isInResourceDir) continue;

        try {
            const stat = fs.statSync(fullPath);
            if (!stat.isFile()) continue;

            const content = fs.readFileSync(fullPath, 'utf-8');
            const data = JSON.parse(content);

            const name = file.replace('.json', '');
            const entryCount = countEntries(data);

            // 检查是否与内嵌世界书重复
            const nameLower = name.toLowerCase();
            const isDuplicateName = embeddedNameSet.has(nameLower);

            const sig = computeWiSignature(data);
            const isDuplicateSig = sig && embeddedSigSet.has(sig);

            const item = {
                id: `global::${file}`,
                name,
                filename: file,
                type: 'global',
                path: path.relative(dataRoot, fullPath).replace(/\\/g, '/'),
                entryCount,
                mtime: stat.mtimeMs,
                size: stat.size,
                isDuplicate: isDuplicateName || isDuplicateSig,
            };

            // 跳过重复的世界书（角色绑定的世界书不应出现在全局列表中）
            if (isDuplicateName || isDuplicateSig) continue;

            // 搜索过滤
            if (search) {
                const haystack = `${item.name} ${item.filename}`.toLowerCase();
                if (!haystack.includes(search)) continue;
            }

            items.push(item);
        } catch (e) {
            // 跳过
        }
    }
}

/**
 * 扫描资源世界书目录
 */
function scanResourceWorldbooks(resourcesRoot, lorebookSub, items, search, dataRoot) {
    const folders = fs.readdirSync(resourcesRoot);

    for (const folder of folders) {
        const folderPath = path.join(resourcesRoot, folder);

        try {
            const folderStat = fs.statSync(folderPath);
            if (!folderStat.isDirectory()) continue;

            const loreDir = path.join(folderPath, lorebookSub);
            if (!fs.existsSync(loreDir)) continue;

            const files = fs.readdirSync(loreDir);
            for (const file of files) {
                if (!file.toLowerCase().endsWith('.json')) continue;

                const fullPath = path.join(loreDir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (!stat.isFile()) continue;

                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const data = JSON.parse(content);

                    const name = file.replace('.json', '');
                    const entryCount = countEntries(data);

                    const item = {
                        id: `resource::${folder}::${file}`,
                        name,
                        filename: file,
                        type: 'resource',
                        sourceFolder: folder,
                        path: path.relative(dataRoot, fullPath).replace(/\\/g, '/'),
                        entryCount,
                        mtime: stat.mtimeMs,
                        size: stat.size,
                    };

                    // 搜索过滤
                    if (search) {
                        const haystack = `${item.name} ${item.filename} ${folder}`.toLowerCase();
                        if (!haystack.includes(search)) continue;
                    }

                    items.push(item);
                } catch (e) {
                    // 跳过
                }
            }
        } catch (e) {
            // 跳过
        }
    }
}

/**
 * 扫描内嵌世界书（用于列表）
 */
function scanEmbeddedWorldbooksForList(charactersDir, items, search) {
    const files = fs.readdirSync(charactersDir);

    for (const file of files) {
        if (!file.toLowerCase().endsWith('.png') && !file.toLowerCase().endsWith('.json')) continue;

        const fullPath = path.join(charactersDir, file);
        try {
            const stat = fs.statSync(fullPath);
            if (!stat.isFile()) continue;

            let cardData = null;
            if (file.toLowerCase().endsWith('.png')) {
                cardData = extractPngMetadata(fullPath);
            } else {
                cardData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            }

            if (!cardData) continue;

            const data = cardData.data || cardData;
            const book = data.character_book;
            if (!book) continue;

            const cardName = data.name || file.replace(/\.(png|json)$/i, '');
            const bookName = book.name || data.character_book_name || `${cardName}'s WI`;
            const entryCount = countEntries(book);

            const item = {
                id: `embedded::${file}`,
                name: bookName,
                cardName,
                cardFile: file,
                type: 'embedded',
                entryCount,
                mtime: stat.mtimeMs,
            };

            // 搜索过滤
            if (search) {
                const haystack = `${item.name} ${item.cardName} ${item.cardFile}`.toLowerCase();
                if (!haystack.includes(search)) continue;
            }

            items.push(item);
        } catch (e) {
            // 跳过
        }
    }
}

/**
 * 获取单个世界书详情
 * 
 * @param {string} worldbookId - 世界书 ID
 * @returns {Object|null} 世界书数据
 */
function getWorldbook(worldbookId) {
    if (!worldbookId) return null;

    // 从插件的 library 目录读取
    const pluginDataDir = config.getPluginDataDir();
    const libraryRoot = path.join(pluginDataDir, 'library');

    // 保留用于 embedded 类型
    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const resourcesRoot = config.getResourcesRoot();
    const resourceSubDirs = config.getResourceSubDirs();

    const parts = worldbookId.split('::');

    if (parts[0] === 'global' && parts.length >= 2) {
        const filename = parts.slice(1).join('::');
        const fullPath = path.join(libraryRoot, 'lorebooks', filename);

        if (fs.existsSync(fullPath)) {
            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                return {
                    id: worldbookId,
                    filename,
                    type: 'global',
                    path: fullPath,
                    data: JSON.parse(content),
                };
            } catch (e) {
                console.error('[ST Manager] 读取世界书失败:', e);
            }
        }
    } else if (parts[0] === 'resource' && parts.length >= 3) {
        const folder = parts[1];
        const filename = parts.slice(2).join('::');
        const fullPath = path.join(resourcesRoot, folder, resourceSubDirs.lorebooks, filename);

        if (fs.existsSync(fullPath)) {
            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                return {
                    id: worldbookId,
                    filename,
                    type: 'resource',
                    sourceFolder: folder,
                    path: fullPath,
                    data: JSON.parse(content),
                };
            } catch (e) {
                console.error('[ST Manager] 读取世界书失败:', e);
            }
        }
    } else if (parts[0] === 'embedded' && parts.length >= 2) {
        const cardFile = parts.slice(1).join('::');
        const fullPath = path.join(libraryRoot, 'characters', cardFile);

        if (fs.existsSync(fullPath)) {
            try {
                let cardData = null;
                if (cardFile.toLowerCase().endsWith('.png')) {
                    cardData = extractPngMetadata(fullPath);
                } else {
                    cardData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                }

                if (cardData) {
                    const data = cardData.data || cardData;
                    const book = data.character_book;
                    if (book) {
                        return {
                            id: worldbookId,
                            cardFile,
                            type: 'embedded',
                            cardName: data.name,
                            path: fullPath,
                            data: book,
                        };
                    }
                }
            } catch (e) {
                console.error('[ST Manager] 读取内嵌世界书失败:', e);
            }
        }
    }

    return null;
}

/**
 * 保存世界书
 */
function saveWorldbook(worldbookId, data) {
    if (!worldbookId || !data) {
        return { success: false, error: '缺少必要参数' };
    }

    const wb = getWorldbook(worldbookId);
    if (!wb) {
        return { success: false, error: '世界书不存在' };
    }

    if (wb.type === 'embedded') {
        // 内嵌世界书需要修改角色卡
        return { success: false, error: '暂不支持修改内嵌世界书' };
    }

    try {
        fs.writeFileSync(wb.path, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 保存世界书失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 删除世界书
 */
function deleteWorldbook(worldbookId) {
    if (!worldbookId) {
        return { success: false, error: '缺少世界书 ID' };
    }

    const wb = getWorldbook(worldbookId);
    if (!wb) {
        return { success: false, error: '世界书不存在' };
    }

    if (wb.type === 'embedded') {
        return { success: false, error: '无法删除内嵌世界书' };
    }

    try {
        fs.unlinkSync(wb.path);
        return { success: true };
    } catch (e) {
        console.error('[ST Manager] 删除世界书失败:', e);
        return { success: false, error: e.message };
    }
}

/**
 * 获取世界书统计
 */
function getStats() {
    const result = listWorldbooks('all', '', 1, 999999);
    const items = result.items || [];

    return {
        total: items.length,
        global: items.filter(i => i.type === 'global').length,
        resource: items.filter(i => i.type === 'resource').length,
        embedded: items.filter(i => i.type === 'embedded').length,
        duplicates: items.filter(i => i.isDuplicate).length,
    };
}

module.exports = {
    listWorldbooks,
    getWorldbook,
    saveWorldbook,
    deleteWorldbook,
    getStats,
    extractPngMetadata,
    normalizeWiEntries,
    computeWiSignature,
    countEntries,
};
