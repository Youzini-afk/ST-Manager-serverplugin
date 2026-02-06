/**
 * 角色卡管理模块
 * 
 * 完整复刻 Python 后端的 cards.py 核心功能
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');
const { resolveInside } = require('../utils/safePath');

// PNG 元数据提取
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const ROOT_PRIORITY = [
    'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
    'creatorcomment', 'avatar', 'talkativeness', 'fav', 'tags',
    'spec', 'spec_version', 'data', 'create_date',
];
const DATA_PRIORITY = [
    'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
    'creator_notes', 'system_prompt', 'post_history_instructions',
    'tags', 'creator', 'character_version', 'alternate_greetings',
    'extensions', 'group_only_greetings', 'character_book',
];
const EXTENSION_PRIORITY = [
    'id', 'scriptName', 'name', 'enabled', 'disabled',
    'findRegex', 'replaceString', 'trimStrings', 'placement',
    'runOnEdit', 'markdownOnly', 'promptOnly',
    'minDepth', 'maxDepth', 'substituteRegex',
    'type', 'content', 'info', 'button', 'data',
    'top', 'bottom', 'left', 'right',
];
let CRC_TABLE = null;

function _getCharactersDir() {
    return path.join(config.getPluginDataDir(), 'library', 'characters');
}

function _safeJsonParse(raw) {
    try {
        return JSON.parse(raw);
    } catch (_e) {
        return null;
    }
}

function _normalizeCardId(cardId) {
    return String(cardId || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function _getDataBlock(cardData) {
    if (cardData && cardData.data && typeof cardData.data === 'object' && !Array.isArray(cardData.data)) {
        return cardData.data;
    }
    return cardData;
}

function _buildCrcTable() {
    const table = new Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
}

function _crc32(buffer) {
    if (!CRC_TABLE) {
        CRC_TABLE = _buildCrcTable();
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function _buildPngChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length, 0);
    const crcBuffer = Buffer.alloc(4);
    const crcValue = _crc32(Buffer.concat([typeBuffer, data]));
    crcBuffer.writeUInt32BE(crcValue >>> 0, 0);
    return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function _parsePngChunks(buffer) {
    if (buffer.length < 8 || !buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
        return null;
    }
    let offset = 8;
    const chunks = [];
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const crcEnd = dataEnd + 4;
        if (crcEnd > buffer.length) break;
        chunks.push({
            type,
            data: buffer.slice(dataStart, dataEnd),
        });
        offset = crcEnd;
        if (type === 'IEND') break;
    }
    return chunks;
}

function _parseTextChunkData(data) {
    const nullIndex = data.indexOf(0);
    if (nullIndex <= 0) return null;
    return {
        keyword: data.slice(0, nullIndex).toString('latin1'),
        text: data.slice(nullIndex + 1).toString('latin1'),
    };
}

function _parseZtxtChunkData(data) {
    const nullIndex = data.indexOf(0);
    if (nullIndex <= 0 || nullIndex + 2 > data.length) return null;
    const keyword = data.slice(0, nullIndex).toString('latin1');
    const compressed = data.slice(nullIndex + 2);
    try {
        return {
            keyword,
            text: zlib.inflateSync(compressed).toString('utf-8'),
        };
    } catch (_e) {
        return null;
    }
}

function _parseItxtChunkData(data) {
    const firstNull = data.indexOf(0);
    if (firstNull <= 0) return null;
    const keyword = data.slice(0, firstNull).toString('latin1');
    const compressionFlag = data[firstNull + 1];
    let cursor = firstNull + 3;
    if (cursor > data.length) return null;
    const langEnd = data.indexOf(0, cursor);
    if (langEnd === -1) return null;
    cursor = langEnd + 1;
    const translatedEnd = data.indexOf(0, cursor);
    if (translatedEnd === -1) return null;
    cursor = translatedEnd + 1;
    const textPayload = data.slice(cursor);
    try {
        const text = compressionFlag === 1
            ? zlib.inflateSync(textPayload).toString('utf-8')
            : textPayload.toString('utf-8');
        return { keyword, text };
    } catch (_e) {
        return null;
    }
}

function _decodeMetadataText(rawText) {
    if (rawText === null || rawText === undefined) return null;
    const text = String(rawText).trim();
    if (!text) return null;

    if (text.startsWith('{') || text.startsWith('[')) {
        const direct = _safeJsonParse(text);
        if (direct) return direct;
    }

    const base64Candidates = [text];
    if (text.includes('-') || text.includes('_')) {
        base64Candidates.push(text.replace(/-/g, '+').replace(/_/g, '/'));
    }

    for (const candidate of base64Candidates) {
        const padded = candidate + '='.repeat((4 - (candidate.length % 4)) % 4);
        try {
            const decoded = Buffer.from(padded, 'base64').toString('utf-8');
            const parsed = _safeJsonParse(decoded);
            if (parsed) return parsed;
        } catch (_e) {
            // continue
        }
    }

    return null;
}

function _deterministicSort(value, level = 'root') {
    if (Array.isArray(value)) {
        return value.map(item => _deterministicSort(item, level === 'extensions' ? 'extension_item' : level));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    const keys = Object.keys(value);
    const keySet = new Set(keys);
    let priorities = [];
    if (level === 'root') priorities = ROOT_PRIORITY;
    if (level === 'data') priorities = DATA_PRIORITY;
    if (level === 'extension_item') priorities = EXTENSION_PRIORITY;

    const orderedKeys = [];
    for (const key of priorities) {
        if (keySet.has(key)) orderedKeys.push(key);
    }
    for (const key of keys.sort()) {
        if (!orderedKeys.includes(key)) orderedKeys.push(key);
    }

    const result = {};
    for (const key of orderedKeys) {
        const nextLevel = key === 'data'
            ? 'data'
            : (key === 'extensions' || level === 'extensions' ? 'extensions' : level);
        result[key] = _deterministicSort(value[key], nextLevel);
    }
    return result;
}

function _normalizeCardV3(cardData) {
    if (!cardData || typeof cardData !== 'object' || Array.isArray(cardData)) {
        return cardData;
    }
    const normalized = { ...cardData };
    if (!normalized.data || typeof normalized.data !== 'object' || Array.isArray(normalized.data)) {
        const data = { ...normalized };
        delete data.spec;
        delete data.spec_version;
        delete data.data;
        normalized.data = data;
    }

    normalized.spec = 'chara_card_v3';
    normalized.spec_version = normalized.spec_version || '3.0';

    const dataBlock = normalized.data;
    const coreFields = [
        'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
        'creator_notes', 'system_prompt', 'post_history_instructions', 'tags',
        'creator', 'character_version', 'alternate_greetings', 'extensions', 'character_book',
    ];
    const keyMapping = {
        creator_notes: 'creatorcomment',
    };

    for (const field of coreFields) {
        if (dataBlock[field] !== undefined) continue;
        const rootKey = keyMapping[field] || field;
        if (normalized[rootKey] !== undefined) {
            dataBlock[field] = normalized[rootKey];
        }
    }

    if (normalized.character_book !== undefined) {
        if (dataBlock.character_book === undefined) {
            dataBlock.character_book = normalized.character_book;
        }
        delete normalized.character_book;
    }

    if (normalized.extensions !== undefined) {
        if (dataBlock.extensions === undefined) {
            dataBlock.extensions = normalized.extensions;
        }
        delete normalized.extensions;
    }

    delete dataBlock.spec;
    delete dataBlock.spec_version;
    delete dataBlock.data;

    return normalized;
}

function _normalizeComparable(value) {
    if (Array.isArray(value)) {
        const items = value
            .map(item => _normalizeComparable(item))
            .filter(item => item !== undefined && item !== null && item !== '' && !(Array.isArray(item) && item.length === 0) && !(item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0));
        return items;
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            const normalized = _normalizeComparable(item);
            if (normalized === undefined || normalized === null || normalized === '') continue;
            if (Array.isArray(normalized) && normalized.length === 0) continue;
            if (normalized && typeof normalized === 'object' && !Array.isArray(normalized) && Object.keys(normalized).length === 0) continue;
            result[key] = normalized;
        }
        return result;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || '';
    }
    return value;
}

function _writeCardMetadata(filePath, cardData) {
    const ext = path.extname(filePath).toLowerCase();
    const normalizedCard = _normalizeCardV3(cardData);
    const sortedJson = _deterministicSort(normalizedCard, 'root');
    if (ext === '.json') {
        const json = `${JSON.stringify(sortedJson, null, 2)}\n`;
        fs.writeFileSync(filePath, json, 'utf-8');
        return true;
    }

    const useDeterministic = Boolean(config.get()?.png_deterministic_sort);
    const payload = useDeterministic ? sortedJson : normalizedCard;
    const metadataText = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    const sourceBuffer = fs.readFileSync(filePath);
    const chunks = _parsePngChunks(sourceBuffer);
    if (!chunks) {
        return false;
    }

    const output = [PNG_SIGNATURE];
    let inserted = false;

    for (const chunk of chunks) {
        if (chunk.type === 'tEXt' || chunk.type === 'zTXt' || chunk.type === 'iTXt') {
            const parsed = chunk.type === 'tEXt'
                ? _parseTextChunkData(chunk.data)
                : (chunk.type === 'zTXt' ? _parseZtxtChunkData(chunk.data) : _parseItxtChunkData(chunk.data));
            if (parsed && (parsed.keyword === 'chara' || parsed.keyword === 'ccv3')) {
                continue;
            }
        }
        if (chunk.type === 'IEND' && !inserted) {
            const textChunkData = Buffer.from(`chara\0${metadataText}`, 'latin1');
            output.push(_buildPngChunk('tEXt', textChunkData));
            inserted = true;
        }
        output.push(_buildPngChunk(chunk.type, chunk.data));
    }

    if (!inserted) {
        const textChunkData = Buffer.from(`chara\0${metadataText}`, 'latin1');
        output.push(_buildPngChunk('tEXt', textChunkData));
        output.push(_buildPngChunk('IEND', Buffer.alloc(0)));
    }

    fs.writeFileSync(filePath, Buffer.concat(output));
    return true;
}

/**
 * 从 PNG 文件提取角色卡数据
 */
