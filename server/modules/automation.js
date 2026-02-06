/**
 * 自动化规则模块
 * 
 * 提供规则集管理和自动化执行功能
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const resources = require('./resources');
const { resolveInside } = require('../utils/safePath');

// 操作符定义
const OPERATORS = {
    EQ: 'eq',
    NEQ: 'neq',
    CONTAINS: 'contains',
    NOT_CONTAINS: 'not_contains',
    REGEX: 'regex',
    EXISTS: 'exists',
    NOT_EXISTS: 'not_exists',
    GT: 'gt',
    LT: 'lt',
    TRUE: 'is_true',
    FALSE: 'is_false',
};

// 动作类型
const ACTIONS = {
    MOVE: 'move_folder',
    ADD_TAG: 'add_tag',
    REMOVE_TAG: 'remove_tag',
    SET_FAV: 'set_favorite',
};

// 字段映射
const FIELD_MAP = {
    char_name: 'name',
    description: 'description',
    creator: 'creator',
    char_version: 'version',
    first_mes: 'first_mes',
    mes_example: 'mes_example',
    tags: 'tags',
    alternate_greetings: 'alternate_greetings',
    token_count: 'token_count',
    file_size: 'file_size',
    wi_name: 'character_book',
    wi_content: 'character_book',
    regex_name: 'extensions.regex_scripts',
    regex_content: 'extensions.regex_scripts',
    st_script_name: 'extensions.tavern_helper',
    st_script_content: 'extensions.tavern_helper',
};

/**
 * 确保目录存在
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * 安全化文件名
 */
function sanitizeFilename(name) {
    return String(name || 'Untitled')
        .replace(/[\\/*?:"<>|]/g, '_')
        .trim() || 'Untitled';
}

function resolveRulesetPath(rulesetId) {
    if (!rulesetId || typeof rulesetId !== 'string') return null;
    if (rulesetId.includes('..') || rulesetId.includes('/') || rulesetId.includes('\\')) return null;
    const safeId = sanitizeFilename(rulesetId);
    if (!safeId) return null;
    return resolveInside(getRulesDir(), `${safeId}.json`);
}

/**
 * 获取规则集目录
 */
function getRulesDir() {
    const dir = config.getRulesDir();
    ensureDir(dir);
    return dir;
}

/**
 * 列出所有规则集
 */
function listRulesets() {
    const rulesDir = getRulesDir();
    const results = [];
    
    if (!fs.existsSync(rulesDir)) return results;
    
    const files = fs.readdirSync(rulesDir);
    
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
            const filePath = path.join(rulesDir, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            
            if (data.spec === 'st_manager_ruleset') {
                const id = file.replace('.json', '');
                results.push({
                    id,
                    meta: data.meta || {},
                    ruleCount: (data.rules || []).length,
                    path: filePath,
                });
            }
        } catch (e) {
            console.error(`[ST Manager] 读取规则集失败 ${file}:`, e);
        }
    }
    
    return results;
}

/**
 * 获取规则集
 */
function getRuleset(rulesetId) {
    const filePath = resolveRulesetPath(rulesetId);
    
    if (!filePath || !fs.existsSync(filePath)) return null;
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data.id = sanitizeFilename(rulesetId);
    return data;
}

/**
 * 保存规则集
 */
function saveRuleset(data) {
    const oldId = data.oldId;
    const rulesDir = getRulesDir();
    
    // 准备元数据
    data.spec = 'st_manager_ruleset';
    data.spec_version = data.spec_version || '1.0';
    
    const metaName = data.meta?.name || 'Untitled';
    let newId = sanitizeFilename(metaName);
    
    // 处理重名
    if (!oldId || oldId.toLowerCase() !== newId.toLowerCase()) {
        let counter = 1;
        while (fs.existsSync(path.join(rulesDir, `${newId}.json`))) {
            newId = `${sanitizeFilename(metaName)}_${counter}`;
            counter++;
        }
    } else {
        newId = oldId;
    }
    
    // 如果改名，删除旧文件
    if (oldId && oldId !== newId) {
        const oldPath = resolveRulesetPath(oldId);
        if (oldPath && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
        }
    }
    
    // 清理临时字段
    delete data.oldId;
    delete data.id;
    
    // 保存
    const newPath = path.join(rulesDir, `${newId}.json`);
    fs.writeFileSync(newPath, JSON.stringify(data, null, 2), 'utf-8');
    
    console.log(`[ST Manager] 保存规则集: ${newId}`);
    
    return { success: true, id: newId };
}

/**
 * 删除规则集
 */
function deleteRuleset(rulesetId) {
    const filePath = resolveRulesetPath(rulesetId);
    
    if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: '规则集不存在' };
    }
    
    fs.unlinkSync(filePath);
    console.log(`[ST Manager] 删除规则集: ${rulesetId}`);
    
    return { success: true };
}

