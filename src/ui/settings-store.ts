import type { GeneralSettings, ThemeMode } from '@/ui/pages/settings';

const SETTINGS_NAMESPACE = 'st_yafaya_timeline';

interface TimelineSettingsRecord {
  globalSettings?: {
    switchToastEnabled?: unknown;
    theme?: unknown;
  };
}

interface SillyTavernContext {
  extensionSettings: Record<string, unknown>;
  saveSettingsDebounced: () => void;
}

interface SillyTavernApi {
  getContext: () => SillyTavernContext;
}

declare global {
  var SillyTavern: SillyTavernApi | undefined;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'follow' || value === 'light' || value === 'dark';
}

function getContext(): SillyTavernContext | null {
  try {
    return globalThis.SillyTavern?.getContext() ?? null;
  } catch {
    return null;
  }
}

export function loadGeneralSettings(fallback: GeneralSettings): GeneralSettings {
  const context = getContext();
  const stored = context?.extensionSettings[SETTINGS_NAMESPACE] as TimelineSettingsRecord | undefined;
  const globalSettings = stored?.globalSettings;
  return {
    theme: isThemeMode(globalSettings?.theme) ? globalSettings.theme : fallback.theme,
    showSwitchNotifications: typeof globalSettings?.switchToastEnabled === 'boolean'
      ? globalSettings.switchToastEnabled
      : fallback.showSwitchNotifications,
  };
}

export function saveGeneralSettings(settings: GeneralSettings): void {
  const context = getContext();
  if (!context) return;

  const current = context.extensionSettings[SETTINGS_NAMESPACE];
  const namespace = current && typeof current === 'object'
    ? current as TimelineSettingsRecord
    : {};
  namespace.globalSettings = {
    ...namespace.globalSettings,
    theme: settings.theme,
    switchToastEnabled: settings.showSwitchNotifications,
  };
  context.extensionSettings[SETTINGS_NAMESPACE] = namespace;
  context.saveSettingsDebounced();
}