function extractPngMetadata(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        const chunks = _parsePngChunks(buffer);
        if (!chunks) return null;

        for (const chunk of chunks) {
            if (chunk.type !== 'tEXt' && chunk.type !== 'zTXt' && chunk.type !== 'iTXt') continue;
            const parsed = chunk.type === 'tEXt'
                ? _parseTextChunkData(chunk.data)
                : (chunk.type === 'zTXt' ? _parseZtxtChunkData(chunk.data) : _parseItxtChunkData(chunk.data));
            if (!parsed || (parsed.keyword !== 'chara' && parsed.keyword !== 'ccv3')) continue;
            const decoded = _decodeMetadataText(parsed.text);
            if (decoded) {
                return decoded;
            }
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
                        thumb_url: `/api/thumbnail/${encodeURIComponent(relativePath)}`,
                        image_url: `/api/thumbnail/${encodeURIComponent(relativePath)}`,
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

    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');

    const items = [];

    if (!fs.existsSync(charactersDir)) {
        return { success: true, items: [], total: 0, page, pageSize };
    }

    // 递归扫描
    scanCardsRecursive(charactersDir, charactersDir, items);

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

    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');
    const fullPath = resolveInside(charactersDir, cardId);

    if (!fullPath || !fs.existsSync(fullPath)) return null;

    try {
        const stat = fs.statSync(fullPath);
        let cardData = null;
        const ext = path.extname(fullPath).toLowerCase();

        if (ext === '.png') {
            cardData = extractPngMetadata(fullPath);
        } else {
            cardData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        }

        return {
            id: cardId,
            path: fullPath,
            imagePath: ext === '.png' ? fullPath : null,
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
    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');

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

    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');
    const sourcePath = resolveInside(charactersDir, cardId);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { success: false, error: '卡片不存在' };
    }

    const filename = path.basename(cardId);
    const targetDir = targetFolder ? resolveInside(charactersDir, targetFolder) : charactersDir;
    if (!targetDir) {
        return { success: false, error: '无效目标路径' };
    }
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
        _moveFileSafely(sourcePath, targetPath);
        const newId = path.relative(charactersDir, targetPath).replace(/\\/g, '/');
        return { success: true, newId };
    } catch (e) {
        console.error('[ST Manager] 移动卡片失败:', e);
        return { success: false, error: e.message };
    }
}

function findCardPage(cardId, options = {}) {
    const normalizedId = _normalizeCardId(cardId);
    if (!normalizedId) {
        return { success: false, page: 1, msg: '缺少卡片 ID' };
    }

    const { category = '', sort = 'mtime_desc', pageSize = 50 } = options || {};
    const normalizedCategory = _sanitizeRelativeFolder(category || '');
    const pageSizeNum = Math.max(1, parseInt(pageSize, 10) || 50);

    const listed = listCards({
        folder: normalizedCategory,
        sort,
        page: 1,
        pageSize: 999999,
    });
    const items = Array.isArray(listed.items) ? listed.items : [];
    const index = items.findIndex(item => _normalizeCardId(item.id) === normalizedId);

    if (index < 0) {
        return { success: false, page: 1, msg: '卡片不在当前筛选结果中' };
    }

    return {
        success: true,
        page: Math.floor(index / pageSizeNum) + 1,
        index,
        total: items.length,
    };
}

/**
 * 文件名安全化
 */
function _sanitizeFilename(input) {
    return String(input || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim();
}

function _sanitizeFolderSegment(name) {
    const sanitized = String(name || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\u0000/g, '')
        .trim();
    if (!sanitized || sanitized === '.' || sanitized === '..') return '';
    return sanitized;
}

function _sanitizeRelativeFolder(input) {
    if (!input) return '';
    const normalized = String(input)
        .replace(/\\/g, '/')
        .split('/')
        .map(segment => _sanitizeFolderSegment(segment))
        .filter(Boolean)
        .join('/');
    if (!normalized || normalized === '.') return '';
    return normalized;
}

function _resolveUiKey(uiData, cardId) {
    const normalizedId = _normalizeCardId(cardId);
    if (!normalizedId) return null;
    if (uiData[normalizedId]) return normalizedId;

    const ext = path.extname(normalizedId).toLowerCase();
    if (ext === '.png') {
        const alt = `${normalizedId.slice(0, -4)}.json`;
        if (uiData[alt]) return alt;
    } else if (ext === '.json') {
        const alt = `${normalizedId.slice(0, -5)}.png`;
        if (uiData[alt]) return alt;
    }

    const parent = path.posix.dirname(normalizedId);
    if (parent && parent !== '.' && uiData[parent]) {
        return parent;
    }
    return normalizedId;
}

function _migrateUiEntry(uiData, oldId, newId) {
    const oldKey = _resolveUiKey(uiData, oldId);
    if (!oldKey || !uiData[oldKey]) return false;
    const newKey = _resolveUiKey(uiData, newId);
    if (!newKey || oldKey === newKey) return false;

    if (!uiData[newKey] || typeof uiData[newKey] !== 'object') {
        uiData[newKey] = {};
    }
    uiData[newKey] = { ...uiData[oldKey], ...uiData[newKey] };
    delete uiData[oldKey];
    return true;
}

function _normalizeTagList(tags) {
    let list = [];
    if (Array.isArray(tags)) {
        list = tags;
    } else if (typeof tags === 'string') {
        list = tags.split(/[,\n]/g);
    }
    const seen = new Set();
    const normalized = [];
    for (const tag of list) {
        const item = String(tag || '').trim();
        if (!item || seen.has(item)) continue;
        seen.add(item);
        normalized.push(item);
    }
    return normalized;
}

function _listSidecarImagesForJson(jsonPath) {
    const base = path.join(path.dirname(jsonPath), path.basename(jsonPath, '.json'));
    const candidates = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.bmp'];
    const result = [];
    for (const ext of candidates) {
        const candidate = `${base}${ext}`;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            result.push(candidate);
        }
    }
    return result;
}

function _moveFileSafely(sourcePath, targetPath) {
    try {
        fs.renameSync(sourcePath, targetPath);
    } catch (e) {
        fs.copyFileSync(sourcePath, targetPath);
        try {
            fs.unlinkSync(sourcePath);
        } catch (_unlinkError) {
            // ignore temp-source cleanup failure
        }
    }
}

function _migrateUiEntryToBundle(uiData, oldId, bundleDir) {
    const oldKey = _resolveUiKey(uiData, oldId);
    if (!oldKey || !uiData[oldKey]) return false;
    const source = uiData[oldKey];
    if (!uiData[bundleDir] || typeof uiData[bundleDir] !== 'object') {
        uiData[bundleDir] = {};
    }
    if (source.summary !== undefined && !uiData[bundleDir].summary) {
        uiData[bundleDir].summary = source.summary;
    }
    if (source.link !== undefined && !uiData[bundleDir].link) {
        uiData[bundleDir].link = source.link;
    }
    if (source.resource_folder !== undefined && !uiData[bundleDir].resource_folder) {
        uiData[bundleDir].resource_folder = source.resource_folder;
    }
    delete uiData[oldKey];
    return true;
}

function _collectCardsInFolder(folderPath) {
    const charactersDir = _getCharactersDir();
    const fullPath = resolveInside(charactersDir, folderPath);
    if (!fullPath || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return [];
    }
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const cardsInDir = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.png' && ext !== '.json') continue;
        const abs = path.join(fullPath, entry.name);
        const rel = path.relative(charactersDir, abs).replace(/\\/g, '/');
        const parsed = _loadCardPayload(abs);
        const data = _getDataBlock(parsed) || {};
        const tags = _normalizeTagList(data.tags);
        const stat = fs.statSync(abs);
        cardsInDir.push({
            id: rel,
            filename: entry.name,
            fullPath: abs,
            mtime: stat.mtimeMs,
            tags,
        });
    }
    return cardsInDir;
}

