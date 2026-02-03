<template>
  <div class="stm-resources">
    <!-- 资源类型选择器 -->
    <div class="stm-resource-tabs">
      <button
        v-for="type in resourceTypes"
        :key="type.id"
        :class="['stm-resource-tab', { active: activeType === type.id }]"
        @click="switchType(type.id)"
      >
        <span>{{ type.icon }}</span>
        <span>{{ type.label }}</span>
      </button>
    </div>

    <!-- 搜索栏 -->
    <div class="stm-search-bar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索资源..."
        class="stm-search-input"
        @input="filterItems"
      />
      <button class="stm-btn stm-btn-icon" @click="refreshList">
        🔄
      </button>
    </div>

    <!-- 资源列表 -->
    <div class="stm-resource-list">
      <div v-if="loading" class="stm-loading">
        <span class="stm-spinner"></span>
        <span>加载中...</span>
      </div>

      <div v-else-if="filteredItems.length === 0" class="stm-empty">
        <span class="stm-empty-icon">📭</span>
        <span>暂无资源</span>
      </div>

      <div
        v-else
        v-for="item in filteredItems"
        :key="item.id"
        class="stm-resource-item"
        @click="selectItem(item)"
      >
        <div class="stm-resource-avatar">
          <img v-if="item.avatar" :src="item.avatar" :alt="item.name" />
          <span v-else class="stm-resource-placeholder">{{ getInitial(item.name) }}</span>
        </div>
        <div class="stm-resource-info">
          <span class="stm-resource-name">{{ item.name }}</span>
          <span class="stm-resource-meta">{{ item.meta || '' }}</span>
        </div>
        <div class="stm-resource-actions">
          <button class="stm-btn-icon" title="编辑" @click.stop="editItem(item)">✏️</button>
          <button class="stm-btn-icon" title="删除" @click.stop="deleteItem(item)">🗑️</button>
        </div>
      </div>
    </div>

    <!-- 编辑模态框 -->
    <div v-if="editingItem" class="stm-modal-overlay" @click.self="closeEditor">
      <div class="stm-modal">
        <div class="stm-modal-header">
          <h3>编辑 {{ activeTypeLabel }}</h3>
          <button class="stm-btn-icon" @click="closeEditor">✕</button>
        </div>
        <div class="stm-modal-body">
          <div class="stm-form-group">
            <label>名称</label>
            <input v-model="editingItem.name" type="text" class="stm-input" />
          </div>
          <div v-if="activeType === 'character'" class="stm-form-group">
            <label>描述</label>
            <textarea v-model="editingItem.description" class="stm-textarea" rows="3"></textarea>
          </div>
          <div v-if="activeType === 'character'" class="stm-form-group">
            <label>人设</label>
            <textarea v-model="editingItem.personality" class="stm-textarea" rows="4"></textarea>
          </div>
          <!-- 可扩展其他字段 -->
        </div>
        <div class="stm-modal-footer">
          <button class="stm-btn" @click="closeEditor">取消</button>
          <button class="stm-btn stm-btn-primary" @click="saveItem">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { backendService } from '../services/backendApi';

interface ResourceItem {
  id: string;
  name: string;
  avatar?: string;
  meta?: string;
  [key: string]: any;
}

const emit = defineEmits<{
  (e: 'track-change', type: string, id: string): void;
}>();

const resourceTypes = [
  { id: 'character', label: '角色卡', icon: '🎴' },
  { id: 'worldbook', label: '世界书', icon: '📚' },
  { id: 'preset', label: '预设', icon: '📝' },
  { id: 'regex', label: '正则', icon: '🧩' },
];

const activeType = ref('character');
const searchQuery = ref('');
const loading = ref(false);
const items = ref<ResourceItem[]>([]);
const editingItem = ref<ResourceItem | null>(null);

const activeTypeLabel = computed(() => {
  return resourceTypes.find((t) => t.id === activeType.value)?.label || '';
});

const filteredItems = computed(() => {
  if (!searchQuery.value) return items.value;
  const query = searchQuery.value.toLowerCase();
  return items.value.filter(
    (item) =>
      item.name.toLowerCase().includes(query) ||
      item.meta?.toLowerCase().includes(query)
  );
});

function getInitial(name: string): string {
  return name?.charAt(0)?.toUpperCase() || '?';
}

async function switchType(type: string) {
  activeType.value = type;
  await refreshList();
}

