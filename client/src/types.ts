export {};

// 酒馆全局对象类型声明
declare global {
  interface Window {
    SillyTavern: {
      getContext: () => STContext;
    };
    ST_API?: STAPI;
    toastr: ToastrInstance;
    STManagerPlugin?: STManagerPluginInstance;
  }

  const SillyTavern: Window['SillyTavern'];
  const toastr: ToastrInstance;
}

// 酒馆上下文
export interface STContext {
  eventSource: any;
  event_types: Record<string, string>;
  getRequestHeaders: () => Record<string, string>;
  characters: any[];
  chat: any[];
  name1: string;
  name2: string;
  characterId: number;
  groupId: string | null;
}

// ST API 接口
export interface STAPI {
  version: string;
  character: CharacterAPI;
  worldbook: WorldbookAPI;
  preset: PresetAPI;
  regexScript: RegexScriptAPI;
  ui: UIAPI;
  hooks: HooksAPI;
  file: FileAPI;
}

// 角色卡 API
export interface CharacterAPI {
  list: () => Promise<CharacterInfo[]>;
  get: (id: string) => Promise<CharacterData | null>;
  update: (id: string, data: Partial<CharacterData>) => Promise<boolean>;
  delete: (id: string) => Promise<boolean>;
  create: (data: CharacterData) => Promise<string>;
  exportPng: (id: string) => Promise<Blob>;
}

// 世界书 API
export interface WorldbookAPI {
  list: () => Promise<WorldbookInfo[]>;
  get: (name: string) => Promise<WorldbookData | null>;
  updateEntry: (wbName: string, entryId: number, data: Partial<WorldbookEntry>) => Promise<boolean>;
  createEntry: (wbName: string, data: WorldbookEntry) => Promise<number>;
  deleteEntry: (wbName: string, entryId: number) => Promise<boolean>;
}

// 预设 API
export interface PresetAPI {
  list: () => Promise<PresetInfo[]>;
  get: (name: string) => Promise<PresetData | null>;
  update: (name: string, data: Partial<PresetData>) => Promise<boolean>;
}

// 正则脚本 API
export interface RegexScriptAPI {
  list: () => Promise<RegexScriptInfo[]>;
  get: (id: string) => Promise<RegexScriptData | null>;
  update: (id: string, data: Partial<RegexScriptData>) => Promise<boolean>;
  delete: (id: string) => Promise<boolean>;
}

// UI API
export interface UIAPI {
  registerSettingsPanel: (options: SettingsPanelOptions) => Promise<void>;
  showModal: (options: ModalOptions) => Promise<any>;
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

// Hooks API
export interface HooksAPI {
  on: (event: string, callback: (...args: any[]) => void) => void;
  off: (event: string, callback: (...args: any[]) => void) => void;
}

// 文件 API
export interface FileAPI {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<boolean>;
  exists: (path: string) => Promise<boolean>;
  list: (dir: string) => Promise<string[]>;
}

// 设置面板选项
export interface SettingsPanelOptions {
  id: string;
  title: string;
  target: 'extensions_settings' | 'settings';
  expanded?: boolean;
  order?: number;
  content: {
    kind: 'html' | 'render';
    html?: string;
    render?: (container: HTMLElement) => (() => void) | void;
  };
}

// 模态框选项
export interface ModalOptions {
  title: string;
  content: string | HTMLElement;
  buttons?: { label: string; action: () => void; primary?: boolean }[];
  width?: string;
  height?: string;
}

// Toastr 实例
export interface ToastrInstance {
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

// 数据类型
export interface CharacterInfo {
  id: string;
  name: string;
  avatar: string;
  description?: string;
  creator?: string;
  tags?: string[];
}

export interface CharacterData extends CharacterInfo {
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  creator_notes?: string;
  character_book?: WorldbookData;
}

export interface WorldbookInfo {
  name: string;
  entries_count: number;
  enabled: boolean;
}

export interface WorldbookData {
  name: string;
  entries: WorldbookEntry[];
}

export interface WorldbookEntry {
  id: number;
  keys: string[];
  secondary_keys?: string[];
  content: string;
  comment?: string;
  enabled: boolean;
  position: number;
  depth?: number;
  order?: number;
  probability?: number;
}

export interface PresetInfo {
  name: string;
  api: string;
}

export interface PresetData extends PresetInfo {
  prompts: any[];
  settings: Record<string, any>;
}

export interface RegexScriptInfo {
  id: string;
  scriptName: string;
  enabled: boolean;
}

export interface RegexScriptData extends RegexScriptInfo {
  findRegex: string;
  replaceString: string;
  placement: number[];
  flags: string[];
}

// 插件实例
export interface STManagerPluginInstance {
  version: string;
  backendUrl: string;
  isConnected: boolean;
  connect: () => Promise<boolean>;
  backup: {
    trigger: (options?: BackupOptions) => Promise<BackupResult>;
    list: () => Promise<BackupInfo[]>;
    restore: (backupId: string) => Promise<boolean>;
    getSchedule: () => Promise<BackupSchedule>;
    setSchedule: (schedule: BackupSchedule) => Promise<boolean>;
  };
}

// 备份相关类型
export interface BackupOptions {
  resources?: string[];
  path?: string;
  incremental?: boolean;
}

export interface BackupResult {
  success: boolean;
  backupId: string;
  path: string;
  timestamp: string;
  fileCount: number;
  sizeMb: number;
}

export interface BackupInfo {
  id: string;
  timestamp: string;
  path: string;
  resources: string[];
  fileCount: number;
  sizeMb: number;
}

export interface BackupSchedule {
  enabled: boolean;
  type: 'disabled' | 'daily' | 'weekly' | 'manual';
  hour?: number;
  dayOfWeek?: number;
  retentionDays?: number;
}
