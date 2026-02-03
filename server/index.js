/**
 * ST Manager - SillyTavern 资源管理与自动化工具
 * 
 * 服务端插件入口
 */

const fs = require('fs');
const path = require('path');

// 导入各模块
const backup = require('./modules/backup');
const resources = require('./modules/resources');
const automation = require('./modules/automation');
const config = require('./modules/config');

// 插件信息
const info = {
    id: 'st-manager',
    name: 'ST Manager',
    description: '资源管理与自动化工具 - 支持备份、批量管理、自动化规则',
};

/**
 * 初始化插件
 * @param {import('express').Router} router Express 路由器
 */
async function init(router) {
    console.log('[ST Manager] 初始化服务端插件...');
    
    // 初始化配置
    config.init();
    
    // ============ 健康检查 ============
    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            version: '2.0.0',
            timestamp: new Date().toISOString(),
        });
    });
    
    // ============ 统计接口 ============
    router.get('/stats', (req, res) => {
        try {
            const stats = resources.getStats();
            res.json(stats);
        } catch (e) {
            console.error('[ST Manager] 获取统计失败:', e);
            res.status(500).json({ error: e.message });
        }
    });
    
    // ============ 资源列表接口 ============
    router.get('/cards/list', (req, res) => {
        try {
            const items = resources.listCards();
            res.json({ success: true, items, count: items.length });
        } catch (e) {
            console.error('[ST Manager] 获取角色卡列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/worldbooks/list', (req, res) => {
        try {
            const items = resources.listWorldbooks();
            res.json({ success: true, items, count: items.length });
        } catch (e) {
            console.error('[ST Manager] 获取世界书列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/presets/list', (req, res) => {
        try {
            const items = resources.listPresets();
            res.json({ success: true, items, count: items.length });
        } catch (e) {
            console.error('[ST Manager] 获取预设列表失败:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    router.get('/regex/list', (req, res) => {
        try {
            const items = resources.listRegexScripts();
            res.json({ success: true, items, count: items.length });
        } catch (e) {
            console.error('[ST Manager] 获取正则脚本列表失败:', e);
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