function _setIfChanged(target, key, value) {
    const before = JSON.stringify(_normalizeComparable(target[key]));
    const after = JSON.stringify(_normalizeComparable(value));
    if (before === after) return false;
    target[key] = value;
    return true;
}

function _applyCardPayload(cardData, payload) {
    if (!cardData || typeof cardData !== 'object') return false;
    const wrapped = cardData.data && typeof cardData.data === 'object' && !Array.isArray(cardData.data);
    const dataBlock = wrapped ? cardData.data : cardData;
    let changed = false;

    const fieldMap = {
        char_name: 'name',
        name: 'name',
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
    const rootSync = new Set([
        'name',
        'description',
        'personality',
        'scenario',
        'first_mes',
        'mes_example',
        'tags',
    ]);

    for (const [from, to] of Object.entries(fieldMap)) {
        if (!Object.prototype.hasOwnProperty.call(payload, from)) continue;
        const value = payload[from];
        if (_setIfChanged(dataBlock, to, value)) {
            changed = true;
            if (wrapped) {
                const rootKey = to === 'creator_notes' ? 'creatorcomment' : to;
                if (rootSync.has(to) || Object.prototype.hasOwnProperty.call(cardData, rootKey)) {
                    cardData[rootKey] = value;
                }
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'alternate_greetings') && Array.isArray(payload.alternate_greetings)) {
        const greetings = payload.alternate_greetings
            .map(item => String(item || '').trim())
            .filter(Boolean);
        if (_setIfChanged(dataBlock, 'alternate_greetings', greetings)) {
            changed = true;
            if (wrapped && Object.prototype.hasOwnProperty.call(cardData, 'alternate_greetings')) {
                cardData.alternate_greetings = greetings;
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'tags') && Array.isArray(payload.tags)) {
        const normalizedTags = _normalizeTagList(payload.tags);
        if (_setIfChanged(dataBlock, 'tags', normalizedTags)) {
            changed = true;
            if (wrapped && Object.prototype.hasOwnProperty.call(cardData, 'tags')) {
                cardData.tags = normalizedTags;
            }
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'extensions') && payload.extensions && typeof payload.extensions === 'object') {
        if (_setIfChanged(dataBlock, 'extensions', payload.extensions)) {
            changed = true;
        }
    }

    if (typeof payload.character_book_raw === 'string' && payload.character_book_raw.trim()) {
        const parsed = _safeJsonParse(payload.character_book_raw);
        if (!parsed) {
            throw new Error('世界书 JSON 格式错误');
        }
        if (_setIfChanged(dataBlock, 'character_book', parsed)) {
            changed = true;
        }
    } else if (Object.prototype.hasOwnProperty.call(payload, 'character_book')) {
        if (_setIfChanged(dataBlock, 'character_book', payload.character_book)) {
            changed = true;
        }
    }

    return changed;
}

function _loadCardPayload(fullPath) {
    const ext = path.extname(fullPath).toLowerCase();
    if (ext === '.png') {
        return extractPngMetadata(fullPath);
    }
    const raw = fs.readFileSync(fullPath, 'utf-8');
    return _safeJsonParse(raw);
}

function readCardFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return _loadCardPayload(filePath);
}

function writeCardMetadataFile(filePath, cardData) {
    if (!filePath || !cardData) return false;
    return _writeCardMetadata(filePath, cardData);
}

function _updateTagsInternal(cardId, addTags = [], removeTags = []) {
    const normalizedId = _normalizeCardId(cardId);
    const charactersDir = _getCharactersDir();
    const fullPath = resolveInside(charactersDir, normalizedId);
    if (!fullPath || !fs.existsSync(fullPath)) {
        return { cardId: normalizedId, success: false, changed: false, error: '卡片不存在' };
    }

    const cardData = _loadCardPayload(fullPath);
    if (!cardData || typeof cardData !== 'object') {
        return { cardId: normalizedId, success: false, changed: false, error: '卡片元数据读取失败' };
    }

    const dataBlock = _getDataBlock(cardData);
    const beforeTags = _normalizeTagList(dataBlock && dataBlock.tags);
    const tagSet = new Set(beforeTags);

    for (const tag of _normalizeTagList(addTags)) {
        tagSet.add(tag);
    }
    for (const tag of _normalizeTagList(removeTags)) {
        tagSet.delete(tag);
    }

    const afterTags = Array.from(tagSet);
    const changed = beforeTags.length !== afterTags.length || beforeTags.some((item, idx) => item !== afterTags[idx]);
    if (!changed) {
        return { cardId: normalizedId, success: true, changed: false, tags: beforeTags };
    }

    dataBlock.tags = afterTags;
    if (cardData.data && typeof cardData.data === 'object' && !Array.isArray(cardData.data) && Array.isArray(cardData.tags)) {
        cardData.tags = afterTags;
    }

    if (!_writeCardMetadata(fullPath, cardData)) {
        return { cardId: normalizedId, success: false, changed: false, error: '写入卡片元数据失败' };
    }

    return {
        cardId: normalizedId,
        success: true,
        changed: true,
        oldTags: beforeTags,
        tags: afterTags,
    };
}

function _buildUpdatedCard(id, cardData, uiEntry = {}) {
    const dataBlock = _getDataBlock(cardData) || {};
    const category = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
    return {
        id,
        filename: path.basename(id),
        char_name: dataBlock.name || '',
        description: dataBlock.description || '',
        first_mes: dataBlock.first_mes || '',
        mes_example: dataBlock.mes_example || '',
        creator_notes: dataBlock.creator_notes || '',
        personality: dataBlock.personality || '',
        scenario: dataBlock.scenario || '',
        system_prompt: dataBlock.system_prompt || '',
        post_history_instructions: dataBlock.post_history_instructions || '',
        character_book: dataBlock.character_book || null,
        extensions: dataBlock.extensions || {},
        tags: Array.isArray(dataBlock.tags) ? dataBlock.tags : [],
        category,
        creator: dataBlock.creator || '',
        char_version: dataBlock.character_version || '',
        image_url: `/api/thumbnail/${encodeURIComponent(id)}`,
        thumb_url: `/api/thumbnail/${encodeURIComponent(id)}`,
        ui_summary: uiEntry.summary || '',
        source_link: uiEntry.link || '',
        resource_folder: uiEntry.resource_folder || '',
        is_favorite: Boolean(uiEntry.is_favorite ?? uiEntry.favorite),
    };
}

function updateCard(cardId, payload = {}) {
    const normalizedId = _normalizeCardId(cardId);
    if (!normalizedId) {
        return { success: false, msg: '缺少卡片 ID' };
    }

    const charactersDir = _getCharactersDir();
    const sourcePath = resolveInside(charactersDir, normalizedId);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { success: false, msg: '卡片不存在' };
    }

    const cardData = _loadCardPayload(sourcePath);
    if (!cardData || typeof cardData !== 'object') {
        return { success: false, msg: '卡片元数据读取失败' };
    }

    let metadataChanged = false;
    try {
        metadataChanged = _applyCardPayload(cardData, payload);
    } catch (e) {
        return { success: false, msg: e.message };
    }

    if (metadataChanged && !_writeCardMetadata(sourcePath, cardData)) {
        return { success: false, msg: '写入卡片元数据失败' };
    }

    let finalPath = sourcePath;
    let finalId = normalizedId;
    let renamed = false;

    let requestedFilename = Object.prototype.hasOwnProperty.call(payload, 'new_filename')
        ? _sanitizeFilename(payload.new_filename)
        : path.basename(normalizedId);
    if (!requestedFilename) {
        return { success: false, msg: '非法文件名' };
    }

    const oldFilename = path.basename(normalizedId);
    const oldExt = path.extname(oldFilename).toLowerCase();
    let newExt = path.extname(requestedFilename).toLowerCase();
    if (!newExt) {
        requestedFilename = `${requestedFilename}${oldExt}`;
        newExt = oldExt;
    }
    if (newExt !== oldExt) {
        return { success: false, msg: '不支持通过保存修改文件扩展名' };
    }

    if (requestedFilename !== oldFilename) {
        const targetPath = path.join(path.dirname(sourcePath), requestedFilename);
        const samePath = path.resolve(targetPath).toLowerCase() === path.resolve(sourcePath).toLowerCase();
        if (!samePath && fs.existsSync(targetPath)) {
            return { success: false, msg: `目标文件名已存在: ${requestedFilename}` };
        }
        try {
            _moveFileSafely(sourcePath, targetPath);
        } catch (e) {
            return { success: false, msg: `重命名失败: ${e.message}` };
        }
        finalPath = targetPath;
        finalId = path.relative(charactersDir, targetPath).replace(/\\/g, '/');
        renamed = true;
    }

    const uiData = config.loadUiData ? config.loadUiData() : {};
    let uiChanged = false;
    if (renamed) {
        uiChanged = _migrateUiEntry(uiData, normalizedId, finalId) || uiChanged;
    }
    const uiKey = _resolveUiKey(uiData, finalId);
    if (uiKey) {
        if (!uiData[uiKey] || typeof uiData[uiKey] !== 'object') {
            uiData[uiKey] = {};
            uiChanged = true;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'ui_summary') && uiData[uiKey].summary !== payload.ui_summary) {
            uiData[uiKey].summary = payload.ui_summary;
            uiChanged = true;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'source_link')) {
            const link = String(payload.source_link || '').trim();
            if (uiData[uiKey].link !== link) {
                uiData[uiKey].link = link;
                uiChanged = true;
            }
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'resource_folder')) {
            const folder = _sanitizeRelativeFolder(payload.resource_folder || '');
            if (uiData[uiKey].resource_folder !== folder) {
                uiData[uiKey].resource_folder = folder;
                uiChanged = true;
            }
        }
    }
    if (uiChanged && config.saveUiData) {
        config.saveUiData(uiData);
    }

    const reloaded = _loadCardPayload(finalPath) || cardData;
    const updatedCard = _buildUpdatedCard(finalId, reloaded, uiKey ? (uiData[uiKey] || {}) : {});
    if (renamed) {
        updatedCard._old_id = normalizedId;
    }

    return {
        success: true,
        new_id: renamed ? finalId : undefined,
        new_filename: renamed ? path.basename(finalId) : undefined,
        file_modified: metadataChanged || renamed,
        updated_card: updatedCard,
    };
}

