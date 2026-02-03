<template>
  <div class="stm-backup">
    <!-- 备份路径配置 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>📁 备份路径</h3>
      </div>
      <div class="stm-card-body">
        <div class="stm-form-group">
          <label>备份目录</label>
          <div class="stm-path-input">
            <input
              v-model="backupPath"
              type="text"
              class="stm-input"
              placeholder="留空使用后端默认路径 (data/backups)"
            />
            <button class="stm-btn" @click="selectPath" :disabled="!isConnected">
              浏览...
            </button>
          </div>
          <small class="stm-hint">支持任意目录，不限于酒馆内部</small>
        </div>
      </div>
    </div>

    <!-- 定期备份设置 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>⏰ 自动备份</h3>
        <label class="stm-switch">
          <input v-model="scheduleEnabled" type="checkbox" :disabled="!isConnected" />
          <span class="stm-slider"></span>
        </label>
      </div>
      <div class="stm-card-body">
        <div class="stm-form-group">
          <label>备份频率</label>
          <select v-model="scheduleType" class="stm-select" :disabled="!scheduleEnabled || !isConnected">
            <option value="daily">每天</option>
            <option value="weekly">每周日</option>
          </select>
        </div>
        <div class="stm-form-group">
          <label>执行时间</label>
          <select v-model="scheduleHour" class="stm-select" :disabled="!scheduleEnabled || !isConnected">
            <option v-for="h in 24" :key="h - 1" :value="h - 1">
              {{ String(h - 1).padStart(2, '0') }}:00
            </option>
          </select>
        </div>
        <div class="stm-form-group">
          <label>保留天数</label>
          <input
            v-model.number="retentionDays"
            type="number"
            class="stm-input"
            min="1"
            max="365"
            :disabled="!scheduleEnabled || !isConnected"
          />
        </div>
        <button
          class="stm-btn stm-btn-primary stm-btn-block"
          @click="saveSchedule"
          :disabled="!isConnected"
        >
          保存设置
        </button>
      </div>
    </div>

    <!-- 手动备份 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>⚡ 手动备份</h3>
      </div>
      <div class="stm-card-body">
        <div class="stm-resource-checkboxes">
          <label v-for="res in resourceTypes" :key="res.id" class="stm-checkbox">
            <input v-model="selectedResources" type="checkbox" :value="res.id" />
            <span>{{ res.icon }} {{ res.label }}</span>
          </label>
        </div>
        <div class="stm-backup-actions">
          <button
            class="stm-btn stm-btn-primary"
            @click="triggerBackup"
            :disabled="!isConnected || backingUp"
          >
            <span v-if="backingUp" class="stm-spinner-sm"></span>
            <span>{{ backingUp ? '备份中...' : '立即备份' }}</span>
          </button>
          <label class="stm-checkbox stm-checkbox-inline">
            <input v-model="incremental" type="checkbox" />
            <span>增量备份</span>
          </label>
        </div>
      </div>
    </div>

    <!-- 备份历史 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>📋 备份历史</h3>
        <button class="stm-btn stm-btn-sm" @click="loadBackups" :disabled="!isConnected">
          刷新
        </button>
      </div>
      <div class="stm-card-body">
        <div v-if="loadingBackups" class="stm-loading-sm">
          <span class="stm-spinner-sm"></span>
          <span>加载中...</span>
        </div>
        <div v-else-if="backups.length === 0" class="stm-empty-sm">
          暂无备份记录
        </div>
        <div v-else class="stm-backup-list">
          <div v-for="backup in backups" :key="backup.id" class="stm-backup-item">
            <div class="stm-backup-info">
              <span class="stm-backup-time">{{ formatTime(backup.timestamp) }}</span>
              <span class="stm-backup-meta">
                {{ backup.fileCount }} 文件 · {{ backup.sizeMb.toFixed(1) }} MB
              </span>
            </div>
            <div class="stm-backup-actions">
              <button
                class="stm-btn stm-btn-sm"
                @click="restoreBackup(backup.id)"
                :disabled="restoring"
              >
                恢复
              </button>
              <button
                class="stm-btn stm-btn-sm stm-btn-danger"
                @click="deleteBackup(backup.id)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { backendService } from '../services/backendApi';
import type { BackupInfo, BackupSchedule } from '../types';

const props = defineProps<{
  isConnected: boolean;
}>();

const resourceTypes = [
  { id: 'characters', label: '角色卡', icon: '🎴' },
  { id: 'worldbooks', label: '世界书', icon: '📚' },
  { id: 'presets', label: '预设', icon: '📝' },
  { id: 'regexes', label: '正则脚本', icon: '🧩' },
  { id: 'scripts', label: 'ST脚本', icon: '📜' },
  { id: 'quickreplies', label: '快速回复', icon: '💬' },
];

// 备份路径（空则使用后端默认的 data/backups）
const backupPath = ref('');

// 定期备份设置
const scheduleEnabled = ref(false);
const scheduleType = ref<'daily' | 'weekly'>('daily');
const scheduleHour = ref(3);
const retentionDays = ref(30);

// 手动备份
const selectedResources = ref(['characters', 'worldbooks', 'presets', 'regexes', 'scripts', 'quickreplies']);
const incremental = ref(true);
const backingUp = ref(false);

// 备份历史
const backups = ref<BackupInfo[]>([]);
const loadingBackups = ref(false);
const restoring = ref(false);

/**
 * 选择路径（需要后端支持文件对话框）
 */
async function selectPath() {
  // 在实际实现中，可以调用后端的文件选择对话框
  window.toastr?.info('请手动输入备份路径');
}

/**
 * 保存定期备份设置
 */
