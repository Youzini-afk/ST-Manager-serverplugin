/**
 * 资源管理模块
 * 
 * 综合统计和资源管理，调用各子模块
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

// 导入子模块
const cards = require('./cards');
const extensions = require('./extensions');
const worldInfo = require('./worldInfo');
const presets = require('./presets');

/**
 * 获取综合资源统计
 */
function getStats() {
    const cardStats = cards.getStats();
    const extensionStats = extensions.getStats();
    const worldInfoStats = worldInfo.getStats();
    const presetStats = presets.getStats();
    
    return {
        characters: cardStats.total,
        characterFolders: cardStats.folders,
        worldbooks: worldInfoStats.total,
        worldbooksGlobal: worldInfoStats.global,
        worldbooksResource: worldInfoStats.resource,
        worldbooksEmbedded: worldInfoStats.embedded,
        presets: presetStats.total,
        regexScripts: extensionStats.regex.total,
        regexGlobal: extensionStats.regex.global,
        regexResource: extensionStats.regex.resource,
        scripts: extensionStats.scripts.total,
        quickReplies: extensionStats.quickReplies.total,
    };
}

/**
 * 获取角色卡列表 (代理到 cards 模块)
 */
function listCards(options) {
    return cards.listCards(options);
}

/**
 * 获取世界书列表 (代理到 worldInfo 模块)
 */
function listWorldbooks(options) {
    const { type, search, page, pageSize } = options || {};
    return worldInfo.listWorldbooks(type, search, page, pageSize);
}

/**
 * 获取预设列表 (代理到 presets 模块)
 */
function listPresets(options) {
    return presets.listPresets(options);
}

/**
 * 获取正则脚本列表
 */
function listRegexScripts(options) {
    const { filterType, search } = options || {};
    return extensions.listExtensions('regex', filterType || 'all', search || '');
}

/**
 * 获取 ST 脚本列表
 */
function listScripts(options) {
    const { filterType, search } = options || {};
    return extensions.listExtensions('scripts', filterType || 'all', search || '');
}

/**
 * 获取快速回复列表
 */
function listQuickReplies(options) {
    const { filterType, search } = options || {};
    return extensions.listExtensions('quick_replies', filterType || 'all', search || '');
}

/**
 * 获取单个角色卡 (代理到 cards 模块)
 */
function getCard(cardId) {
    const card = cards.getCard(cardId);
    return card ? card.data : null;
}

module.exports = {
    getStats,
    listCards,
    getCard,
    listWorldbooks,
    listPresets,
    listRegexScripts,
    listScripts,
    listQuickReplies,
    // 导出子模块供直接使用
    cards,
    extensions,
    worldInfo,
    presets,
};
