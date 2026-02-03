/**
 * ST Manager Plugin - 酒馆插件入口
 * 
 * 注册到酒馆的扩展设置面板，提供资源管理和备份功能
 */

import { createApp, type App as VueApp } from 'vue';
import MainApp from './App.vue';
import { backendService } from './services/backendApi';
import type { STManagerPluginInstance } from './types';

const PLUGIN_VERSION = '1.0.0';
const PLUGIN_ID = 'st-manager';

// Vue 应用实例
let vueApp: VueApp | null = null;

/**
 * 初始化插件
 */
async function initPlugin() {
  try {
    const ctx = window.SillyTavern?.getContext?.();
    if (!ctx) {
      console.warn('[ST Manager] SillyTavern context not found, retrying in 1s...');
      setTimeout(initPlugin, 1000);
      return;
    }

    console.log(`[ST Manager] Plugin v${PLUGIN_VERSION} initializing...`);

  const { eventSource, event_types } = ctx;
  let isRegistered = false;

  const register = async () => {
    // 避免重复注册
    if (isRegistered || document.getElementById('st-manager_settings_container')) {
      return;
    }
    isRegistered = true;

    // 检查 ST_API 是否可用
    if (!window.ST_API?.ui?.registerSettingsPanel) {
      console.warn('[ST Manager] ST_API.ui.registerSettingsPanel not available, using fallback');
      await registerFallback();
      return;
    }

    try {
      // 使用 ST_API 注册设置面板
      await window.ST_API.ui.registerSettingsPanel({
        id: `${PLUGIN_ID}.settings`,
        title: 'ST Manager 资源管理',
        target: 'extensions_settings',
        expanded: false,
        order: 10,
        content: {
          kind: 'render',
          render: (container: HTMLElement) => {
            const mountPoint = document.createElement('div');
            mountPoint.id = 'st-manager-app';
            container.appendChild(mountPoint);
            
            vueApp = createApp(MainApp);
            vueApp.mount(mountPoint);
            
            console.log('[ST Manager] Vue app mounted');
            
            return () => {
              vueApp?.unmount();
              vueApp = null;
            };
          },
        },
      });

      console.log('[ST Manager] Settings panel registered via ST_API');
    } catch (e) {
      console.error('[ST Manager] Failed to register via ST_API:', e);
      await registerFallback();
    }
  };

  /**
   * 备用注册方式 - 直接操作 DOM
   */
  async function registerFallback() {
    // 查找扩展设置容器
    const extensionsSettings = document.getElementById('extensions_settings');
    if (!extensionsSettings) {
      console.warn('[ST Manager] Extensions settings container not found');
      return;
    }

    // 创建设置面板
    const panelHtml = `
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>ST Manager 资源管理</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" id="st-manager_settings_container">
          <div id="st-manager-app"></div>
        </div>
      </div>
    `;

    // 插入到扩展设置
    extensionsSettings.insertAdjacentHTML('beforeend', panelHtml);

    // 绑定展开/收起事件
    const toggle = extensionsSettings.querySelector('.inline-drawer-toggle:last-of-type');
    const content = document.getElementById('st-manager_settings_container');
    
    if (toggle && content) {
      toggle.addEventListener('click', () => {
        content.classList.toggle('open');
        const icon = toggle.querySelector('.inline-drawer-icon');
        icon?.classList.toggle('down');
        icon?.classList.toggle('up');
      });
    }

    // 挂载 Vue 应用
    const mountPoint = document.getElementById('st-manager-app');
    if (mountPoint) {
      vueApp = createApp(MainApp);
      vueApp.mount(mountPoint);
      console.log('[ST Manager] Vue app mounted (fallback)');
    }
  }

  // 监听扩展面板就绪事件
  if (event_types?.EXTENSIONS_FIRST_LOAD) {
    eventSource.on(event_types.EXTENSIONS_FIRST_LOAD, register);
  }

  // 如果扩展设置已存在，直接注册
  if (document.getElementById('extensions_settings')) {
    await register();
  }

  // 初始化后端连接
  initBackendConnection();

  // 注册扩展菜单项（魔法棒）
  registerExtensionMenu();

  // 暴露全局 API
  exposeGlobalApi();
  
  console.log('[ST Manager] Plugin initialized successfully');
  } catch (error) {
    console.error('[ST Manager] Failed to initialize plugin:', error);
    // 即使出错也暴露全局 API，方便调试
    try {
      exposeGlobalApi();
    } catch (e) {
      console.error('[ST Manager] Failed to expose global API:', e);
    }
  }
}