function toggleFavorite(cardId) {
    const normalizedId = _normalizeCardId(cardId);
    if (!normalizedId) {
        return { success: false, msg: '缺少卡片 ID' };
    }

    const uiData = config.loadUiData ? config.loadUiData() : {};
    const uiKey = _resolveUiKey(uiData, normalizedId);
    if (!uiKey) {
        return { success: false, msg: '无效卡片 ID' };
    }
    if (!uiData[uiKey] || typeof uiData[uiKey] !== 'object') {
        uiData[uiKey] = {};
    }

    const nextStatus = !Boolean(uiData[uiKey].is_favorite ?? uiData[uiKey].favorite);
    uiData[uiKey].is_favorite = nextStatus;
    uiData[uiKey].favorite = nextStatus;
    if (config.saveUiData) {
        config.saveUiData(uiData);
    }

    return { success: true, new_status: nextStatus, is_favorite: nextStatus };
}

function convertToBundle(cardId, bundleName) {
    const normalizedId = _normalizeCardId(cardId);
    const safeBundleName = _sanitizeFolderSegment(bundleName);
    if (!normalizedId || !safeBundleName) {
        return { success: false, msg: '参数不完整' };
    }

    const charactersDir = _getCharactersDir();
    const sourcePath = resolveInside(charactersDir, normalizedId);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { success: false, msg: '原文件不存在' };
    }

    const parentDir = path.dirname(sourcePath);
    const bundleDirPath = path.join(parentDir, safeBundleName);
    if (fs.existsSync(bundleDirPath)) {
        return { success: false, msg: `目标文件夹 '${safeBundleName}' 已存在` };
    }

    try {
        fs.mkdirSync(bundleDirPath, { recursive: true });

        const filename = path.basename(sourcePath);
        const targetPath = path.join(bundleDirPath, filename);
        _moveFileSafely(sourcePath, targetPath);

        if (path.extname(filename).toLowerCase() === '.json') {
            const oldSidecars = _listSidecarImagesForJson(sourcePath);
            for (const sidecar of oldSidecars) {
                const sidecarTarget = path.join(bundleDirPath, path.basename(sidecar));
                _moveFileSafely(sidecar, sidecarTarget);
            }
        }

        const markerPath = path.join(bundleDirPath, '.bundle');
        fs.writeFileSync(markerPath, '1', 'utf-8');

        const oldCategory = path.posix.dirname(normalizedId);
        const prefix = oldCategory && oldCategory !== '.' ? `${oldCategory}/` : '';
        const bundleDirRel = `${prefix}${safeBundleName}`;
        const newId = `${bundleDirRel}/${filename}`;

        const uiData = config.loadUiData ? config.loadUiData() : {};
        if (_migrateUiEntryToBundle(uiData, normalizedId, bundleDirRel) && config.saveUiData) {
            config.saveUiData(uiData);
        }

        return {
            success: true,
            msg: '转换成功',
            new_id: newId,
            new_bundle_dir: bundleDirRel,
        };
    } catch (e) {
        console.error('[ST Manager] 转换聚合包失败:', e);
        return { success: false, msg: e.message };
    }
}

