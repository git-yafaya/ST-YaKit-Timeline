export type ApiProvider = 'sillytavern' | 'independent';
export type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error';
export type SettingsCategory = 'general' | 'analysis' | 'automation' | 'data';
export type ThemeMode = 'follow' | 'light' | 'dark';

export interface AiSettings {
  apiKey: string;
  apiUrl: string;
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