/**
 * 从卡片数据中提取字段值
 */
function getFieldValue(cardData, fieldKey, specificTarget = null) {
    if (!fieldKey || !cardData) return null;
    
    // 处理 data 包装
    const data = cardData.data || cardData;
    
    // 正则脚本
    if (fieldKey === 'extensions.regex_scripts' || fieldKey === 'regex_scripts') {
        const ext = data.extensions || {};
        const scripts = ext.regex_scripts || data.regex_scripts || [];
        
        if (Array.isArray(scripts)) {
            if (specificTarget === 'regex_content') {
                return scripts.map(s => s.findRegex || s.regex || '');
            }
            return scripts.map(s => s.scriptName || '');
        }
        return [];
    }
    
    // 世界书
    if (fieldKey === 'character_book') {
        const book = data.character_book || {};
        let entries = book.entries || [];
        if (typeof entries === 'object' && !Array.isArray(entries)) {
            entries = Object.values(entries);
        }
        
        if (Array.isArray(entries)) {
            if (specificTarget === 'wi_content') {
                return entries.map(e => e.content || '');
            }
            if (specificTarget === 'wi_name') {
                return entries.map(e => e.comment || '');
            }
            return entries.flatMap(e => [e.content || '', e.comment || '']);
        }
        return [];
    }
    
    // ST Helper 脚本
    if (fieldKey === 'extensions.tavern_helper') {
        const ext = data.extensions || {};
        let helperData = ext.tavern_helper;
        let scriptsList = [];
        
        if (typeof helperData === 'object' && !Array.isArray(helperData)) {
            scriptsList = helperData.scripts || [];
        } else if (Array.isArray(helperData)) {
            for (const item of helperData) {
                if (Array.isArray(item) && item[0] === 'scripts' && Array.isArray(item[1])) {
                    scriptsList = item[1];
                    break;
                }
            }
        }
        
        if (specificTarget === 'st_script_content') {
            return scriptsList.map(s => s.content || '');
        }
        return scriptsList.map(s => s.name || '');
    }
    
    // 嵌套路径
    if (fieldKey.includes('.')) {
        const keys = fieldKey.split('.');
        let value = data;
        for (const k of keys) {
            if (typeof value === 'object' && value !== null) {
                value = value[k];
            } else {
                return null;
            }
        }
        return value;
    }
    
    return data[fieldKey];
}

/**
 * 检查条件
 */
