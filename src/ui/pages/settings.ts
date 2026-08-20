export type ApiProvider = 'sillytavern' | 'independent';
export type AiSaveStatus = 'idle' | 'saved' | 'error';
export type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error';
export type SettingsCategory = 'general' | 'analysis' | 'prompts' | 'automation' | 'data';
export type ThemeMode = 'follow' | 'light' | 'dark';
export type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface AiSettings {
  apiKey: string;
  apiUrl: string;
  jailbreakPrompt: string;
  maxOutputTokens: number;
  model: string;
  provider: ApiProvider;
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
