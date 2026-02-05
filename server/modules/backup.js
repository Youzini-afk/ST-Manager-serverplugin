/**
 * 备份模块
 * 
 * 提供备份、恢复、定时备份等功能
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { resolveInside } = require('../utils/safePath');

// 备份计划状态
let scheduleTimer = null;
let scheduleConfig = {
    enabled: false,
    type: 'disabled',
    hour: 3,
    dayOfWeek: 0,
    retentionDays: 30,
};

function resolveBackupRoot(customPath = '') {
    const defaultRoot = path.resolve(config.getBackupRoot());
    if (!customPath || typeof customPath !== 'string') {
        return defaultRoot;
    }
    const resolved = path.resolve(customPath);
    const rootCmp = process.platform === 'win32' ? defaultRoot.toLowerCase() : defaultRoot;
    const resolvedCmp = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    // 仅允许写入默认备份目录及其子目录
    if (resolvedCmp === rootCmp || resolvedCmp.startsWith(rootCmp + path.sep)) {
        return resolved;
    }
    return defaultRoot;
}

function resolveBackupDirById(backupRoot, backupId) {
    if (!backupId || typeof backupId !== 'string') return null;
    if (backupId.includes('..') || backupId.includes('/') || backupId.includes('\\')) return null;
    return resolveInside(backupRoot, backupId);
}

/**
 * 确保目录存在
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * 递归复制目录
 */
function copyDirSync(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    let totalFiles = 0;
    let totalSize = 0;
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            const { files, size } = copyDirSync(srcPath, destPath);
            totalFiles += files;
            totalSize += size;
        } else {
            fs.copyFileSync(srcPath, destPath);
            totalFiles++;
            totalSize += fs.statSync(srcPath).size;
        }
    }
    
    return { files: totalFiles, size: totalSize };
}

/**
 * 触发备份
 */