function checkCondition(value, operator, targetValue, caseSensitive = false) {
    try {
        // 空值检查
        if (operator === OPERATORS.EXISTS) {
            return value !== null && value !== undefined && value !== '' && 
                   (!Array.isArray(value) || value.length > 0);
        }
        if (operator === OPERATORS.NOT_EXISTS) {
            return value === null || value === undefined || value === '' ||
                   (Array.isArray(value) && value.length === 0);
        }
        
        if (value === null || value === undefined) return false;
        
        // 数值比较
        if (operator === OPERATORS.GT || operator === OPERATORS.LT) {
            try {
                const valNum = parseFloat(value);
                const tgtNum = parseFloat(targetValue);
                return operator === OPERATORS.GT ? valNum > tgtNum : valNum < tgtNum;
            } catch (e) {
                return false;
            }
        }
        
        // 布尔比较
        if (operator === OPERATORS.TRUE || operator === OPERATORS.FALSE) {
            const boolVal = ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
            return operator === OPERATORS.TRUE ? boolVal : !boolVal;
        }
        
        // 正则匹配
        if (operator === OPERATORS.REGEX) {
            const flags = caseSensitive ? '' : 'i';
            return new RegExp(String(targetValue), flags).test(String(value));
        }
        
        // 多值匹配（支持 | 分割）
        const targets = operator !== OPERATORS.REGEX && String(targetValue).includes('|')
            ? String(targetValue).split('|').map(t => t.trim()).filter(Boolean)
            : [String(targetValue)];
        
        // 单次比较
        const singleCheck = (val, op, tgt, ignoreCase) => {
            let valStr = String(val);
            let tgtStr = String(tgt);
            
            if (ignoreCase) {
                valStr = valStr.toLowerCase();
                tgtStr = tgtStr.toLowerCase();
            }
            
            if (op === OPERATORS.EQ) {
                if (Array.isArray(val)) {
                    const targetList = tgt.includes(',') 
                        ? tgt.split(',').map(t => t.trim().toLowerCase())
                        : [tgtStr];
                    const valueList = val.map(v => String(v).toLowerCase());
                    return JSON.stringify(valueList.sort()) === JSON.stringify(targetList.sort());
                }
                return valStr === tgtStr;
            }
            
            if (op === OPERATORS.NEQ) {
                return valStr !== tgtStr;
            }
            
            if (op === OPERATORS.CONTAINS) {
                if (Array.isArray(val)) {
                    return val.some(v => 
                        ignoreCase 
                            ? String(v).toLowerCase().includes(tgtStr)
                            : String(v).includes(tgt)
                    );
                }
                return valStr.includes(tgtStr);
            }
            
            if (op === OPERATORS.NOT_CONTAINS) {
                if (Array.isArray(val)) {
                    return !val.some(v =>
                        ignoreCase
                            ? String(v).toLowerCase().includes(tgtStr)
                            : String(v).includes(tgt)
                    );
                }
                return !valStr.includes(tgtStr);
            }
            
            return false;
        };
        
        // 肯定类操作符 - OR 逻辑
        if (operator === OPERATORS.EQ || operator === OPERATORS.CONTAINS) {
            return targets.some(tgt => singleCheck(value, operator, tgt, !caseSensitive));
        }
        
        // 否定类操作符 - AND 逻辑
        if (operator === OPERATORS.NEQ || operator === OPERATORS.NOT_CONTAINS) {
            return targets.every(tgt => singleCheck(value, operator, tgt, !caseSensitive));
        }
        
        return false;
    } catch (e) {
        console.error('[ST Manager] 条件检查错误:', e);
        return false;
    }
}

/**
 * 评估规则
 */
function evaluate(cardData, ruleset) {
    const plan = { actions: [] };
    
    for (const rule of ruleset.rules || []) {
        if (!rule.enabled) continue;
        
        // 标准化为 Groups 结构
        let ruleGroups = rule.groups || [];
        if (!ruleGroups.length && rule.conditions) {
            ruleGroups = [{ logic: 'AND', conditions: rule.conditions }];
        }
        
        if (!ruleGroups.length) continue;
        
        const ruleTopLogic = (rule.logic || 'OR').toUpperCase();
        const groupResults = [];
        
        for (const group of ruleGroups) {
            const conditions = group.conditions || [];
            const groupLogic = (group.logic || 'AND').toUpperCase();
            
            if (!conditions.length) {
                groupResults.push(false);
                continue;
            }
            
            const condResults = [];
            
            for (const cond of conditions) {
                const rawField = cond.field;
                const mappedField = FIELD_MAP[rawField] || rawField;
                const op = cond.operator;
                const val = cond.value;
                const caseSensitive = cond.case_sensitive || false;
                
                const actualVal = getFieldValue(cardData, mappedField, rawField);
                const result = checkCondition(actualVal, op, val, caseSensitive);
                condResults.push(result);
            }
            
            const groupMatch = groupLogic === 'AND'
                ? condResults.every(Boolean)
                : condResults.some(Boolean);
            
            groupResults.push(groupMatch);
        }
        
        const isRuleMatch = ruleTopLogic === 'AND'
            ? groupResults.every(Boolean)
            : groupResults.some(Boolean);
        
        if (isRuleMatch) {
            console.log(`[ST Manager] 规则匹配: ${rule.name}`);
            
            for (const action of rule.actions || []) {
                plan.actions.push(action);
            }
            
            if (rule.stop_on_match) break;
        }
    }
    
    return plan;
}

