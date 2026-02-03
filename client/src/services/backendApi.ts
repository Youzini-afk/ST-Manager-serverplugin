/**
 * 后端 API 服务
 * 
 * 优先使用 SillyTavern 服务端插件，回退到独立 Python 后端
 */

import type { BackupOptions, BackupResult, BackupInfo, BackupSchedule } from '../types';

// 服务端插件 API 路径（优先）
const SERVER_PLUGIN_PATH = '/api/plugins/st-manager';

// 独立 Python 后端地址（回退）
const STANDALONE_BACKEND_URL = 'http://localhost:5000';

// API 版本前缀（仅独立后端使用）
const API_V2_PREFIX = '/api/v2';

class BackendService {
  private baseUrl: string;
  private connected: boolean = false;
  private useServerPlugin: boolean = true; // 默认优先使用服务端插件

  constructor() {
    // 默认使用服务端插件
    this.baseUrl = SERVER_PLUGIN_PATH;
  }

  /**
   * 设置后端地址
   */
  setBaseUrl(url: string) {
    this.baseUrl = url;
    this.connected = false;
    // 检测是否为服务端插件模式
    this.useServerPlugin = url === SERVER_PLUGIN_PATH || url.endsWith(SERVER_PLUGIN_PATH);
  }

  /**
   * 启用服务端插件模式
   */
  useServerPluginMode() {
    this.baseUrl = SERVER_PLUGIN_PATH;
    this.useServerPlugin = true;
    this.connected = false;
  }

  /**
   * 获取 API 端点（自动添加版本前缀）
   */
  private getEndpoint(path: string): string {
    // 服务端插件不需要 /api/v2 前缀
    if (this.useServerPlugin) {
      return path.replace(API_V2_PREFIX, '');
    }
    return path;
  }

  /**
   * 获取请求头
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  /**
   * 发送请求
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${this.getEndpoint(endpoint)}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `请求失败: ${response.status}`);
    }

    return response.json();
  }

  /**
   * 检查后端连接
   * 自动尝试服务端插件和独立后端
   */
  async checkConnection(): Promise<boolean> {
    // 先尝试服务端插件
    try {
      const pluginResult = await fetch(`${SERVER_PLUGIN_PATH}/health`);
      if (pluginResult.ok) {
        const data = await pluginResult.json();
        if (data.status === 'ok') {
          this.useServerPlugin = true;
          this.baseUrl = SERVER_PLUGIN_PATH;
          this.connected = true;
          console.log('[ST Manager] 已连接到服务端插件');
          return true;
        }
      }
    } catch (e) {
      // 服务端插件不可用，尝试独立后端
      console.log('[ST Manager] 服务端插件不可用，尝试独立后端...');
    }

    // 尝试独立后端
    try {
      this.baseUrl = STANDALONE_BACKEND_URL;
      this.useServerPlugin = false;
      const result = await this.request<{ status: string; version: string }>('/api/v2/health');
      this.connected = result.status === 'ok';
      if (this.connected) {
        console.log('[ST Manager] 已连接到独立后端');
      }
      return this.connected;
    } catch (e) {
      this.connected = false;
      console.warn('[ST Manager] 后端连接失败:', e);
      return false;
    }
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============ 备份相关 API ============

  /**
   * 获取资源统计
   */
  async getStats(): Promise<{
    characters: number;
    worldbooks: number;
    presets: number;
    regexScripts: number;
  }> {
    return this.request('/api/v2/stats');
  }

  /**
   * 触发手动备份
   */
  async triggerBackup(options?: BackupOptions): Promise<BackupResult> {
    return this.request<BackupResult>('/api/v2/backup/trigger', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  /**
   * 获取备份列表
   */
  async listBackups(): Promise<BackupInfo[]> {
    return this.request<BackupInfo[]>('/api/v2/backup/list');
  }

  /**
   * 从备份恢复
   */
  async restoreBackup(backupId: string): Promise<{ success: boolean; message: string }> {
    return this.request('/api/v2/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ backupId }),
    });
  }

  /**
   * 删除备份
   */
  async deleteBackup(backupId: string): Promise<{ success: boolean }> {
    return this.request('/api/v2/backup/delete', {
      method: 'DELETE',
      body: JSON.stringify({ backupId }),
    });
  }

  /**
   * 获取备份计划
   */
  async getBackupSchedule(): Promise<BackupSchedule> {
    return this.request<BackupSchedule>('/api/v2/backup/schedule');
  }

  /**
   * 设置备份计划
   */
  async setBackupSchedule(schedule: BackupSchedule): Promise<{ success: boolean }> {
    return this.request('/api/v2/backup/schedule', {
      method: 'POST',
      body: JSON.stringify(schedule),
    });
  }

  // ============ 配置相关 API ============

  /**
   * 获取插件配置
   */
  async getConfig(): Promise<Record<string, any>> {
    return this.request('/api/v2/config');
  }

  /**
   * 更新插件配置
   */
  async updateConfig(config: Record<string, any>): Promise<{ success: boolean }> {
    return this.request('/api/v2/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // ============ 资源列表 API ============

  /**
   * 获取角色卡列表
   */
  async listCards(page: number = 1, pageSize: number = 100): Promise<any> {
    return this.request(`/api/list_cards?page=${page}&page_size=${pageSize}&recursive=true`);
  }

  /**
   * 获取世界书列表
   */
  async listWorldbooks(): Promise<any> {
    return this.request('/api/world_info/list');
  }

  /**
   * 获取预设列表
   */
  async listPresets(): Promise<any> {
    return this.request('/api/presets/list');
  }

  /**
   * 获取正则脚本列表
   */
  async listRegexScripts(): Promise<any> {
    return this.request('/api/v2/regex/list');
  }

  // ============ 资源同步 API ============

  /**
   * 同步资源到酒馆
   */
  async syncToST(resourceType: string, resourceId: string): Promise<{ success: boolean }> {
    return this.request('/api/v2/sync/to-st', {
      method: 'POST',
      body: JSON.stringify({ type: resourceType, id: resourceId }),
    });
  }

  /**
   * 从酒馆同步资源
   */
  async syncFromST(resourceType: string): Promise<{ success: boolean; count: number }> {
    return this.request('/api/v2/sync/from-st', {
      method: 'POST',
      body: JSON.stringify({ type: resourceType }),
    });
  }

  /**
   * 追踪资源变更（用于增量备份）
   */
  async trackChange(resourceType: string, resourceId: string): Promise<void> {
    await this.request('/api/v2/track-change', {
      method: 'POST',
      body: JSON.stringify({
        type: resourceType,
        id: resourceId,
        timestamp: Date.now(),
      }),
    });
  }
}

// 单例导出
export const backendService = new BackendService();
export default backendService;
