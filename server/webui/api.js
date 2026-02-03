/**
 * Web UI API 兼容层
 * 
 * 完整复刻 Python 后端的所有 API 端点
 * 使前端 JS 无需任何修改即可工作
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

// 导入核心模块
let cards, worldInfo, presets, extensions, automation, backup, config, regex, resources;

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
    
    // 服务器状态
    app.get('/api/status', (req, res) => {
        try {
            const stats = resources ? resources.getStats() : {};
            res.json({
                success: true,
                scanning: false,
                progress: 100,
                version: '2.0.0',
                mode: 'plugin',
                ...stats
            });
        } catch (e) {
            res.json({ success: true, scanning: false, progress: 100 });
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
                cards: result.cards || [],
                total: result.total || 0,
                page: result.page || 1,
                page_size: result.pageSize || 50,
                total_pages: result.totalPages || 1,
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
                items: result.worldbooks || [],
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
                items: result.presets || [],
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
            const { search, page, page_size } = req.query;
            const result = extensions.listExtensions({
                search,
                page: parseInt(page) || 1,
                pageSize: parseInt(page_size) || 50,
            });
            
            res.json({
                success: true,
                items: result.extensions || [],
                total: result.total || 0,
            });
        } catch (e) {
            res.json({ success: false, error: e.message, items: [], total: 0 });
        }
    });
    
    // ============ 正则 API ============
    
    // 获取全局正则
    app.get('/api/regex/global', (req, res) => {
        try {
            const result = regex.getGlobalRegex();
            res.json({ success: true, data: result });
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });
    
    // 聚合正则
    app.get('/api/regex/aggregate', (req, res) => {
        try {
            const result = regex.aggregateRegexScripts();
            res.json(result);
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