/**
 * 预览规则执行结果
 */
function preview(rulesetId, cardIds = null) {
    const ruleset = getRuleset(rulesetId);
    if (!ruleset) {
        return { success: false, error: '规则集不存在' };
    }

    let targets = [];
    if (Array.isArray(cardIds) && cardIds.length) {
        targets = cardIds
            .map(id => ({ id, data: resources.getCard(id) }))
            .filter(item => item && item.data);
    } else {
        const listed = resources.listCards({ page: 1, pageSize: 999999, sort: 'mtime_desc' });
        const items = Array.isArray(listed)
            ? listed
            : (Array.isArray(listed?.items) ? listed.items : []);
        targets = items
            .map(item => ({ id: item.id, data: resources.getCard(item.id) }))
            .filter(item => item && item.data);
    }
    
    const results = [];
    
    for (const { id, data } of targets) {
        const plan = evaluate(data, ruleset);
        
        if (plan.actions.length > 0) {
            results.push({
                cardId: id,
                cardName: data.data?.name || data.name || id,
                actions: plan.actions,
            });
        }
    }
    
    return {
        success: true,
        matchCount: results.length,
        totalCards: targets.length,
        results,
    };
}

function _normalizeCardId(cardId) {
    return String(cardId || '').replace(/\\/g, '/').trim();
}

function _resolveUiKey(uiData, cardId) {
    const normalizedId = _normalizeCardId(cardId);
    if (!normalizedId) return '';
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
    const newKey = _resolveUiKey(uiData, newId);
    if (!oldKey || !uiData[oldKey]) return false;
    if (oldKey === newKey) return false;
    if (!uiData[newKey] || typeof uiData[newKey] !== 'object') {
        uiData[newKey] = {};
    }
    uiData[newKey] = { ...uiData[oldKey], ...uiData[newKey] };
    delete uiData[oldKey];
    return true;
}

