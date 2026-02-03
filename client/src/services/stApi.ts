/**
 * 酒馆 API 封装
 * 提供对酒馆内置 API 的统一访问接口
 */

import type {
  CharacterInfo,
  CharacterData,
  WorldbookInfo,
  WorldbookData,
  WorldbookEntry,
  PresetInfo,
  PresetData,
  RegexScriptInfo,
  RegexScriptData,
} from '../types';

/**
 * 获取酒馆上下文
 */
function getContext() {
  return window.SillyTavern?.getContext?.();
}

/**
 * 获取请求头
 */
function getHeaders(): Record<string, string> {
  const ctx = getContext();
  return {
    'Content-Type': 'application/json',
    ...(ctx?.getRequestHeaders?.() || {}),
  };
}

/**
 * 发送请求到酒馆后端
 */
async function stRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      ...getHeaders(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`酒馆 API 错误: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }
  return response.text() as unknown as T;
}

// ============ 角色卡 API ============

export const characterApi = {
  /**
   * 获取所有角色卡列表
   */
  async list(): Promise<CharacterInfo[]> {
    // 优先使用 ST_API
    if (window.ST_API?.character?.list) {
      return window.ST_API.character.list();
    }
    
    // 回退到直接调用
    const result = await stRequest<any[]>('/api/characters/all');
    return result.map((char: any) => ({
      id: char.avatar || char.name,
      name: char.name,
      avatar: char.avatar,
      description: char.description,
      creator: char.creator,
      tags: char.tags || [],
    }));
  },

  /**
   * 获取角色卡详情
   */
  async get(avatarOrName: string): Promise<CharacterData | null> {
    if (window.ST_API?.character?.get) {
      return window.ST_API.character.get(avatarOrName);
    }

    try {
      const result = await stRequest<any>(`/api/characters/get`, {
        method: 'POST',
        body: JSON.stringify({ avatar_url: avatarOrName }),
      });
      return result;
    } catch (e) {
      console.error('[ST Manager] 获取角色卡失败:', e);
      return null;
    }
  },

  /**
   * 更新角色卡
   */
  async update(id: string, data: Partial<CharacterData>): Promise<boolean> {
    if (window.ST_API?.character?.update) {
      return window.ST_API.character.update(id, data);
    }

    try {
      await stRequest('/api/characters/edit', {
        method: 'POST',
        body: JSON.stringify({
          avatar_url: id,
          ...data,
        }),
      });
      return true;
    } catch (e) {
      console.error('[ST Manager] 更新角色卡失败:', e);
      return false;
    }
  },

  /**
   * 创建角色卡
   */
  async create(data: CharacterData): Promise<string | null> {
    if (window.ST_API?.character?.create) {
      return window.ST_API.character.create(data);
    }

    try {
      const result = await stRequest<{ file_name: string }>('/api/characters/create', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return result.file_name;
    } catch (e) {
      console.error('[ST Manager] 创建角色卡失败:', e);
      return null;
    }
  },

  /**
   * 删除角色卡
   */
  async delete(avatarOrName: string): Promise<boolean> {
    if (window.ST_API?.character?.delete) {
      return window.ST_API.character.delete(avatarOrName);
    }

    try {
      await stRequest('/api/characters/delete', {
        method: 'POST',
        body: JSON.stringify({ avatar_url: avatarOrName }),
      });
      return true;
    } catch (e) {
      console.error('[ST Manager] 删除角色卡失败:', e);
      return false;
    }
  },
};

// ============ 世界书 API ============

export const worldbookApi = {
  /**
   * 获取世界书列表
   */
  async list(): Promise<WorldbookInfo[]> {
    if (window.ST_API?.worldbook?.list) {
      return window.ST_API.worldbook.list();
    }

    const result = await stRequest<string[]>('/api/worldinfo/get');
    return result.map((name) => ({
      name,
      entries_count: 0,
      enabled: true,
    }));
  },

  /**
   * 获取世界书详情
   */
  async get(name: string): Promise<WorldbookData | null> {
    if (window.ST_API?.worldbook?.get) {
      return window.ST_API.worldbook.get(name);
    }

    try {
      const result = await stRequest<any>('/api/worldinfo/get', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      return {
        name,
        entries: Object.values(result.entries || {}).map((entry: any, idx) => ({
          id: entry.uid ?? idx,
          keys: entry.key || [],
          secondary_keys: entry.keysecondary || [],
          content: entry.content || '',
          comment: entry.comment || '',
          enabled: !entry.disable,
          position: entry.position || 0,
          depth: entry.depth,
          order: entry.order,
          probability: entry.probability,
        })),
      };
    } catch (e) {
      console.error('[ST Manager] 获取世界书失败:', e);
      return null;
    }
  },

  /**
   * 更新世界书条目
   */
  async updateEntry(
    wbName: string,
    entryId: number,
    data: Partial<WorldbookEntry>
  ): Promise<boolean> {
    if (window.ST_API?.worldbook?.updateEntry) {
      return window.ST_API.worldbook.updateEntry(wbName, entryId, data);
    }

    try {
      await stRequest('/api/worldinfo/edit', {
        method: 'POST',
        body: JSON.stringify({
          name: wbName,
          uid: entryId,
          ...data,
        }),
      });
      return true;
    } catch (e) {
      console.error('[ST Manager] 更新世界书条目失败:', e);
      return false;
    }
  },

  /**
   * 创建世界书条目
   */
  async createEntry(wbName: string, data: WorldbookEntry): Promise<number | null> {
    if (window.ST_API?.worldbook?.createEntry) {
      return window.ST_API.worldbook.createEntry(wbName, data);
    }

    try {
      const result = await stRequest<{ uid: number }>('/api/worldinfo/create-entry', {
        method: 'POST',
        body: JSON.stringify({
          name: wbName,
          ...data,
        }),
      });
      return result.uid;
    } catch (e) {
      console.error('[ST Manager] 创建世界书条目失败:', e);
      return null;
    }
  },

  /**
   * 删除世界书条目
   */
  async deleteEntry(wbName: string, entryId: number): Promise<boolean> {
    if (window.ST_API?.worldbook?.deleteEntry) {
      return window.ST_API.worldbook.deleteEntry(wbName, entryId);
    }

    try {
      await stRequest('/api/worldinfo/delete-entry', {
        method: 'POST',
        body: JSON.stringify({
          name: wbName,
          uid: entryId,
        }),
      });
      return true;
    } catch (e) {
      console.error('[ST Manager] 删除世界书条目失败:', e);
      return false;
    }
  },
};

// ============ 预设 API ============

export const presetApi = {
  /**
   * 获取预设列表
   */
  async list(): Promise<PresetInfo[]> {
    if (window.ST_API?.preset?.list) {
      return window.ST_API.preset.list();
    }

    const result = await stRequest<any>('/api/presets/get');
    return Object.entries(result).map(([api, presets]: [string, any]) =>
      (Array.isArray(presets) ? presets : []).map((name: string) => ({
        name,
        api,
      }))
    ).flat();
  },

  /**
   * 获取预设详情
   */
  async get(name: string, api: string = 'openai'): Promise<PresetData | null> {
    if (window.ST_API?.preset?.get) {
      return window.ST_API.preset.get(name);
    }

    try {
      const result = await stRequest<any>('/api/presets/get', {
        method: 'POST',
        body: JSON.stringify({ name, api }),
      });
      return {
        name,
        api,
        prompts: result.prompts || [],
        settings: result,
      };
    } catch (e) {
      console.error('[ST Manager] 获取预设失败:', e);
      return null;
    }
  },

  /**
   * 更新预设
   */
  async update(name: string, data: Partial<PresetData>): Promise<boolean> {
    if (window.ST_API?.preset?.update) {
      return window.ST_API.preset.update(name, data);
    }

    try {
      await stRequest('/api/presets/save', {
        method: 'POST',
        body: JSON.stringify({
          name,
          ...data,
        }),
      });
      return true;
    } catch (e) {
      console.error('[ST Manager] 更新预设失败:', e);
      return false;
    }
  },
};

// ============ 正则脚本 API ============

export const regexApi = {
  /**
   * 获取正则脚本列表
   */
  async list(): Promise<RegexScriptInfo[]> {
    if (window.ST_API?.regexScript?.list) {
      return window.ST_API.regexScript.list();
    }

    const result = await stRequest<any[]>('/api/regex/get');
    return result.map((script: any) => ({
      id: script.id || script.scriptName,
      scriptName: script.scriptName,
      enabled: !script.disabled,
    }));
  },

  /**
   * 获取正则脚本详情
   */
  async get(id: string): Promise<RegexScriptData | null> {
    if (window.ST_API?.regexScript?.get) {
      return window.ST_API.regexScript.get(id);
    }

    try {
      const result = await stRequest<any>('/api/regex/get', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      return {
        id: result.id || result.scriptName,
        scriptName: result.scriptName,
        enabled: !result.disabled,
        findRegex: result.findRegex,
        replaceString: result.replaceString,
        placement: result.placement || [],
        flags: result.flags || [],
      };
    } catch (e) {
      console.error('[ST Manager] 获取正则脚本失败:', e);
      return null;
    }
  },

  /**
   * 更新正则脚本
   */
  async update(id: string, data: Partial<RegexScriptData>): Promise<boolean> {
    if (window.ST_API?.regexScript?.update) {
      return window.ST_API.regexScript.update(id, data);
    }

    try {
      await stRequest('/api/regex/save', {
        method: 'POST',
        body: JSON.stringify({
          id,
          ...data,
        }),
      });
      return true;
    } catch (e) {
      console.error('[ST Manager] 更新正则脚本失败:', e);
      return false;
    }
  },

  /**
   * 删除正则脚本
   */
  async delete(id: string): Promise<boolean> {
    if (window.ST_API?.regexScript?.delete) {
      return window.ST_API.regexScript.delete(id);
    }

    try {
      await stRequest('/api/regex/delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      return true;
    } catch (e) {
      console.error('[ST Manager] 删除正则脚本失败:', e);
      return false;
    }
  },
};

// 导出统一的 API 对象
export const stApi = {
  character: characterApi,
  worldbook: worldbookApi,
  preset: presetApi,
  regex: regexApi,
  getContext,
  getHeaders,
};

export default stApi;