function toggleBundleMode(folderPath, action = 'check') {
    const normalizedFolder = _sanitizeRelativeFolder(folderPath || '');
    if (!normalizedFolder) {
        return { success: false, msg: '路径为空' };
    }

    const charactersDir = _getCharactersDir();
    const fullPath = resolveInside(charactersDir, normalizedFolder);
    if (!fullPath || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return { success: false, msg: '目标文件夹不存在' };
    }

    const markerPath = path.join(fullPath, '.bundle');
    const cardsInDir = _collectCardsInFolder(normalizedFolder);
    const count = cardsInDir.length;

    if (action === 'disable') {
        try {
            if (fs.existsSync(markerPath)) {
                try {
                    fs.unlinkSync(markerPath);
                } catch (_unlinkErr) {
                    fs.writeFileSync(markerPath, '0', 'utf-8');
                }
            }
            return { success: true, msg: '已取消聚合。' };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    }

    if (!count) {
        return { success: false, msg: '该文件夹下没有角色卡，无法聚合。' };
    }

    if (action === 'enable') {
        try {
            const allTags = new Set();
            for (const item of cardsInDir) {
                for (const tag of item.tags) allTags.add(tag);
            }
            cardsInDir.sort((a, b) => b.mtime - a.mtime);
            const latest = cardsInDir[0];
            const latestData = _loadCardPayload(latest.fullPath);
            const latestBlock = _getDataBlock(latestData) || {};
            latestBlock.tags = Array.from(allTags);
            if (latestData.data && typeof latestData.data === 'object' && !Array.isArray(latestData.data) && Array.isArray(latestData.tags)) {
                latestData.tags = latestBlock.tags;
            }
            _writeCardMetadata(latest.fullPath, latestData);

            fs.writeFileSync(markerPath, '1', 'utf-8');
            return { success: true, msg: '聚合成功！标签已合并。' };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    }

    return {
        success: true,
        check_passed: true,
        count,
        sample_names: cardsInDir.slice(0, 3).map(item => item.filename),
    };
}

/**
 * 批量添加标签
 */
function addTags(cardIds, tags) {
    const ids = (Array.isArray(cardIds) ? cardIds : [cardIds]).filter(Boolean);
    const normalizedTags = _normalizeTagList(tags);
    if (!ids.length || !normalizedTags.length) {
        return { success: false, error: '缺少必要参数' };
    }

    const results = ids.map(cardId => _updateTagsInternal(cardId, normalizedTags, []));
    const updated = results.filter(item => item && item.success && item.changed).length;
    return { success: true, results, updated };
}

/**
 * 批量移除标签
 */
function removeTags(cardIds, tags) {
    const ids = (Array.isArray(cardIds) ? cardIds : [cardIds]).filter(Boolean);
    const normalizedTags = _normalizeTagList(tags);
    if (!ids.length || !normalizedTags.length) {
        return { success: false, error: '缺少必要参数' };
    }

    const results = ids.map(cardId => _updateTagsInternal(cardId, [], normalizedTags));
    const updated = results.filter(item => item && item.success && item.changed).length;
    return { success: true, results, updated };
}

/**
 * 删除角色卡
 */
function deleteCard(cardId, moveToTrash = true) {
    if (!cardId) {
        return { success: false, error: '缺少卡片 ID' };
    }

    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');
    const sourcePath = resolveInside(charactersDir, cardId);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { success: false, error: '卡片不存在' };
    }

    try {
        if (moveToTrash) {
            // 移动到回收站
            const trashDir = config.getTrashPath();
            if (!fs.existsSync(trashDir)) {
                fs.mkdirSync(trashDir, { recursive: true });
            }

            const filename = path.basename(cardId);
            const timestamp = Date.now();
            const trashPath = path.join(trashDir, `${timestamp}_${filename}`);

            _moveFileSafely(sourcePath, trashPath);
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

    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');
    const fullPath = resolveInside(charactersDir, folderPath);
    if (!fullPath) {
        return { success: false, error: '无效的文件夹路径' };
    }

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

    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');
    const sourcePath = resolveInside(charactersDir, oldPath);

    if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { success: false, error: '文件夹不存在' };
    }

    const parentDir = path.dirname(sourcePath);
    const targetPath = path.join(parentDir, newName);
    if (!resolveInside(charactersDir, path.relative(charactersDir, targetPath))) {
        return { success: false, error: '无效的目标路径' };
    }

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

    const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');
    const fullPath = resolveInside(charactersDir, folderPath);

    if (!fullPath || !fs.existsSync(fullPath)) {
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
    findCardPage,
    moveCard,
    updateCard,
    toggleFavorite,
    addTags,
    removeTags,
    convertToBundle,
    toggleBundleMode,
    deleteCard,
    createFolder,
    renameFolder,
    deleteFolder,
    getStats,
    getAllTags,
    extractPngMetadata,
    readCardFile,
    writeCardMetadataFile,
};

