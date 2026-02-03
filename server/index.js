/**
 * ST Manager - SillyTavern 资源管理与自动化工具
 * 
 * 服务端插件入口
 * 完整复刻 Python 后端的全部功能
 */

const fs = require('fs');
const path = require('path');

// 导入各模块
const backup = require('./modules/backup');
const resources = require('./modules/resources');
const automation = require('./modules/automation');
const config = require('./modules/config');
const extensions = require('./modules/extensions');
const worldInfo = require('./modules/worldInfo');
const cards = require('./modules/cards');
const presets = require('./modules/presets');
const regex = require('./modules/regex');

// 插件信息
const info = {
    id: 'st-manager',
    name: 'ST Manager',
    description: '资源管理与自动化工具 - 支持备份、批量管理、自动化规则',
};

/**
 * 自动安装前端扩展
 */
function autoInstallFrontend() {
    try {
        // 获取 SillyTavern 根目录
        const stRoot = process.cwd();
        
        // 前端源目录
        const pluginDir = path.join(__dirname, '..');
        const clientDistDir = path.join(pluginDir, 'client', 'dist');
        
        // 前端目标目录
        const extensionsDir = path.join(stRoot, 'public', 'scripts', 'extensions');
        const targetDir = path.join(extensionsDir, 'ST-Manager');
        
        // 检查源目录
        if (!fs.existsSync(clientDistDir)) {
            console.log('[ST Manager] 前端源文件不存在，跳过自动安装');
            console.log('[ST Manager] 请先构建前端: cd client && npm install && npm run build');
            return false;
        }
        
        // 确保目标目录存在
        if (!fs.existsSync(extensionsDir)) {
            console.warn('[ST Manager] 扩展目录不存在:', extensionsDir);
            return false;
        }
        
        // 创建目标目录
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            console.log('[ST Manager] 创建前端扩展目录:', targetDir);
        }
        
        // 复制文件
        const filesToCopy = ['index.iife.js', 'style.css', 'manifest.json'];
        let copiedFiles = 0;
        
        for (const file of filesToCopy) {
            const srcFile = path.join(clientDistDir, file);
            const destFile = path.join(targetDir, file);
            
            if (fs.existsSync(srcFile)) {
                // 检查是否需要更新
                let needsCopy = !fs.existsSync(destFile);
                
                if (!needsCopy) {
                    const srcStats = fs.statSync(srcFile);
                    const destStats = fs.statSync(destFile);
                    needsCopy = srcStats.mtimeMs > destStats.mtimeMs;
                }
                
                if (needsCopy) {
                    fs.copyFileSync(srcFile, destFile);
                    console.log(`[ST Manager] 复制前端文件: ${file}`);
                    copiedFiles++;
                }
            }
        }
        
        if (copiedFiles > 0) {
            console.log(`[ST Manager] ✅ 前端扩展已自动安装/更新 (${copiedFiles} 个文件)`);
            console.log(`[ST Manager] 前端位置: ${targetDir}`);
            console.log('[ST Manager] 请在酒馆 UI 的 Extensions 面板中启用 ST Manager');
        } else {
            console.log('[ST Manager] 前端扩展已是最新版本');
        }
        
        return true;
    } catch (error) {
        console.error('[ST Manager] 自动安装前端失败:', error.message);
        return false;
    }
}

/**
 * 初始化插件
 * @param {import('express').Router} router Express 路由器
 */