function trigger(options = {}) {
    const { resources, path: customPath, incremental } = options;
    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    const backupRoot = resolveBackupRoot(customPath);
    
    // 生成时间戳
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
    const backupDir = path.join(backupRoot, timestamp);
    
    ensureDir(backupDir);
    
    // 确定要备份的资源
    const resourcesToBackup = resources || Object.keys(resourceDirs);
    
    let totalFiles = 0;
    let totalSize = 0;
    const backedUpResources = [];
    
    for (const resType of resourcesToBackup) {
        if (!resourceDirs[resType]) {
            console.warn(`[ST Manager] 未知资源类型: ${resType}`);
            continue;
        }
        
        const sourceDir = path.join(dataRoot, resourceDirs[resType]);
        const targetDir = path.join(backupDir, resType);
        
        if (!fs.existsSync(sourceDir)) {
            console.warn(`[ST Manager] 源目录不存在: ${sourceDir}`);
            continue;
        }
        
        const { files, size } = copyDirSync(sourceDir, targetDir);
        totalFiles += files;
        totalSize += size;
        backedUpResources.push(resType);
    }
    
    // 保存元数据
    const metadata = {
        id: timestamp,
        timestamp: now.toISOString(),
        resources: backedUpResources,
        fileCount: totalFiles,
        sizeMb: totalSize / (1024 * 1024),
        incremental: !!incremental,
        path: backupDir,
    };
    
    fs.writeFileSync(
        path.join(backupDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf-8'
    );
    
    console.log(`[ST Manager] 备份完成: ${backupDir}, ${totalFiles} 文件, ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    
    // 清理过期备份
    cleanupOldBackups(backupRoot);
    
    return {
        success: true,
        backupId: timestamp,
        path: backupDir,
        timestamp: metadata.timestamp,
        fileCount: totalFiles,
        sizeMb: metadata.sizeMb,
    };
}

/**
 * 获取备份列表
 */
function list() {
    const backupRoot = config.getBackupRoot();
    const backups = [];
    
    if (!fs.existsSync(backupRoot)) return backups;
    
    const dirs = fs.readdirSync(backupRoot, { withFileTypes: true });
    
    for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        
        const backupDir = path.join(backupRoot, dir.name);
        const metadataPath = path.join(backupDir, 'metadata.json');
        
        if (fs.existsSync(metadataPath)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                backups.push(metadata);
            } catch (e) {
                backups.push({
                    id: dir.name,
                    timestamp: dir.name,
                    path: backupDir,
                    resources: [],
                    fileCount: 0,
                    sizeMb: 0,
                });
            }
        } else {
            backups.push({
                id: dir.name,
                timestamp: dir.name,
                path: backupDir,
                resources: [],
                fileCount: 0,
                sizeMb: 0,
            });
        }
    }
    
    // 按时间倒序
    backups.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    
    return backups;
}

/**
 * 恢复备份
 */
function restore(backupId) {
    if (!backupId) {
        return { success: false, message: '缺少 backupId 参数' };
    }
    
    const backupRoot = resolveBackupRoot();
    const backupDir = resolveBackupDirById(backupRoot, backupId);
    
    if (!backupDir || !fs.existsSync(backupDir)) {
        return { success: false, message: `备份不存在: ${backupId}` };
    }
    
    const dataRoot = config.getDataRoot();
    const resourceDirs = config.getResourceDirs();
    
    // 读取元数据
    const metadataPath = path.join(backupDir, 'metadata.json');
    let resources = Object.keys(resourceDirs);
    
    if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        resources = metadata.resources || resources;
    }
    
    const restored = [];
    
    for (const resType of resources) {
        const sourceDir = path.join(backupDir, resType);
        if (!fs.existsSync(sourceDir)) continue;
        
        const targetDir = path.join(dataRoot, resourceDirs[resType] || resType);
        
        // 备份当前数据
        if (fs.existsSync(targetDir)) {
            const tempBackup = targetDir + '.restore_backup';
            if (fs.existsSync(tempBackup)) {
                fs.rmSync(tempBackup, { recursive: true });
            }
            fs.renameSync(targetDir, tempBackup);
        }
        
        // 恢复
        copyDirSync(sourceDir, targetDir);
        
        // 删除临时备份
        const tempBackup = targetDir + '.restore_backup';
        if (fs.existsSync(tempBackup)) {
            fs.rmSync(tempBackup, { recursive: true });
        }
        
        restored.push(resType);
    }
    
    console.log(`[ST Manager] 恢复完成: ${backupId}, 资源: ${restored.join(', ')}`);
    
    return { success: true, message: `已恢复: ${restored.join(', ')}` };
}

/**
 * 删除备份
 */
function remove(backupId) {
    if (!backupId) {
        return { success: false, message: '缺少 backupId 参数' };
    }
    
    const backupDir = resolveBackupDirById(resolveBackupRoot(), backupId);
    
    if (!backupDir || !fs.existsSync(backupDir)) {
        return { success: false, message: `备份不存在: ${backupId}` };
    }
    
    fs.rmSync(backupDir, { recursive: true });
    
    console.log(`[ST Manager] 已删除备份: ${backupId}`);
    
    return { success: true, message: '备份已删除' };
}

/**
 * 清理过期备份
 */
function cleanupOldBackups(backupRoot) {
    if (!scheduleConfig.retentionDays || scheduleConfig.retentionDays <= 0) return;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - scheduleConfig.retentionDays);
    
    if (!fs.existsSync(backupRoot)) return;
    
    const dirs = fs.readdirSync(backupRoot, { withFileTypes: true });
    
    for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        
        const backupDir = path.join(backupRoot, dir.name);
        const metadataPath = path.join(backupDir, 'metadata.json');
        
        let backupDate = null;
        
        if (fs.existsSync(metadataPath)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
                backupDate = new Date(metadata.timestamp);
            } catch (e) {
                // 解析失败，尝试从目录名解析
            }
        }
        
        if (!backupDate) {
            // 尝试从目录名解析 (格式: 20260203_123456)
            const match = dir.name.match(/^(\d{4})(\d{2})(\d{2})_/);
            if (match) {
                backupDate = new Date(`${match[1]}-${match[2]}-${match[3]}`);
            }
        }
        
        if (backupDate && backupDate < cutoffDate) {
            fs.rmSync(backupDir, { recursive: true });
            console.log(`[ST Manager] 清理过期备份: ${dir.name}`);
        }
    }
}

/**
 * 获取备份计划
 */
function getSchedule() {
    return scheduleConfig;
}

/**
 * 设置备份计划
 */
function setSchedule(newConfig) {
    Object.assign(scheduleConfig, newConfig);
    
    // 重启定时器
    stopScheduler();
    
    if (scheduleConfig.enabled && scheduleConfig.type !== 'disabled') {
        startScheduler();
    }
    
    return { success: true };
}

/**
 * 启动定时备份
 */
function startScheduler() {
    // 计算下次执行时间
    const now = new Date();
    let nextRun = new Date(now);
    nextRun.setHours(scheduleConfig.hour, 0, 0, 0);
    
    if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
    }
    
    if (scheduleConfig.type === 'weekly') {
        // 调整到指定的星期几
        while (nextRun.getDay() !== scheduleConfig.dayOfWeek) {
            nextRun.setDate(nextRun.getDate() + 1);
        }
    }
    
    const delay = nextRun.getTime() - now.getTime();
    
    console.log(`[ST Manager] 定时备份已启用，下次执行: ${nextRun.toISOString()}`);
    
    scheduleTimer = setTimeout(() => {
        trigger({});
        startScheduler(); // 重新调度
    }, delay);
}

/**
 * 停止定时备份
 */
function stopScheduler() {
    if (scheduleTimer) {
        clearTimeout(scheduleTimer);
        scheduleTimer = null;
    }
}

module.exports = {
    trigger,
    list,
    restore,
    remove,
    getSchedule,
    setSchedule,
    stopScheduler,
};