/**
 * 初始化后端连接
 */
async function initBackendConnection() {
  // 从本地存储读取后端地址
  const savedUrl = localStorage.getItem('stm_backend_url');
  if (savedUrl) {
    backendService.setBaseUrl(savedUrl);
  }

  // 尝试连接后端
  const connected = await backendService.checkConnection();
  console.log(`[ST Manager] Backend connection: ${connected ? 'OK' : 'Failed'}`);
}

/**
 * 注册扩展菜单项（魔法棒）
 */
function registerExtensionMenu() {
  try {
    // 方法 1: 使用 SlashCommand（如果可用）
    if (window.ST_API?.slashCommand?.register) {
      window.ST_API.slashCommand.register({
        name: 'stmanager',
        description: '打开 ST Manager 资源管理面板',
        callback: () => {
          openWebUI();
        },
      });
    }

    // 方法 2: 直接添加到扩展菜单按钮
    const addExtensionButton = () => {
      // 查找扩展菜单容器
      const extensionsMenu = document.querySelector('#extensionsMenu, .extensions_menu, [data-extension-menu]');
      if (!extensionsMenu) {
        console.warn('[ST Manager] Extensions menu not found');
        return;
      }

      // 检查是否已添加
      if (document.getElementById('stm-menu-button')) {
        return;
      }

      // 创建菜单按钮
      const button = document.createElement('div');
      button.id = 'stm-menu-button';
      button.className = 'list-group-item flex-container flexGap5';
      button.style.cursor = 'pointer';
      button.innerHTML = `
        <div class="fa-solid fa-box-archive extensionsMenuExtensionButton"></div>
        <span>ST Manager 资源管理</span>
      `;

      button.addEventListener('click', (e) => {
        e.preventDefault();
        openWebUI();
      });

      extensionsMenu.appendChild(button);
      console.log('[ST Manager] Extension menu button added');
    };

    // 延迟添加，确保 DOM 已加载
    setTimeout(addExtensionButton, 1000);

    // 监听 DOM 变化，以防菜单动态加载
    const observer = new MutationObserver(() => {
      if (!document.getElementById('stm-menu-button')) {
        addExtensionButton();
      }
    });

    const targetNode = document.body;
    observer.observe(targetNode, { childList: true, subtree: true });

  } catch (e) {
    console.error('[ST Manager] Failed to register extension menu:', e);
  }
}

/**
 * 打开 Web UI（新标签页）
 */
function openWebUI() {
  const backendUrl = localStorage.getItem('stm_backend_url') || 'http://localhost:5000';
  
  // 检查后端是否可用
  backendService.checkConnection().then((connected) => {
    if (!connected) {
      if (window.toastr) {
        window.toastr.warning(`无法连接到后端服务 (${backendUrl})，请先启动 Python 后端`, 'ST Manager');
      } else {
        alert(`无法连接到后端服务 (${backendUrl})，请先启动 Python 后端`);
      }
      return;
    }

    // 打开新标签页
    window.open(backendUrl, '_blank');
    
    if (window.toastr) {
      window.toastr.success('已在新标签页打开 ST Manager Web UI', 'ST Manager');
    }
  });
}

/**
 * 暴露全局 API
 */
function exposeGlobalApi() {
  const pluginApi: STManagerPluginInstance = {
    version: PLUGIN_VERSION,
    backendUrl: 'http://localhost:5000',
    isConnected: false,

    async connect() {
      this.isConnected = await backendService.checkConnection();
      return this.isConnected;
    },

    backup: {
      async trigger(options) {
        return backendService.triggerBackup(options);
      },
      async list() {
        return backendService.listBackups();
      },
      async restore(backupId) {
        const result = await backendService.restoreBackup(backupId);
        return result.success;
      },
      async getSchedule() {
        return backendService.getBackupSchedule();
      },
      async setSchedule(schedule) {
        const result = await backendService.setBackupSchedule(schedule);
        return result.success;
      },
    },
  };

  window.STManagerPlugin = pluginApi;
  console.log('[ST Manager] Global API exposed as window.STManagerPlugin');
}

// 启动插件（使用错误捕获包装）
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initPlugin().catch(err => {
        console.error('[ST Manager] Initialization error:', err);
      });
    });
  } else {
    initPlugin().catch(err => {
      console.error('[ST Manager] Initialization error:', err);
    });
  }
} catch (error) {
  console.error('[ST Manager] Fatal error during plugin load:', error);
}

// 导出供模块化使用
export { initPlugin, backendService };
