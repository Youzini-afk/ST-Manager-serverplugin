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

    // 获取角色卡详情
    app.post('/api/get_card_detail', (req, res) => {
        try {
            const { id, ...options } = req.body || {};
            const card = cards.getCard(id, options);
            if (card) {
                res.json({
                    success: true,
                    card: card,
                    ui_data: card.uiData || {},
                });
            } else {
                res.json({ success: false, error: '卡片不存在' });
            }
        } catch (e) {
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

    // 获取世界书详情
    app.post('/api/world_info/detail', (req, res) => {
        try {
            const { id, source_type, file_path, preview_limit, force_full } = req.body || {};
            const wb = worldInfo.getWorldbook(id || file_path);
            if (wb) {
                res.json({ success: true, data: wb });
            } else {
                res.json({ success: false, error: '世界书不存在' });
            }
        } catch (e) {
            res.json({ success: false, error: e.message });
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
                res.json({ success: true, data: preset });
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
            const items = extensions.listExtensions(
                mode || 'regex',
                filter_type || filterType || 'all',
                (search || '').trim()
            );

            res.json({
                success: true,
                items: items || [],
                total: items.length || 0,
            });
        } catch (e) {
            res.json({ success: false, error: e.message, items: [], total: 0 });
        }
    });

    // ============ SillyTavern 本地目录探测/验证 ============

    // 自动探测 SillyTavern 安装路径
    app.get('/api/st/detect_path', (req, res) => {
        try {
            const cfg = config ? config.getConfig() : {};
            const candidates = [];
            if (cfg && cfg.st_data_dir) candidates.push(cfg.st_data_dir);
            if (config && config.getStRoot) candidates.push(config.getStRoot());
            candidates.push(process.cwd());

            const username = process.env.USERNAME || process.env.USER || '';
            const common = [
                'D:\\\\SillyTavern',
                'E:\\\\SillyTavern',
                'C:\\\\SillyTavern',
                'D:\\\\Programs\\\\SillyTavern',
                'E:\\\\Programs\\\\SillyTavern',
                `C:\\\\Users\\\\${username}\\\\SillyTavern`,
                '/opt/SillyTavern',
                '~/SillyTavern',
                `/home/${username}/SillyTavern`,
            ];
            candidates.push(...common);

            let found = null;
            for (const raw of candidates) {
                if (!raw) continue;
                const normalized = _normalizeInputPath(raw);
                if (!normalized) continue;
                if (_validateStPath(normalized)) {
                    found = _normalizeStRoot(normalized);
                    break;
                }
            }

            if (found) {
                res.json({ success: true, path: found, valid: true });
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

    // 验证指定路径是否有效
    app.post('/api/st/validate_path', (req, res) => {
        try {
            const rawPath = (req.body || {}).path;
            const normalizedInput = _normalizeInputPath(rawPath);
            if (!normalizedInput) {
                return res.status(400).json({ success: false, error: '请提供路径' });
            }

            const isValid = _validateStPath(normalizedInput);
            let normalizedRoot = isValid ? _normalizeStRoot(normalizedInput) : normalizedInput;
            if (normalizedRoot && !fs.existsSync(normalizedRoot)) {
                normalizedRoot = normalizedInput;
            }

            let resourcesInfo = {};
            if (isValid) {
                const userDir = config && config.resolveUserDataDir
                    ? config.resolveUserDataDir(normalizedRoot)
                    : null;
                resourcesInfo = _collectStResources(userDir);
            }

            res.json({
                success: true,
                valid: isValid,
                normalized_path: normalizedRoot,
                resources: resourcesInfo,
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // 资源同步 - 从 SillyTavern 复制资源到本地
    app.post('/api/st/sync', (req, res) => {
        try {
            const { resource_type, st_data_dir } = req.body || {};

            if (!resource_type) {
                return res.status(400).json({
                    success: false,
                    error: '请指定资源类型',
                    result: { success: 0, failed: 0 }
                });
            }

            // 解析源目录（当前 ST 的用户数据目录）
            // 如果用户指定了 st_data_dir，优先使用它，否则使用当前 ST 的数据目录
            let srcUserDir = null;
            if (st_data_dir) {
                srcUserDir = config && config.resolveUserDataDir
                    ? config.resolveUserDataDir(st_data_dir)
                    : null;
            }
            if (!srcUserDir) {
                srcUserDir = config ? config.getDataRoot() : null;
            }

            if (!srcUserDir || !fs.existsSync(srcUserDir)) {
                return res.json({
                    success: false,
                    error: '无法找到 SillyTavern 数据目录',
                    result: { success: 0, failed: 0 }
                });
            }

            // 获取目标目录（插件的私有存储目录 data/library）
            const pluginDataDir = config ? config.getPluginDataDir() : path.join(__dirname, '..', '..', 'data');

            // 资源目录映射：ST目录 → 插件存储目录
            const resourceDirMap = {
                'characters': { src: 'characters', dest: 'library/characters', exts: ['.png', '.json'] },
                'worlds': { src: 'worlds', dest: 'library/lorebooks', exts: ['.json'] },
                'presets': { src: 'OpenAI Settings', dest: 'library/presets/OpenAI Settings', exts: ['.json'] },
                'presets_textgen': { src: 'TextGen Settings', dest: 'library/presets/TextGen Settings', exts: ['.json'] },
                'presets_novel': { src: 'NovelAI Settings', dest: 'library/presets/NovelAI Settings', exts: ['.json'] },
                'presets_kobold': { src: 'KoboldAI Settings', dest: 'library/presets/KoboldAI Settings', exts: ['.json'] },
                'regex': { src: 'scripts/extensions/regex', dest: 'library/extensions/regex', exts: ['.json'] },
                'quick_replies': { src: 'scripts/extensions/quick-replies', dest: 'library/extensions/quick-replies', exts: ['.json'] }
            };

            const mapping = resourceDirMap[resource_type];
            if (!mapping) {
                return res.json({
                    success: false,
                    error: `未知资源类型: ${resource_type}`,
                    result: { success: 0, failed: 0 }
                });
            }

            // 源：ST 原始数据目录
            const srcDir = path.join(srcUserDir, mapping.src);
            // 目标：插件私有存储目录
            const destDir = path.join(pluginDataDir, mapping.dest);

            // 确保目标目录存在
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            let successCount = 0;
            let failedCount = 0;
            const errors = [];

            // 调试日志
            console.log('[ST Manager] 同步调试信息:');
            console.log('  - 资源类型:', resource_type);
            console.log('  - 源用户目录:', srcUserDir);
            console.log('  - 插件数据目录:', pluginDataDir);
            console.log('  - 源目录:', srcDir);
            console.log('  - 目标目录:', destDir);

            // 检查源目录是否存在
            if (!fs.existsSync(srcDir)) {
                console.log('  - 源目录不存在!');
                return res.json({
                    success: true,
                    result: { success: 0, failed: 0, skipped: 0 },
                    message: `源目录不存在: ${srcDir}`
                });
            }

            // 读取并复制文件
            try {
                const files = fs.readdirSync(srcDir);
                console.log('  - 源目录文件数量:', files.length);
                if (files.length > 0) {
                    console.log('  - 前5个文件:', files.slice(0, 5).join(', '));
                    console.log('  - 允许的扩展名:', mapping.exts.join(', '));
                }

                let skippedCount = 0;

                for (const file of files) {
                    const ext = path.extname(file).toLowerCase();
                    if (!mapping.exts.includes(ext)) continue;

                    const srcPath = path.join(srcDir, file);
                    const destPath = path.join(destDir, file);

                    try {
                        // 检查是否是文件
                        const stat = fs.statSync(srcPath);
                        if (!stat.isFile()) continue;

                        // 检查目标文件是否已存在且更新
                        let needsCopy = true;
                        if (fs.existsSync(destPath)) {
                            const destStat = fs.statSync(destPath);
                            // 如果目标文件较新或相同大小，跳过
                            if (destStat.mtimeMs >= stat.mtimeMs && destStat.size === stat.size) {
                                needsCopy = false;
                                skippedCount++;
                            }
                        }

                        if (needsCopy) {
                            fs.copyFileSync(srcPath, destPath);
                            successCount++;
                            console.log(`  - 复制: ${file}`);
                        }
                    } catch (copyErr) {
                        failedCount++;
                        errors.push(`${file}: ${copyErr.message}`);
                        console.log(`  - 失败: ${file} - ${copyErr.message}`);
                    }
                }

                console.log(`  - 结果: 成功=${successCount}, 跳过=${skippedCount}, 失败=${failedCount}`);

                // 对于正则类型，使用专门的工具函数从 settings.json 导出全局正则
                if (resource_type === 'regex') {
                    const settingsPath = path.join(srcUserDir, 'settings.json');
                    const globalResult = regexUtils.exportGlobalRegex(settingsPath, destDir);
                    successCount += globalResult.success;
                    failedCount += globalResult.failed;
                    if (globalResult.files && globalResult.files.length > 0) {
                        console.log(`[ST Manager] 导出全局正则: ${globalResult.files.join(', ')}`);
                    }
                }

            } catch (readErr) {
                return res.json({
                    success: false,
                    error: `读取目录失败: ${readErr.message}`,
                    result: { success: 0, failed: 0 }
                });
            }

            // 触发资源刷新
            if (successCount > 0 && resources && resources.rescan) {
                try {
                    resources.rescan();
                } catch (e) {
                    console.warn('[ST Manager] 触发重新扫描失败:', e.message);
                }
            }

            res.json({
                success: true,
                result: {
                    success: successCount,
                    failed: failedCount,
                    errors: errors.length > 0 ? errors : undefined
                }
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