async function init(router) {
    console.log('[ST Manager] 初始化服务端插件...');
    
    // 初始化配置
    config.init();
    
    // 自动安装前端扩展
    autoInstallFrontend();
    
    // ============ 健康检查 ============
    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            version: '2.0.0',
            timestamp: new Date().toISOString(),
            features: ['cards', 'worldbooks', 'presets', 'extensions', 'automation', 'backup'],
        });
    });
    
    // ============ 统计接口 ============
    router.get('/stats', (req, res) => {
        try {
            const stats = resources.getStats();
            res.json({ success: true, ...stats });
        } catch (e) {
            console.error('[ST Manager] 获取统计失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // ============ 角色卡接口 ============
    router.get('/cards/list', (req, res) => {
        try {
            const { search, folder, page, pageSize, sort } = req.query;
            const result = cards.listCards({
                search,
                folder,
                page: parseInt(page) || 1,
                pageSize: parseInt(pageSize) || 50,
                sort,
            });
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 获取角色卡列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/cards/detail/:cardId(*)', (req, res) => {
        try {
            const card = cards.getCard(req.params.cardId);
            if (card) {
                res.json({ success: true, card });
            } else {
                res.status(404).json({ success: false, error: '卡片不存在' });
            }
        } catch (e) {
            console.error('[ST Manager] 获取卡片详情失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/cards/folders', (req, res) => {
        try {
            const folders = cards.listFolders();
            res.json({ success: true, folders });
        } catch (e) {
            console.error('[ST Manager] 获取文件夹列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/cards/tags', (req, res) => {
        try {
            const tags = cards.getAllTags();
            res.json({ success: true, tags });
        } catch (e) {
            console.error('[ST Manager] 获取标签列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/cards/move', (req, res) => {
        try {
            const { cardId, targetFolder } = req.body || {};
            const result = cards.moveCard(cardId, targetFolder);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 移动卡片失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/cards/delete', (req, res) => {
        try {
            const { cardId, moveToTrash } = req.body || {};
            const result = cards.deleteCard(cardId, moveToTrash !== false);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 删除卡片失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/cards/tags/add', (req, res) => {
        try {
            const { cardIds, tags } = req.body || {};
            const result = cards.addTags(cardIds, tags);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 添加标签失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/cards/tags/remove', (req, res) => {
        try {
            const { cardIds, tags } = req.body || {};
            const result = cards.removeTags(cardIds, tags);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 移除标签失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/folders/create', (req, res) => {
        try {
            const { folderPath } = req.body || {};
            const result = cards.createFolder(folderPath);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 创建文件夹失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/folders/rename', (req, res) => {
        try {
            const { oldPath, newName } = req.body || {};
            const result = cards.renameFolder(oldPath, newName);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 重命名文件夹失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/folders/delete', (req, res) => {
        try {
            const { folderPath, recursive } = req.body || {};
            const result = cards.deleteFolder(folderPath, recursive);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 删除文件夹失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // ============ 世界书接口 ============
    router.get('/worldbooks/list', (req, res) => {
        try {
            const { type, search, page, pageSize } = req.query;
            const result = worldInfo.listWorldbooks(
                type || 'all',
                search || '',
                parseInt(page) || 1,
                parseInt(pageSize) || 20
            );
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 获取世界书列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/worldbooks/detail/:worldbookId(*)', (req, res) => {
        try {
            const wb = worldInfo.getWorldbook(req.params.worldbookId);
            if (wb) {
                res.json({ success: true, worldbook: wb });
            } else {
                res.status(404).json({ success: false, error: '世界书不存在' });
            }
        } catch (e) {
            console.error('[ST Manager] 获取世界书详情失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/worldbooks/save', (req, res) => {
        try {
            const { worldbookId, data } = req.body || {};
            const result = worldInfo.saveWorldbook(worldbookId, data);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 保存世界书失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/worldbooks/delete', (req, res) => {
        try {
            const { worldbookId } = req.body || {};
            const result = worldInfo.deleteWorldbook(worldbookId);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 删除世界书失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/worldbooks/stats', (req, res) => {
        try {
            const stats = worldInfo.getStats();
            res.json({ success: true, ...stats });
        } catch (e) {
            console.error('[ST Manager] 获取世界书统计失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // ============ 预设接口 ============
    router.get('/presets/list', (req, res) => {
        try {
            const { type, search, page, pageSize } = req.query;
            const result = presets.listPresets({
                type,
                search,
                page: parseInt(page) || 1,
                pageSize: parseInt(pageSize) || 50,
            });
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 获取预设列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/presets/detail/:presetId(*)', (req, res) => {
        try {
            const preset = presets.getPreset(req.params.presetId);
            if (preset) {
                res.json({ success: true, preset });
            } else {
                res.status(404).json({ success: false, error: '预设不存在' });
            }
        } catch (e) {
            console.error('[ST Manager] 获取预设详情失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/presets/save', (req, res) => {
        try {
            const { presetId, data } = req.body || {};
            const result = presets.savePreset(presetId, data);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 保存预设失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/presets/delete', (req, res) => {
        try {
            const { presetId } = req.body || {};
            const result = presets.deletePreset(presetId);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 删除预设失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/presets/duplicate', (req, res) => {
        try {
            const { presetId, newName } = req.body || {};
            const result = presets.duplicatePreset(presetId, newName);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 复制预设失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/presets/stats', (req, res) => {
        try {
            const stats = presets.getStats();
            res.json({ success: true, ...stats });
        } catch (e) {
            console.error('[ST Manager] 获取预设统计失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // 获取预设绑定的正则
    router.get('/presets/regex/:presetId(*)', (req, res) => {
        try {
            const result = presets.getPresetRegexes(req.params.presetId);
            if (result.success) {
                res.json(result);
            } else {
                res.status(404).json(result);
            }
        } catch (e) {
            console.error('[ST Manager] 获取预设正则失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // ============ 扩展接口 (Regex/Scripts/QR) ============
    router.get('/extensions/list', (req, res) => {
        try {
            const { mode, filterType, search } = req.query;
            const items = extensions.listExtensions(
                mode || 'regex',
                filterType || 'all',
                search || ''
            );
            res.json({ success: true, items, count: items.length });
        } catch (e) {
            console.error('[ST Manager] 获取扩展列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/extensions/detail/:extensionId(*)', (req, res) => {
        try {
            const ext = extensions.getExtension(req.params.extensionId);
            if (ext) {
                res.json({ success: true, extension: ext });
            } else {
                res.status(404).json({ success: false, error: '扩展不存在' });
            }
        } catch (e) {
            console.error('[ST Manager] 获取扩展详情失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/extensions/save', (req, res) => {
        try {
            const { extensionId, data } = req.body || {};
            const result = extensions.saveExtension(extensionId, data);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 保存扩展失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/extensions/delete', (req, res) => {
        try {
            const { extensionId } = req.body || {};
            const result = extensions.deleteExtension(extensionId);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 删除扩展失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/extensions/stats', (req, res) => {
        try {
            const stats = extensions.getStats();
            res.json({ success: true, ...stats });
        } catch (e) {
            console.error('[ST Manager] 获取扩展统计失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // 兼容旧路由
    router.get('/regex/list', (req, res) => {
        try {
            const { filterType, search } = req.query;
            const items = extensions.listExtensions('regex', filterType || 'all', search || '');
            res.json({ success: true, items, count: items.length });
        } catch (e) {
            console.error('[ST Manager] 获取正则脚本列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // ============ 正则脚本接口 (重中之重) ============
    // 全局正则 - 从 settings.json 中提取
    router.get('/regex/global', (req, res) => {
        try {
            const result = regex.getGlobalRegex();
            res.json({ success: true, ...result });
        } catch (e) {
            console.error('[ST Manager] 获取全局正则失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // 正则脚本文件列表 - 从 regex/ 目录读取
    router.get('/regex/scripts', (req, res) => {
        try {
            const scripts = regex.listRegexScripts();
            res.json({ success: true, scripts, count: scripts.length });
        } catch (e) {
            console.error('[ST Manager] 获取正则脚本列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // 汇总正则 - 全局 + 预设绑定
    router.get('/regex/aggregate', (req, res) => {
        try {
            const result = regex.aggregateRegex();
            res.json({ success: true, ...result });
        } catch (e) {
            console.error('[ST Manager] 汇总正则失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // 从预设数据中提取正则
    router.post('/regex/extract-from-preset', (req, res) => {
        try {
            const { presetData } = req.body || {};
            const regexes = regex.extractRegexFromPresetData(presetData || {});
            res.json({ success: true, regexes, count: regexes.length });
        } catch (e) {
            console.error('[ST Manager] 提取预设正则失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // ============ 备份接口 ============
    router.post('/backup/trigger', (req, res) => {
        try {
            const result = backup.trigger(req.body || {});
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 备份失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/backup/list', (req, res) => {
        try {
            const backups = backup.list();
            res.json(backups);
        } catch (e) {
            console.error('[ST Manager] 获取备份列表失败:', e);
            res.status(500).json([]);
        }
    });
    
    router.post('/backup/restore', (req, res) => {
        try {
            const result = backup.restore(req.body?.backupId);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 恢复失败:', e);
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    router.delete('/backup/delete', (req, res) => {
        try {
            const result = backup.remove(req.body?.backupId);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 删除备份失败:', e);
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    router.get('/backup/schedule', (req, res) => {
        res.json(backup.getSchedule());
    });
    
    router.post('/backup/schedule', (req, res) => {
        try {
            const result = backup.setSchedule(req.body || {});
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 设置备份计划失败:', e);
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    // ============ 自动化规则接口 ============
    router.get('/automation/rulesets', (req, res) => {
        try {
            const rulesets = automation.listRulesets();
            res.json({ success: true, rulesets });
        } catch (e) {
            console.error('[ST Manager] 获取规则集列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/automation/ruleset/:id', (req, res) => {
        try {
            const ruleset = automation.getRuleset(req.params.id);
            if (ruleset) {
                res.json({ success: true, ruleset });
            } else {
                res.status(404).json({ success: false, error: '规则集不存在' });
            }
        } catch (e) {
            console.error('[ST Manager] 获取规则集失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/automation/ruleset', (req, res) => {
        try {
            const result = automation.saveRuleset(req.body);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 保存规则集失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.delete('/automation/ruleset/:id', (req, res) => {
        try {
            const result = automation.deleteRuleset(req.params.id);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 删除规则集失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/automation/execute', (req, res) => {
        try {
            const { rulesetId, cardIds, dryRun } = req.body || {};
            const result = automation.execute(rulesetId, cardIds, dryRun);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 执行规则失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.post('/automation/preview', (req, res) => {
        try {
            const { rulesetId, cardIds } = req.body || {};
            const result = automation.preview(rulesetId, cardIds);
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 预览规则失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // ============ 配置接口 ============
    router.get('/config', (req, res) => {
        try {
            res.json(config.get());
        } catch (e) {
            console.error('[ST Manager] 获取配置失败:', e);
            res.status(500).json({});
        }
    });
    
    router.post('/config', (req, res) => {
        try {
            const result = config.update(req.body || {});
            res.json(result);
        } catch (e) {
            console.error('[ST Manager] 更新配置失败:', e);
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    console.log('[ST Manager] 服务端插件已加载');
    console.log('[ST Manager] API 路径: /api/plugins/st-manager/*');
    
    return Promise.resolve();
}

/**
 * 清理
 */
async function exit() {
    console.log('[ST Manager] 服务端插件已卸载');
    backup.stopScheduler();
    return Promise.resolve();
}

module.exports = {
    init,
    exit,
    info,
};