async function refreshList() {
  loading.value = true;
  try {
    switch (activeType.value) {
      case 'character':
        const cardsResult = await backendService.listCards();
        const chars = cardsResult.cards || [];
        items.value = chars.map((c: any) => ({
          id: c.id,
          name: c.char_name || c.filename,
          avatar: c.thumb_url,
          meta: c.creator || `${c.token_count || 0} tokens`,
          ...c,
        }));
        break;
      case 'worldbook':
        const wbResult = await backendService.listWorldbooks();
        const wbs = wbResult.items || [];
        items.value = wbs.map((wb: any) => ({
          id: wb.name || wb.filename,
          name: wb.name || wb.filename?.replace('.json', ''),
          meta: wb.entry_count ? `${wb.entry_count} 条目` : '',
          ...wb,
        }));
        break;
      case 'preset':
        const presetResult = await backendService.listPresets();
        const presets = presetResult.items || [];
        items.value = presets.map((p: any) => ({
          id: p.name || p.filename,
          name: p.name || p.filename?.replace('.json', ''),
          meta: p.description || '',
          ...p,
        }));
        break;
      case 'regex':
        const regexResult = await backendService.listRegexScripts();
        const regexes = regexResult.items || [];
        items.value = regexes.map((r: any) => ({
          id: r.id || r.name,
          name: r.name || r.filename?.replace('.json', ''),
          meta: r.enabled ? '启用' : '禁用',
          ...r,
        }));
        break;
    }
  } catch (e) {
    console.error('[ST Manager] 加载资源列表失败:', e);
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function filterItems() {
  // 过滤由 computed 处理
}

function selectItem(item: ResourceItem) {
  console.log('[ST Manager] 选中:', item);
}

async function editItem(item: ResourceItem) {
  // 暂时使用列表数据
  editingItem.value = { ...item };
}

async function saveItem() {
  if (!editingItem.value) return;
  
  loading.value = true;
  try {
    // 暂时只提示，后续实现编辑 API
    window.toastr?.info('编辑功能开发中');
    closeEditor();
  } catch (e) {
    console.error('[ST Manager] 保存失败:', e);
    window.toastr?.error('保存失败');
  } finally {
    loading.value = false;
  }
}

async function deleteItem(item: ResourceItem) {
  if (!confirm(`确定要删除 "${item.name}" 吗？`)) return;

  loading.value = true;
  try {
    // 暂时只提示，后续实现删除 API
    window.toastr?.info('删除功能开发中');
  } catch (e) {
    console.error('[ST Manager] 删除失败:', e);
    window.toastr?.error('删除失败');
  } finally {
    loading.value = false;
  }
}

function closeEditor() {
  editingItem.value = null;
}

onMounted(() => {
  refreshList();
});
</script>

<style scoped>
.stm-resources {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stm-resource-tabs {
  display: flex;
  gap: 4px;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.03));
  padding: 4px;
  border-radius: 8px;
}

.stm-resource-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  border: none;
  background: transparent;
  color: var(--SmartThemeBodyColor, #e0e0e0);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.stm-resource-tab:hover {
  background: rgba(255, 255, 255, 0.05);
}

.stm-resource-tab.active {
  background: #667eea;
  color: white;
}

.stm-search-bar {
  display: flex;
  gap: 8px;
}

.stm-search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05));
  color: var(--SmartThemeBodyColor, #e0e0e0);
  font-size: 13px;
}

.stm-search-input::placeholder {
  color: var(--SmartThemeBodyColor, #e0e0e0);
  opacity: 0.5;
}

.stm-resource-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow-y: auto;
}

.stm-resource-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.stm-resource-item:hover {
  background: rgba(102, 126, 234, 0.1);
  border-color: rgba(102, 126, 234, 0.3);
}

.stm-resource-avatar {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea, #764ba2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stm-resource-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.stm-resource-placeholder {
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.stm-resource-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stm-resource-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stm-resource-meta {
  font-size: 11px;
  opacity: 0.6;
}

.stm-resource-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.stm-resource-item:hover .stm-resource-actions {
  opacity: 1;
}

.stm-btn-icon {
  padding: 4px 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  transition: background 0.2s;
}

.stm-btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
}

.stm-loading,
.stm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 10px;
  opacity: 0.6;
}

.stm-empty-icon {
  font-size: 32px;
}

.stm-spinner {
  width: 24px;
  height: 24px;
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

/* 模态框 */
.stm-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.stm-modal {
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  background: var(--SmartThemeBgColor, #1a1a2e);
  border-radius: 12px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.stm-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
}

.stm-modal-header h3 {
  margin: 0;
  font-size: 16px;
}

.stm-modal-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.stm-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
}

.stm-form-group {
  margin-bottom: 14px;
}

.stm-form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  opacity: 0.8;
}

.stm-input,
.stm-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05));
  color: var(--SmartThemeBodyColor, #e0e0e0);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
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
</style>
