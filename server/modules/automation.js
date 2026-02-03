/**
 * 自动化规则模块
 * 
 * 提供规则集管理和自动化执行功能
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const resources = require('./resources');

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
    const filePath = path.join(getRulesDir(), `${rulesetId}.json`);
    
    if (!fs.existsSync(filePath)) return null;
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data.id = rulesetId;
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
        const oldPath = path.join(rulesDir, `${oldId}.json`);
        if (fs.existsSync(oldPath)) {
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
    const filePath = path.join(getRulesDir(), `${rulesetId}.json`);
    
    if (!fs.existsSync(filePath)) {
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
    
    const cards = cardIds 
        ? cardIds.map(id => ({ id, data: resources.getCard(id) })).filter(c => c.data)
        : resources.listCards().map(c => ({ id: c.id, data: resources.getCard(c.id) })).filter(c => c.data);
    
    const results = [];
    
    for (const { id, data } of cards) {
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
        totalCards: cards.length,
        results,
    };
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
    
    // TODO: 实际执行动作（移动文件夹、添加标签等）
    // 这需要修改 PNG 元数据，暂时只返回预览结果
    
    return {
        success: true,
        executed: previewResult.matchCount,
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
