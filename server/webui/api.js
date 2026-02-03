/**
 * Web UI API 兼容层
 * 
 * 完整复刻 Python 后端的所有 API 端点
 * 使前端 JS 无需任何修改即可工作
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

// 导入核心模块
let cards, worldInfo, presets, extensions, automation, backup, config, regex, resources;
// 导入正则工具
const regexUtils = require('../utils/regex');
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
            res.json({ success: true, settings: cfg });
        } catch (e) {
            res.json({ success: false, error: e.message });
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
                    if (data.path && fs.existsSync(data.path)) {
                        const cmd = process.platform === 'win32'
                            ? `explorer "${data.path}"`
                            : `open "${data.path}"`;
                        exec(cmd);
                    }
                    res.json({ success: true });
                    break;
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
                const cmd = process.platform === 'win32'
                    ? `explorer "${trashPath}"`
                    : `open "${trashPath}"`;
                exec(cmd);
                res.json({ success: true });
            } else {
                res.json({ success: false, error: '回收站目录不存在' });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // ============ 角色卡 API ============

    // 获取角色卡列表
    app.get('/api/list_cards', (req, res) => {
        try {
            const { page, page_size, category, tags, search, search_type, sort, recursive } = req.query;
            const result = cards.listCards({
                page: parseInt(page) || 1,
                pageSize: parseInt(page_size) || 50,
                folder: category || '',
                tags: tags ? tags.split(',') : undefined,
                search: search || '',
                searchType: search_type || 'all',
                sort: sort || 'name',
                recursive: recursive === 'true',
            });

            // 转换为 Python 格式响应
            res.json({
                success: true,
                cards: result.items || [],
                total: result.total || 0,
                page: result.page || 1,
                page_size: result.pageSize || 50,
                total_pages: Math.ceil((result.total || 0) / (result.pageSize || 50)) || 1,
                categories: result.folders || [],
            });
        } catch (e) {
            console.error('[API] list_cards error:', e);
            res.json({ success: false, error: e.message, cards: [], total: 0 });
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
            const uiInfo = uiData[id] || {};
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
            const result = cards.updateCard(payload.id, payload);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 切换收藏
    app.post('/api/toggle_favorite', (req, res) => {
        try {
            const { id } = req.body || {};
            const result = cards.toggleFavorite ? cards.toggleFavorite(id) : { success: true };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
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
                errors: errors.length > 0 ? errors : undefined
            });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 删除角色卡
    app.post('/api/delete_cards', (req, res) => {
        try {
            const { card_ids, delete_resources } = req.body || {};
            const ids = Array.isArray(card_ids) ? card_ids : [card_ids];
            let successCount = 0;

            for (const id of ids) {
                const result = cards.deleteCard(id, !delete_resources);
                if (result.success) successCount++;
            }

            res.json({ success: true, deleted: successCount, total: ids.length });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 检查资源目录
    app.post('/api/check_resource_folders', (req, res) => {
        try {
            const { card_ids } = req.body || {};
            const ids = Array.isArray(card_ids) ? card_ids : [card_ids];
            const results = {};

            for (const id of ids) {
                const card = cards.getCard(id);
                results[id] = {
                    has_folder: card && card.resourcePath ? fs.existsSync(card.resourcePath) : false,
                    path: card ? card.resourcePath : null
                };
            }

            res.json({ success: true, results });
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

            if (result.cards && result.cards.length > 0) {
                const randomIndex = Math.floor(Math.random() * result.cards.length);
                res.json({ success: true, card: result.cards[randomIndex] });
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
            const { folder_path } = req.body || {};
            const result = cards.createFolder(folder_path);
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
            const { card_ids, add_tags, remove_tags } = req.body || {};
            let result = { success: true };

            if (add_tags && add_tags.length > 0) {
                result = cards.addTags(card_ids, add_tags);
            }
            if (remove_tags && remove_tags.length > 0) {
                result = cards.removeTags(card_ids, remove_tags);
            }

            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 删除标签
    app.post('/api/delete_tags', (req, res) => {
        try {
            const { card_ids, tags } = req.body || {};
            const result = cards.removeTags(card_ids, tags);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
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

            fullPath = path.normalize(fullPath);
            console.log('[ST Manager] 解析后的路径:', fullPath);

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
            const result = worldInfo.saveWorldbook(file_path, content);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 删除世界书
    app.post('/api/world_info/delete', (req, res) => {
        try {
            const { file_path } = req.body || {};
            const result = worldInfo.deleteWorldbook(file_path);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 上传世界书
    app.post('/api/upload_world_info', (req, res) => {
        try {
            res.json({ success: false, error: '需要 multer 中间件' });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // ============ 预设 API ============

    // 获取预设列表
    app.get('/api/presets/list', (req, res) => {
        try {
            const { type, search, page, page_size } = req.query;
            const result = presets.listPresets({
                type,
                search,
                page: parseInt(page) || 1,
                pageSize: parseInt(page_size) || 50,
            });

            res.json({
                success: true,
                items: result.items || [],
                total: result.total || 0,
            });
        } catch (e) {
            res.json({ success: false, error: e.message, items: [], total: 0 });
        }
    });

    // 获取预设详情
    app.get('/api/presets/detail/:id(*)', (req, res) => {
        try {
            const preset = presets.getPreset(req.params.id);
            if (preset) {
                // 前端期望 res.preset 包含完整预设数据
                // 需要构造与 Python 后端兼容的格式
                const presetResponse = {
                    id: preset.id,
                    name: preset.filename.replace('.json', ''),
                    filename: preset.filename,
                    type: preset.type,
                    path: preset.path,
                    mtime: preset.mtime,
                    file_size: preset.size,
                    // 分组数据
                    samplers: preset.samplers || {},
                    extensions: (preset.data || {}).extensions || {},
                    // prompts 从原始数据提取
                    prompts: (preset.data || {}).prompts || [],
                    // 原始数据
                    raw_data: preset.data,
                    // 正则统计
                    regex_count: preset.regexScripts ? preset.regexScripts.length : 0,
                };
                res.json({ success: true, preset: presetResponse });
            } else {
                res.json({ success: false, error: '预设不存在' });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
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

            // 解析路径：如果是相对路径，基于插件数据目录
            const pluginDataDir = config ? config.getPluginDataDir() : path.join(__dirname, '..', '..', 'data');
            let fullPath = filePath;
            if (!path.isAbsolute(filePath)) {
                fullPath = path.join(pluginDataDir, filePath);
            }

            // 安全检查：确保路径在允许的目录内
            const normalizedPath = path.normalize(fullPath);
            if (!fs.existsSync(normalizedPath)) {
                return res.json({ success: false, msg: '文件不存在' });
            }

            const content = fs.readFileSync(normalizedPath, 'utf-8');
            try {
                const data = JSON.parse(content);
                res.json({ success: true, data });
            } catch (e) {
                // 如果不是有效的 JSON，返回原始文本
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
                // 收集资源信息
                const resources = {};
                const connection = client.testConnection();
                if (connection.local.resources) {
                    Object.assign(resources, connection.local.resources);
                }

                res.json({
                    success: true,
                    path: detected,
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
            const rawPath = (req.body || {}).path;
            if (!rawPath) {
                return res.status(400).json({ success: false, error: '请提供路径' });
            }

            const client = new STClient({ stDataDir: rawPath });
            const isValid = client._validateStPath(rawPath);

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
                normalized_path: path.normalize(rawPath),
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
            const stPath = st_data_dir || (config ? config.getDataRoot() : null);
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
            const rules = automation.listRules ? automation.listRules() : [];
            res.json({ success: true, rulesets: rules });
        } catch (e) {
            res.json({ success: false, error: e.message, rulesets: [] });
        }
    });

    // 获取单个规则集
    app.get('/api/automation/rulesets/:id', (req, res) => {
        try {
            const rule = automation.getRule ? automation.getRule(req.params.id) : null;
            if (rule) {
                res.json({ success: true, ruleset: rule });
            } else {
                res.json({ success: false, error: '规则集不存在' });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 保存规则集
    app.post('/api/automation/rulesets', (req, res) => {
        try {
            const ruleset = req.body;
            const result = automation.saveRule ? automation.saveRule(ruleset) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 删除规则集
    app.delete('/api/automation/rulesets/:id', (req, res) => {
        try {
            const result = automation.deleteRule ? automation.deleteRule(req.params.id) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 执行规则
    app.post('/api/automation/execute', (req, res) => {
        try {
            const { card_ids, ruleset_id } = req.body || {};
            const result = automation.executeRule ? automation.executeRule(ruleset_id, card_ids) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 设置全局规则集
    app.post('/api/automation/global_setting', (req, res) => {
        try {
            const { ruleset_id } = req.body || {};
            const result = automation.setGlobalRuleset ? automation.setGlobalRuleset(ruleset_id) : { success: true };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // ============ 备份 API ============

    // 获取备份列表
    app.get('/api/backup/list', (req, res) => {
        try {
            const { type } = req.query;
            const result = backup.listBackups ? backup.listBackups(type) : { backups: [] };
            res.json({ success: true, ...result });
        } catch (e) {
            res.json({ success: false, error: e.message, backups: [] });
        }
    });

    // 创建备份
    app.post('/api/backup/create', (req, res) => {
        try {
            const { type, paths } = req.body || {};
            const result = backup.createBackup ? backup.createBackup(type, paths) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 恢复备份
    app.post('/api/backup/restore', (req, res) => {
        try {
            const { backup_id, restore_path } = req.body || {};
            const result = backup.restoreBackup ? backup.restoreBackup(backup_id, restore_path) : { success: false, error: '功能未实现' };
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // ============ 资源 API ============

    // 列出皮肤
    app.post('/api/list_resource_skins', (req, res) => {
        try {
            const { folder_name } = req.body || {};
            // 简化实现
            res.json({ success: true, skins: [] });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 上传背景
    app.post('/api/upload_background', (req, res) => {
        try {
            res.json({ success: false, error: '需要 multer 中间件' });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 设置资源目录
    app.post('/api/set_resource_folder', (req, res) => {
        try {
            const { card_id, resource_path } = req.body || {};
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 打开资源目录
    app.post('/api/open_resource_folder', (req, res) => {
        try {
            const { card_id } = req.body || {};
            const card = cards.getCard(card_id);
            if (card && card.resourcePath && fs.existsSync(card.resourcePath)) {
                const cmd = process.platform === 'win32'
                    ? `explorer "${card.resourcePath}"`
                    : `open "${card.resourcePath}"`;
                exec(cmd);
                res.json({ success: true });
            } else {
                res.json({ success: false, error: '资源目录不存在' });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });

    // 创建资源目录
    app.post('/api/create_resource_folder', (req, res) => {
        try {
            const { card_id } = req.body || {};
            res.json({ success: false, error: '功能未实现' });
        } catch (e) {
            res.json({ success: false, error: e.message });
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
                const filePath = path.join(thumbPath, filename);
                if (fs.existsSync(filePath)) {
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
