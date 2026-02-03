/**
 * 资源管理模块
 * 
 * 处理角色卡、世界书、预设、正则脚本的读取和管理
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
        
        // 验证 PNG 签名
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
            
            // 移动到下一个 chunk
            offset += 12 + length;
        }
        
        return null;
    } catch (e) {
        console.error(`[ST Manager] 解析 PNG 失败 ${filePath}:`, e);
        return null;
    }
}

/**
 * 统计目录中的文件数
 */
function countFiles(dir, extensions = null) {
    if (!fs.existsSync(dir)) return 0;
    
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        if (entry.isDirectory()) {
            count += countFiles(path.join(dir, entry.name), extensions);
        } else if (!extensions || extensions.some(ext => entry.name.endsWith(ext))) {
            count++;
        }
    }
    
    return count;
}

/**
 * 获取资源统计
 */
function getStats() {
    const dataRoot = config.getDataRoot();
    const dirs = config.getResourceDirs();
    
    return {
        characters: countFiles(path.join(dataRoot, dirs.characters), ['.png', '.json']),
        worldbooks: countFiles(path.join(dataRoot, dirs.worldbooks), ['.json']),
        presets: countFiles(path.join(dataRoot, dirs.presets), ['.json']),
        regexScripts: countFiles(path.join(dataRoot, dirs.regexes), ['.json']),
    };
}

/**
 * 获取角色卡列表
 */
function listCards() {
    const dataRoot = config.getDataRoot();
    const dirs = config.getResourceDirs();
    const dir = path.join(dataRoot, dirs.characters);
    const items = [];
    
    if (!fs.existsSync(dir)) return items;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.png') && !file.endsWith('.json')) continue;
        
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        let cardData = null;
        if (file.endsWith('.png')) {
            cardData = extractPngMetadata(fullPath);
        } else if (file.endsWith('.json')) {
            try {
                cardData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            } catch (e) {
                // 解析失败
            }
        }
        
        items.push({
            id: file,
            name: cardData?.data?.name || cardData?.name || file.replace(/\.(png|json)$/, ''),
            filename: file,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            creator: cardData?.data?.creator || cardData?.creator || '',
            tags: cardData?.data?.tags || cardData?.tags || [],
            description: cardData?.data?.description?.substring(0, 200) || '',
        });
    }
    
    return items;
}

/**
 * 获取单个角色卡数据
 */
function getCard(cardId) {
    const dataRoot = config.getDataRoot();
    const dirs = config.getResourceDirs();
    const fullPath = path.join(dataRoot, dirs.characters, cardId);
    
    if (!fs.existsSync(fullPath)) return null;
    
    if (cardId.endsWith('.png')) {
        return extractPngMetadata(fullPath);
    } else if (cardId.endsWith('.json')) {
        return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    }
    
    return null;
}

/**
 * 获取世界书列表
 */
function listWorldbooks() {
    const dataRoot = config.getDataRoot();
    const dirs = config.getResourceDirs();
    const dir = path.join(dataRoot, dirs.worldbooks);
    const items = [];
    
    if (!fs.existsSync(dir)) return items;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        let entryCount = 0;
        try {
            const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            const entries = data.entries || [];
            entryCount = Array.isArray(entries) ? entries.length : Object.keys(entries).length;
        } catch (e) {
            // 解析失败
        }
        
        items.push({
            name: file.replace('.json', ''),
            filename: file,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            entryCount,
        });
    }
    
    return items;
}

/**
 * 获取预设列表
 */
function listPresets() {
    const dataRoot = config.getDataRoot();
    const dirs = config.getResourceDirs();
    const dir = path.join(dataRoot, dirs.presets);
    const items = [];
    
    if (!fs.existsSync(dir)) return items;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        items.push({
            name: file.replace('.json', ''),
            filename: file,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
        });
    }
    
    return items;
}

/**
 * 获取正则脚本列表
 */
function listRegexScripts() {
    const dataRoot = config.getDataRoot();
    const dirs = config.getResourceDirs();
    const dir = path.join(dataRoot, dirs.regexes);
    const items = [];
    
    if (!fs.existsSync(dir)) return items;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const fullPath = path.join(dir, file);
        
        try {
            const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            
            // 可能是单个脚本或数组
            if (Array.isArray(content)) {
                for (const script of content) {
                    items.push({
                        id: script.id || file,
                        name: script.scriptName || file.replace('.json', ''),
                        enabled: !script.disabled,
                        findRegex: script.findRegex || '',
                        replaceString: script.replaceString || '',
                        filename: file,
                    });
                }
            } else {
                items.push({
                    id: content.id || file,
                    name: content.scriptName || file.replace('.json', ''),
                    enabled: !content.disabled,
                    findRegex: content.findRegex || '',
                    replaceString: content.replaceString || '',
                    filename: file,
                });
            }
        } catch (e) {
            items.push({
                id: file,
                name: file.replace('.json', ''),
                enabled: false,
                filename: file,
                error: e.message,
            });
        }
    }
    
    return items;
}

module.exports = {
    getStats,
    listCards,
    getCard,
    listWorldbooks,
    listPresets,
    listRegexScripts,
    extractPngMetadata,
};