function _parseBoolValue(input) {
    const str = String(input || '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(str)) return true;
    if (['false', '0', 'no', 'off'].includes(str)) return false;
    return null;
}

function _splitTags(rawValue) {
    return String(rawValue || '')
        .split('|')
        .map(tag => tag.trim())
        .filter(Boolean);
}

function _applyTagChanges(cardId, addTagsSet, removeTagsSet) {
    if (!resources.cards) {
        return { changed: false, skipped: true };
    }

    let changed = false;
    const details = [];

    if (addTagsSet && addTagsSet.size > 0) {
        const addResult = resources.cards.addTags([cardId], Array.from(addTagsSet));
        const entry = Array.isArray(addResult.results) ? addResult.results[0] : null;
        details.push({ phase: 'add', result: entry || addResult });
        if (!addResult.success || !entry || !entry.success) {
            return { changed: false, skipped: true, details };
        }
        changed = changed || Boolean(entry.changed);
    }

    if (removeTagsSet && removeTagsSet.size > 0) {
        const removeResult = resources.cards.removeTags([cardId], Array.from(removeTagsSet));
        const entry = Array.isArray(removeResult.results) ? removeResult.results[0] : null;
        details.push({ phase: 'remove', result: entry || removeResult });
        if (!removeResult.success || !entry || !entry.success) {
            return { changed: false, skipped: true, details };
        }
        changed = changed || Boolean(entry.changed);
    }

    return { changed, skipped: false, details };
}

function _applyFavorite(uiData, cardId, favorite) {
    const key = _resolveUiKey(uiData, cardId);
    if (!key) return false;
    if (!uiData[key] || typeof uiData[key] !== 'object') {
        uiData[key] = {};
    }
    if (uiData[key].favorite === favorite) return false;
    uiData[key].favorite = favorite;
    return true;
}

function _buildExecutionPlan(actions) {
    const plan = {
        move: null,
        add_tags: new Set(),
        remove_tags: new Set(),
        favorite: null,
    };

    for (const action of actions || []) {
        const type = String(action?.type || '').trim();
        const value = action?.value;

        if (type === ACTIONS.MOVE) {
            plan.move = String(value || '').trim();
        } else if (type === ACTIONS.ADD_TAG) {
            for (const tag of _splitTags(value)) {
                plan.add_tags.add(tag);
            }
        } else if (type === ACTIONS.REMOVE_TAG) {
            for (const tag of _splitTags(value)) {
                plan.remove_tags.add(tag);
            }
        } else if (type === ACTIONS.SET_FAV) {
            plan.favorite = _parseBoolValue(value);
        }
    }

    return plan;
}

function _moveCardWithFallback(cardId, targetFolder) {
    const card = resources.cards && resources.cards.getCard ? resources.cards.getCard(cardId) : null;
    if (!card || !card.path) {
        return { success: false, error: '卡片不存在' };
    }

    try {
        const charactersDir = path.join(config.getPluginDataDir(), 'library', 'characters');
        const filename = path.basename(cardId);
        const targetDir = targetFolder
            ? resolveInside(charactersDir, targetFolder)
            : charactersDir;
        if (!targetDir) {
            return { success: false, error: '无效目标路径' };
        }
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        const targetPath = path.join(targetDir, filename);
        if (fs.existsSync(targetPath) && targetPath !== card.path) {
            return { success: false, error: '目标位置已存在同名文件' };
        }

        try {
            fs.renameSync(card.path, targetPath);
        } catch (e) {
            fs.copyFileSync(card.path, targetPath);
            fs.unlinkSync(card.path);
        }

        const newId = path.relative(charactersDir, targetPath).replace(/\\/g, '/');
        return { success: true, newId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * 执行规则
 */
function execute(rulesetId, cardIds = null, dryRun = false) {
    const previewResult = preview(rulesetId, cardIds);
    
    if (!previewResult.success) {
        return previewResult;
    }
    
    if (dryRun) {
        return previewResult;
    }

    const summary = {
        moves: 0,
        tag_changes: 0,
        favorite_changes: 0,
    };
    const movesPlan = {};
    const tagsPlan = { add: {}, remove: {} };
    const details = [];

    const uiData = config.loadUiData ? config.loadUiData() : {};
    let uiChanged = false;

    for (const item of previewResult.results) {
        const originalId = _normalizeCardId(item.cardId);
        if (!originalId) continue;

        const executionPlan = _buildExecutionPlan(item.actions || []);
        let currentId = originalId;

        const tagResult = _applyTagChanges(currentId, executionPlan.add_tags, executionPlan.remove_tags);
        if (tagResult.changed) {
            summary.tag_changes += 1;
        }
        if (executionPlan.add_tags.size) {
            tagsPlan.add[currentId] = Array.from(executionPlan.add_tags);
        }
        if (executionPlan.remove_tags.size) {
            tagsPlan.remove[currentId] = Array.from(executionPlan.remove_tags);
        }

        if (executionPlan.favorite !== null) {
            if (_applyFavorite(uiData, currentId, executionPlan.favorite)) {
                uiChanged = true;
                summary.favorite_changes += 1;
            }
        }

        if (executionPlan.move !== null) {
            const moveResult = _moveCardWithFallback(currentId, executionPlan.move);
            if (moveResult.success && moveResult.newId) {
                const newId = _normalizeCardId(moveResult.newId);
                movesPlan[currentId] = newId;
                summary.moves += 1;
                if (_migrateUiEntry(uiData, currentId, newId)) {
                    uiChanged = true;
                }
                currentId = newId;
            }
        }

        details.push({
            card_id: originalId,
            final_id: currentId,
            moved: currentId !== originalId,
            tags_changed: tagResult.changed,
            tags_skipped: tagResult.skipped,
        });
    }

    if (uiChanged && config.saveUiData) {
        config.saveUiData(uiData);
    }

    return {
        success: true,
        processed: previewResult.matchCount,
        executed: previewResult.matchCount,
        total_cards: previewResult.totalCards,
        summary,
        moves_plan: movesPlan,
        tags_plan: tagsPlan,
        details,
        results: previewResult.results,
        message: '规则执行完成',
    };
}

module.exports = {
    listRulesets,
    getRuleset,
    saveRuleset,
    deleteRuleset,
    preview,
    execute,
    OPERATORS,
    ACTIONS,
};
