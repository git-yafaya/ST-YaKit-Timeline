export type ApiProvider = 'sillytavern' | 'independent';
export type AiSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error';
export type SettingsCategory = 'general' | 'analysis' | 'prompts' | 'automation' | 'data';
export type ThemeMode = 'follow' | 'light' | 'dark';
export type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'updating' | 'updated' | 'error';

export interface AiSettings {
  /** 仅用于本次写入，保存后清空；正式配置只保留 SillyTavern Secret ID。 */
  apiKey: string;
  apiKeyConfigured: boolean;
  apiUrl: string;
  fixedPrompt: string;
  jailbreakPrompt: string;
  maxOutputTokens: number;
  model: string;
  primaryModel: string;
  provider: ApiProvider;
  secondaryConnectionId: string;
  secondaryConnectionName: string;
  secretId: string;
  temperature: number;
  timeoutSeconds: number;
}

export interface GeneralSettings {
  showSwitchNotifications: boolean;
  theme: ThemeMode;
}

export interface AutomationSettings {
  largeJumpNoticeDays: number;
}

export interface SettingsSnapshot {
  ai: AiSettings;
  automation: AutomationSettings;
  general: GeneralSettings;
}

export interface ModelCatalog {
  message: string;
  models: readonly string[];
  status: ModelLoadStatus;
}

export type ModelCatalogs = Record<ApiProvider, ModelCatalog>;

export interface ConnectionState {
  message: string;
  status: ConnectionStatus;
}

export type ConnectionStates = Record<ApiProvider, ConnectionState>;
