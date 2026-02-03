<template>
  <div class="stm-settings">
    <!-- 后端连接设置 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>🔗 后端连接</h3>
      </div>
      <div class="stm-card-body">
        <div class="stm-form-group">
          <label>后端地址</label>
          <input
            v-model="backendUrl"
            type="text"
            class="stm-input"
            placeholder="http://localhost:5000"
          />
          <small class="stm-hint">ST-Manager Python 后端服务的地址（默认端口 5000）</small>
        </div>
        <div class="stm-btn-group">
          <button class="stm-btn stm-btn-primary" @click="saveBackendUrl">
            保存并重连
          </button>
          <button class="stm-btn" @click="openWebUI" :disabled="!isBackendConnected">
            打开 Web UI
          </button>
        </div>
      </div>
    </div>

    <!-- 酒馆数据路径 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>📂 酒馆数据路径</h3>
      </div>
      <div class="stm-card-body">
        <div class="stm-form-group">
          <label>SillyTavern 数据目录</label>
          <input
            v-model="localConfig.st_data_path"
            type="text"
            class="stm-input"
            placeholder="E:/SillyTavern/data"
          />
          <small class="stm-hint">酒馆的 data 目录路径，用于文件操作</small>
        </div>
      </div>
    </div>

    <!-- 同步设置 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>🔄 同步设置</h3>
      </div>
      <div class="stm-card-body">
        <div class="stm-form-row">
          <label class="stm-checkbox">
            <input v-model="localConfig.auto_sync" type="checkbox" />
            <span>自动同步变更</span>
          </label>
        </div>
        <div class="stm-form-row">
          <label class="stm-checkbox">
            <input v-model="localConfig.track_changes" type="checkbox" />
            <span>追踪资源修改（用于增量备份）</span>
          </label>
        </div>
        <div class="stm-form-group">
          <label>同步间隔（秒）</label>
          <input
            v-model.number="localConfig.sync_interval"
            type="number"
            class="stm-input"
            min="10"
            max="3600"
          />
        </div>
      </div>
    </div>

    <!-- 界面设置 -->
    <div class="stm-card">
      <div class="stm-card-header">
        <h3>🎨 界面设置</h3>
      </div>
      <div class="stm-card-body">
        <div class="stm-form-group">
          <label>每页显示数量</label>
          <select v-model.number="localConfig.page_size" class="stm-select">
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </div>
        <div class="stm-form-row">
          <label class="stm-checkbox">
            <input v-model="localConfig.show_thumbnails" type="checkbox" />
            <span>显示缩略图</span>
          </label>
        </div>
        <div class="stm-form-row">
          <label class="stm-checkbox">
            <input v-model="localConfig.compact_mode" type="checkbox" />
            <span>紧凑模式</span>
          </label>
        </div>
      </div>
    </div>

    <!-- 保存按钮 -->
    <div class="stm-actions">
      <button class="stm-btn" @click="resetConfig">恢复默认</button>
      <button class="stm-btn stm-btn-primary" @click="saveConfig">保存所有设置</button>
    </div>

    <!-- 关于 -->
    <div class="stm-card stm-about">
      <div class="stm-card-body">
        <div class="stm-about-info">
          <strong>ST Manager Plugin</strong>
          <span class="stm-version">v1.0.0</span>
        </div>
        <p class="stm-about-desc">
          SillyTavern 资源可视化管理插件，支持角色卡、世界书、预设、正则等资源的管理与备份。
        </p>
        <div class="stm-about-links">
          <a href="https://github.com/Dadihu123/ST-Manager" target="_blank">📖 文档</a>
          <a href="https://github.com/Dadihu123/ST-Manager/issues" target="_blank">🐛 反馈</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { backendService } from '../services/backendApi';

const props = defineProps<{
  config: Record<string, any>;
}>();

const emit = defineEmits<{
  (e: 'update-config', config: Record<string, any>): void;
}>();

// 后端地址
const backendUrl = ref('http://localhost:5000');
const isBackendConnected = ref(false);

// 本地配置副本
const localConfig = reactive({
  st_data_path: '',
  auto_sync: true,
  track_changes: true,
  sync_interval: 60,
  page_size: 50,
  show_thumbnails: true,
  compact_mode: false,
});

// 默认配置
const defaultConfig = {
  st_data_path: '',
  auto_sync: true,
  track_changes: true,
  sync_interval: 60,
  page_size: 50,
  show_thumbnails: true,
  compact_mode: false,
};

// 同步 props 到本地状态
watch(
  () => props.config,
  (newConfig) => {
    Object.assign(localConfig, {
      ...defaultConfig,
      ...newConfig,
    });
  },
  { immediate: true, deep: true }
);

/**
 * 保存后端地址并重连
 */
async function saveBackendUrl() {
  backendService.setBaseUrl(backendUrl.value);
  const connected = await backendService.checkConnection();
  isBackendConnected.value = connected;
  
  if (connected) {
    window.toastr?.success('后端连接成功');
    localStorage.setItem('stm_backend_url', backendUrl.value);
  } else {
    window.toastr?.error('后端连接失败');
  }
}

function openWebUI() {
  window.open(backendUrl.value, '_blank');
  window.toastr?.info('已在新标签页打开 Web UI');
}

/**
 * 保存所有配置
 */
function saveConfig() {
  emit('update-config', { ...localConfig });
}

/**
 * 恢复默认配置
 */
function resetConfig() {
  if (!confirm('确定要恢复默认设置吗？')) return;
  Object.assign(localConfig, defaultConfig);
  window.toastr?.info('已恢复默认设置，请点击保存');
}

// 初始化时加载本地存储的后端地址
const savedUrl = localStorage.getItem('stm_backend_url');
if (savedUrl) {
  backendUrl.value = savedUrl;
}

backendService.checkConnection().then((connected) => {
  isBackendConnected.value = connected;
});
</script>

<style scoped>
.stm-settings {
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

.stm-form-row {
  margin-bottom: 10px;
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

.stm-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.stm-checkbox input {
  width: 16px;
  height: 16px;
  accent-color: #667eea;
}

.stm-btn-group {
  display: flex;
  gap: 8px;
}

.stm-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.stm-btn {
  padding: 8px 16px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
  border-radius: 6px;
  background: transparent;
  color: var(--SmartThemeBodyColor, #e0e0e0);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.stm-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.stm-btn-primary {
  background: #667eea;
  border-color: #667eea;
  color: white;
}

.stm-btn-primary:hover {
  background: #5a6fd6;
}

.stm-about {
  margin-top: 10px;
}

.stm-about-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.stm-version {
  font-size: 11px;
  padding: 2px 6px;
  background: rgba(102, 126, 234, 0.2);
  color: #667eea;
  border-radius: 4px;
}

.stm-about-desc {
  font-size: 12px;
  opacity: 0.7;
  margin: 0 0 10px 0;
  line-height: 1.5;
}

.stm-about-links {
  display: flex;
  gap: 16px;
}

.stm-about-links a {
  font-size: 12px;
  color: #667eea;
  text-decoration: none;
}

.stm-about-links a:hover {
  text-decoration: underline;
}
</style>
