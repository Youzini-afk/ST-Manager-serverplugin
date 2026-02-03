<template>
  <div class="stm-app">
    <!-- 头部导航 -->
    <header class="stm-header">
      <h2 class="stm-title">
        <span class="stm-icon">📦</span>
        ST Manager
      </h2>
      <div class="stm-status">
        <span :class="['stm-status-dot', { connected: isConnected }]"></span>
        <span class="stm-status-text">{{ isConnected ? '后端已连接' : '后端未连接' }}</span>
      </div>
    </header>

    <!-- 标签页导航 -->
    <nav class="stm-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['stm-tab', { active: activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        <span class="stm-tab-icon">{{ tab.icon }}</span>
        <span class="stm-tab-label">{{ tab.label }}</span>
      </button>
    </nav>

    <!-- 内容区域 -->
    <main class="stm-content">
      <!-- 概览面板 -->
      <div v-if="activeTab === 'overview'" class="stm-panel">
        <OverviewPanel
          :stats="stats"
          :is-connected="isConnected"
          @refresh="refreshStats"
          @connect="connectBackend"
        />
      </div>

      <!-- 资源管理面板 -->
      <div v-else-if="activeTab === 'resources'" class="stm-panel">
        <ResourcePanel @track-change="trackChange" />
      </div>

      <!-- 备份管理面板 -->
      <div v-else-if="activeTab === 'backup'" class="stm-panel">
        <BackupPanel :is-connected="isConnected" />
      </div>

      <!-- 设置面板 -->
      <div v-else-if="activeTab === 'settings'" class="stm-panel">
        <SettingsPanel
          :config="config"
          @update-config="updateConfig"
        />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { backendService } from './services/backendApi';
import OverviewPanel from './components/OverviewPanel.vue';
import ResourcePanel from './components/ResourcePanel.vue';
import BackupPanel from './components/BackupPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';

// 标签页配置
const tabs = [
  { id: 'overview', label: '概览', icon: '📊' },
  { id: 'resources', label: '资源管理', icon: '📁' },
  { id: 'backup', label: '备份', icon: '💾' },
  { id: 'settings', label: '设置', icon: '⚙️' },
];

const activeTab = ref('overview');
const isConnected = ref(false);
const config = reactive<Record<string, any>>({});

const stats = reactive({
  characters: 0,
  worldbooks: 0,
  presets: 0,
  regexScripts: 0,
  backups: 0,
  lastBackup: null as string | null,
});

/**
 * 连接后端服务
 */
async function connectBackend() {
  try {
    isConnected.value = await backendService.checkConnection();
    if (isConnected.value) {
      showToast('后端连接成功', 'success');
      await loadConfig();
      await refreshStats();
    } else {
      showToast('后端连接失败，请检查服务是否启动', 'error');
    }
  } catch (e) {
    console.error('[ST Manager] 连接后端失败:', e);
    isConnected.value = false;
  }
}

/**
 * 加载配置
 */
async function loadConfig() {
  if (!isConnected.value) return;
  try {
    const cfg = await backendService.getConfig();
    Object.assign(config, cfg);
  } catch (e) {
    console.error('[ST Manager] 加载配置失败:', e);
  }
}

/**
 * 更新配置
 */
async function updateConfig(newConfig: Record<string, any>) {
  if (!isConnected.value) return;
  try {
    await backendService.updateConfig(newConfig);
    Object.assign(config, newConfig);
    showToast('配置已保存', 'success');
  } catch (e) {
    console.error('[ST Manager] 保存配置失败:', e);
    showToast('保存配置失败', 'error');
  }
}

/**
 * 刷新统计数据
 */
async function refreshStats() {
  try {
    // 从后端获取资源统计
    if (isConnected.value) {
      const backendStats = await backendService.getStats();
      stats.characters = backendStats.characters;
      stats.worldbooks = backendStats.worldbooks;
      stats.presets = backendStats.presets;
      stats.regexScripts = backendStats.regexScripts;
      
      // 获取备份信息
      const backups = await backendService.listBackups();
      stats.backups = backups.length;
      if (backups.length > 0) {
        stats.lastBackup = backups[0].timestamp;
      }
    }
  } catch (e) {
    console.error('[ST Manager] 刷新统计失败:', e);
  }
}

/**
 * 追踪资源变更
 */
async function trackChange(type: string, id: string) {
  if (!isConnected.value) return;
  try {
    await backendService.trackChange(type, id);
  } catch (e) {
    console.error('[ST Manager] 追踪变更失败:', e);
  }
}

/**
 * 显示提示
 */
function showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
  if (window.toastr) {
    window.toastr[type](message);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

onMounted(() => {
  // 自动连接后端
  connectBackend();
});
</script>

<style>
.stm-app {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--SmartThemeBodyColor, #e0e0e0);
  background: var(--SmartThemeBgColor, #1a1a2e);
  border-radius: 8px;
  overflow: hidden;
}

.stm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.stm-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stm-icon {
  font-size: 20px;
}

.stm-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.9;
}

.stm-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff6b6b;
  transition: background 0.3s;
}

.stm-status-dot.connected {
  background: #51cf66;
}

.stm-tabs {
  display: flex;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05));
  border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  overflow-x: auto;
}

.stm-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: var(--SmartThemeBodyColor, #e0e0e0);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  white-space: nowrap;
}

.stm-tab:hover {
  background: rgba(255, 255, 255, 0.05);
}

.stm-tab.active {
  background: rgba(102, 126, 234, 0.2);
  color: #667eea;
  border-bottom: 2px solid #667eea;
}

.stm-tab-icon {
  font-size: 14px;
}

.stm-content {
  padding: 16px;
  min-height: 300px;
  max-height: 500px;
  overflow-y: auto;
}

.stm-panel {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 滚动条样式 */
.stm-app ::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.stm-app ::-webkit-scrollbar-track {
  background: transparent;
}

.stm-app ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.stm-app ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