async function saveSchedule() {
  if (!props.isConnected) return;

  try {
    const schedule: BackupSchedule = {
      enabled: scheduleEnabled.value,
      type: scheduleEnabled.value ? scheduleType.value : 'disabled',
      hour: scheduleHour.value,
      retentionDays: retentionDays.value,
    };

    await backendService.setBackupSchedule(schedule);
    window.toastr?.success('备份设置已保存');
  } catch (e) {
    console.error('[ST Manager] 保存备份设置失败:', e);
    window.toastr?.error('保存失败');
  }
}

/**
 * 加载备份设置
 */
async function loadSchedule() {
  if (!props.isConnected) return;

  try {
    const schedule = await backendService.getBackupSchedule();
    scheduleEnabled.value = schedule.enabled;
    scheduleType.value = schedule.type === 'weekly' ? 'weekly' : 'daily';
    scheduleHour.value = schedule.hour ?? 3;
    retentionDays.value = schedule.retentionDays ?? 30;
  } catch (e) {
    console.error('[ST Manager] 加载备份设置失败:', e);
  }
}

/**
 * 触发手动备份
 */
async function triggerBackup() {
  if (!props.isConnected || backingUp.value) return;

  backingUp.value = true;
  try {
    const result = await backendService.triggerBackup({
      resources: selectedResources.value,
      path: backupPath.value || undefined,  // 空则使用后端默认路径
      incremental: incremental.value,
    });

    if (result.success) {
      window.toastr?.success(`备份完成：${result.fileCount} 个文件，${result.sizeMb?.toFixed(1) ?? 0} MB`);
      await loadBackups();
    } else {
      window.toastr?.error(result.error || '备份失败');
    }
  } catch (e: any) {
    console.error('[ST Manager] 备份失败:', e);
    window.toastr?.error(e.message || '备份失败');
  } finally {
    backingUp.value = false;
  }
}

/**
 * 加载备份列表
 */
async function loadBackups() {
  if (!props.isConnected) return;

  loadingBackups.value = true;
  try {
    backups.value = await backendService.listBackups();
  } catch (e) {
    console.error('[ST Manager] 加载备份列表失败:', e);
    backups.value = [];
  } finally {
    loadingBackups.value = false;
  }
}

/**
 * 恢复备份
 */
async function restoreBackup(backupId: string) {
  if (!confirm('确定要恢复此备份吗？这将覆盖当前的酒馆数据！')) return;

  restoring.value = true;
  try {
    const result = await backendService.restoreBackup(backupId);
    if (result.success) {
      window.toastr?.success('恢复成功，请刷新酒馆页面');
    } else {
      window.toastr?.error(result.message || '恢复失败');
    }
  } catch (e) {
    console.error('[ST Manager] 恢复失败:', e);
    window.toastr?.error('恢复失败');
  } finally {
    restoring.value = false;
  }
}

/**
 * 删除备份
 */
async function deleteBackup(backupId: string) {
  if (!confirm('确定要删除此备份吗？')) return;

  try {
    await backendService.deleteBackup(backupId);
    window.toastr?.success('删除成功');
    await loadBackups();
  } catch (e) {
    console.error('[ST Manager] 删除失败:', e);
    window.toastr?.error('删除失败');
  }
}

/**
 * 格式化时间
 */
function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

onMounted(() => {
  if (props.isConnected) {
    loadSchedule();
    loadBackups();
  }
});
</script>

<style scoped>
.stm-backup {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.stm-card {
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05));
  border-radius: 8px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  overflow: hidden;
}

.stm-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
}

.stm-card-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.stm-card-body {
  padding: 14px;
}

.stm-form-group {
  margin-bottom: 12px;
}

.stm-form-group:last-child {
  margin-bottom: 0;
}

.stm-form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  opacity: 0.8;
}

.stm-path-input {
  display: flex;
  gap: 8px;
}

.stm-path-input .stm-input {
  flex: 1;
}

.stm-input,
.stm-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05));
  color: var(--SmartThemeBodyColor, #e0e0e0);
  font-size: 13px;
}

.stm-hint {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.5;
}

.stm-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}

.stm-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.stm-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.1);
  transition: 0.3s;
  border-radius: 20px;
}

.stm-slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.stm-switch input:checked + .stm-slider {
  background-color: #667eea;
}

.stm-switch input:checked + .stm-slider:before {
  transform: translateX(16px);
}

.stm-resource-checkboxes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.stm-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}

.stm-checkbox input {
  width: 14px;
  height: 14px;
  accent-color: #667eea;
}

.stm-checkbox-inline {
  display: inline-flex;
}

.stm-backup-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stm-backup-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.stm-backup-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.stm-backup-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stm-backup-time {
  font-size: 13px;
  font-weight: 500;
}

.stm-backup-meta {
  font-size: 11px;
  opacity: 0.6;
}

.stm-backup-item .stm-backup-actions {
  gap: 6px;
}

.stm-btn {
  padding: 8px 14px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
  border-radius: 6px;
  background: transparent;
  color: var(--SmartThemeBodyColor, #e0e0e0);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.stm-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.stm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stm-btn-sm {
  padding: 5px 10px;
  font-size: 11px;
}

.stm-btn-block {
  width: 100%;
  justify-content: center;
}

.stm-btn-primary {
  background: #667eea;
  border-color: #667eea;
  color: white;
}

.stm-btn-primary:hover:not(:disabled) {
  background: #5a6fd6;
}

.stm-btn-danger {
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.3);
}

.stm-btn-danger:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.1);
}

.stm-loading-sm,
.stm-empty-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  font-size: 12px;
  opacity: 0.6;
}

.stm-spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
