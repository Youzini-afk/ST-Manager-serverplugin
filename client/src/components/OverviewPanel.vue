<template>
  <div class="stm-overview">
    <!-- 连接状态卡片 -->
    <div class="stm-card stm-connection-card">
      <div class="stm-card-header">
        <h3>🔗 后端服务</h3>
        <button class="stm-btn stm-btn-sm" @click="$emit('connect')">
          {{ isConnected ? '重新连接' : '连接' }}
        </button>
      </div>
      <div class="stm-card-body">
        <div class="stm-connection-status">
          <span :class="['stm-status-indicator', { online: isConnected }]">
            {{ isConnected ? '● 在线' : '○ 离线' }}
          </span>
          <span class="stm-status-url">localhost:5000</span>
        </div>
      </div>
    </div>

    <!-- 统计卡片网格 -->
    <div class="stm-stats-grid">
      <div class="stm-stat-card">
        <div class="stm-stat-icon">🎴</div>
        <div class="stm-stat-info">
          <span class="stm-stat-value">{{ stats.characters }}</span>
          <span class="stm-stat-label">角色卡</span>
        </div>
      </div>

      <div class="stm-stat-card">
        <div class="stm-stat-icon">📚</div>
        <div class="stm-stat-info">
          <span class="stm-stat-value">{{ stats.worldbooks }}</span>
          <span class="stm-stat-label">世界书</span>
        </div>
      </div>

      <div class="stm-stat-card">
        <div class="stm-stat-icon">📝</div>
        <div class="stm-stat-info">
          <span class="stm-stat-value">{{ stats.presets }}</span>
          <span class="stm-stat-label">预设</span>
        </div>
      </div>

      <div class="stm-stat-card">
        <div class="stm-stat-icon">🧩</div>
        <div class="stm-stat-info">
          <span class="stm-stat-value">{{ stats.regexScripts }}</span>
          <span class="stm-stat-label">正则</span>
        </div>
      </div>
    </div>

    <!-- 备份状态 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>💾 备份状态</h3>
        <button class="stm-btn stm-btn-sm stm-btn-primary" @click="$emit('refresh')">
          刷新
        </button>
      </div>
      <div class="stm-card-body">
        <div class="stm-backup-info">
          <div class="stm-backup-stat">
            <span class="stm-backup-label">备份总数</span>
            <span class="stm-backup-value">{{ stats.backups }}</span>
          </div>
          <div class="stm-backup-stat">
            <span class="stm-backup-label">最近备份</span>
            <span class="stm-backup-value">{{ stats.lastBackup || '暂无' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="stm-quick-actions">
      <button class="stm-action-btn" @click="openWebUI" :disabled="!isConnected">
        <span class="stm-action-icon">🖥️</span>
        <span>打开 Web UI</span>
      </button>
      <button class="stm-action-btn" :disabled="!isConnected">
        <span class="stm-action-icon">⚡</span>
        <span>立即备份</span>
      </button>
      <button class="stm-action-btn" :disabled="!isConnected">
        <span class="stm-action-icon">🔄</span>
        <span>同步资源</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  stats: {
    characters: number;
    worldbooks: number;
    presets: number;
    regexScripts: number;
    backups: number;
    lastBackup: string | null;
  };
  isConnected: boolean;
}>();

defineEmits<{
  (e: 'refresh'): void;
  (e: 'connect'): void;
}>();

/**
 * 打开 Web UI
 */
function openWebUI() {
  const backendUrl = localStorage.getItem('stm_backend_url') || 'http://localhost:5000';
  window.open(backendUrl, '_blank');
  window.toastr?.info('已在新标签页打开 Web UI');
}
</script>

<style scoped>
.stm-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  font-size: 14px;
  font-weight: 600;
}

.stm-card-body {
  padding: 14px;
}

.stm-connection-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stm-status-indicator {
  font-size: 13px;
  color: #ff6b6b;
}

.stm-status-indicator.online {
  color: #51cf66;
}

.stm-status-url {
  font-size: 12px;
  opacity: 0.6;
  font-family: monospace;
}

.stm-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.stm-stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05));
  border-radius: 8px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
}

.stm-stat-icon {
  font-size: 24px;
}

.stm-stat-info {
  display: flex;
  flex-direction: column;
}

.stm-stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #667eea;
}

.stm-stat-label {
  font-size: 12px;
  opacity: 0.7;
}

.stm-backup-info {
  display: flex;
  justify-content: space-around;
}

.stm-backup-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stm-backup-label {
  font-size: 12px;
  opacity: 0.6;
}

.stm-backup-value {
  font-size: 14px;
  font-weight: 600;
}

.stm-quick-actions {
  display: flex;
  gap: 10px;
}

.stm-action-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  color: var(--SmartThemeBodyColor, #e0e0e0);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
}

.stm-action-btn:hover:not(:disabled) {
  background: rgba(102, 126, 234, 0.15);
  border-color: rgba(102, 126, 234, 0.3);
}

.stm-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stm-action-icon {
  font-size: 20px;
}

.stm-btn {
  padding: 6px 12px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
  border-radius: 4px;
  background: transparent;
  color: var(--SmartThemeBodyColor, #e0e0e0);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.stm-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.stm-btn-sm {
  padding: 4px 8px;
  font-size: 11px;
}

.stm-btn-primary {
  background: #667eea;
  border-color: #667eea;
  color: white;
}

.stm-btn-primary:hover {
  background: #5a6fd6;
}
</style>
