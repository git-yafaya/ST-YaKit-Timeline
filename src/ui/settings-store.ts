import type {
  AiSettings,
  ApiProvider,
  AutomationSettings,
  GeneralSettings,
  SettingsSnapshot,
  ThemeMode,
} from '@/ui/pages/settings';
import { SETTINGS_NAMESPACE } from '@/branding';
const ALLOWED_JUMP_NOTICE_DAYS = new Set([5, 10, 15, 20, 25, 30]);

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  general: { theme: 'follow', showSwitchNotifications: true },
  ai: {
    provider: 'sillytavern',
    apiUrl: '',
    apiKey: '',
    customPrompt: '',
    jailbreakPrompt: '',
    model: '',
    temperature: 0.9,
    maxOutputTokens: 23333,
    timeoutSeconds: 180,
  },
  automation: { largeJumpNoticeDays: 5 },
};

interface TimelineSettingsRecord extends Record<string, unknown> {
  globalSettings?: TimelineGlobalSettingsRecord;
}

interface TimelineGlobalSettingsRecord extends Record<string, unknown> {
  ai?: TimelineAiSettingsRecord;
  largeJumpDays?: unknown;
  switchToastEnabled?: unknown;
  theme?: unknown;
}

interface TimelineAiSettingsRecord extends Record<string, unknown> {
  customPrompt?: unknown;
  jailbreakPrompt?: unknown;
  mode?: unknown;
  openaiCompatible?: OpenAiCompatibleSettingsRecord;
}

interface OpenAiCompatibleSettingsRecord extends Record<string, unknown> {
  apiKey?: unknown;
  baseUrl?: unknown;
  maxTokens?: unknown;
  model?: unknown;
  temperature?: unknown;
  timeoutSec?: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'follow' || value === 'light' || value === 'dark';
}

function isApiProvider(value: unknown): value is ApiProvider {
  return value === 'sillytavern' || value === 'independent';
}

function storedString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function storedNumber(
  value: unknown,
  fallback: number,
  isValid: (candidate: number) => boolean,
  round = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !isValid(value)) return fallback;
  return round ? Math.round(value) : value;
}

function normalizeJumpNoticeDays(value: unknown, fallback = 5): number {
  return typeof value === 'number' && ALLOWED_JUMP_NOTICE_DAYS.has(value)
    ? value
    : ALLOWED_JUMP_NOTICE_DAYS.has(fallback) ? fallback : 5;
}

function getContext(): SillyTavernContext | null {
  try {
    return globalThis.SillyTavern?.getContext() ?? null;
  } catch {
    return null;
  }
}

function getStoredGlobalSettings(context: SillyTavernContext | null): TimelineGlobalSettingsRecord | undefined {
  const namespace = getStoredNamespace(context);
  if (!isRecord(namespace) || !isRecord(namespace.globalSettings)) return undefined;
  return namespace.globalSettings as TimelineGlobalSettingsRecord;
}

function getStoredNamespace(context: SillyTavernContext | null): TimelineSettingsRecord | undefined {
  const current = context?.extensionSettings[SETTINGS_NAMESPACE];
  return isRecord(current) ? current as TimelineSettingsRecord : undefined;
}

function updateGlobalSettings(
  update: (globalSettings: TimelineGlobalSettingsRecord) => TimelineGlobalSettingsRecord,
): boolean {
  const context = getContext();
  if (!context) return false;

  const previousNamespace = context.extensionSettings[SETTINGS_NAMESPACE];
  try {
    const namespace: TimelineSettingsRecord = isRecord(previousNamespace)
      ? { ...previousNamespace }
      : {};
    const currentGlobalSettings = isRecord(namespace.globalSettings)
      ? namespace.globalSettings as TimelineGlobalSettingsRecord
      : {};

    namespace.globalSettings = update(currentGlobalSettings);
    context.extensionSettings[SETTINGS_NAMESPACE] = namespace;
    context.saveSettingsDebounced();
    return true;
  } catch {
    if (previousNamespace === undefined) delete context.extensionSettings[SETTINGS_NAMESPACE];
    else context.extensionSettings[SETTINGS_NAMESPACE] = previousNamespace;
    return false;
  }
}

export function loadSettings(fallback: SettingsSnapshot): SettingsSnapshot {
  const globalSettings = getStoredGlobalSettings(getContext());
  const storedAi = isRecord(globalSettings?.ai)
    ? globalSettings.ai as TimelineAiSettingsRecord
    : undefined;
  const openAiCompatible = isRecord(storedAi?.openaiCompatible)
    ? storedAi.openaiCompatible as OpenAiCompatibleSettingsRecord
    : undefined;

  return {
    general: {
      theme: isThemeMode(globalSettings?.theme) ? globalSettings.theme : fallback.general.theme,
      showSwitchNotifications: typeof globalSettings?.switchToastEnabled === 'boolean'
        ? globalSettings.switchToastEnabled
        : fallback.general.showSwitchNotifications,
    },
    ai: {
      provider: isApiProvider(storedAi?.mode) ? storedAi.mode : fallback.ai.provider,
      apiUrl: storedString(openAiCompatible?.baseUrl, fallback.ai.apiUrl),
      apiKey: storedString(openAiCompatible?.apiKey, fallback.ai.apiKey),
      customPrompt: storedString(storedAi?.customPrompt, fallback.ai.customPrompt),
      jailbreakPrompt: storedString(storedAi?.jailbreakPrompt, fallback.ai.jailbreakPrompt),
      model: storedString(openAiCompatible?.model, fallback.ai.model),
      temperature: storedNumber(
        openAiCompatible?.temperature,
        fallback.ai.temperature,
        value => value >= 0 && value <= 2,
      ),
      maxOutputTokens: storedNumber(
        openAiCompatible?.maxTokens,
        fallback.ai.maxOutputTokens,
        value => value >= 1,
        true,
      ),
      timeoutSeconds: storedNumber(
        openAiCompatible?.timeoutSec,
        fallback.ai.timeoutSeconds,
        value => value >= 1,
        true,
      ),
    },
    automation: {
      largeJumpNoticeDays: normalizeJumpNoticeDays(
        globalSettings?.largeJumpDays,
        fallback.automation.largeJumpNoticeDays,
      ),
    },
  };
}

export function loadGeneralSettings(fallback: GeneralSettings): GeneralSettings {
  const globalSettings = getStoredGlobalSettings(getContext());
  return {
    theme: isThemeMode(globalSettings?.theme) ? globalSettings.theme : fallback.theme,
    showSwitchNotifications: typeof globalSettings?.switchToastEnabled === 'boolean'
      ? globalSettings.switchToastEnabled
      : fallback.showSwitchNotifications,
  };
}

export function saveGeneralSettings(settings: GeneralSettings): boolean {
  return updateGlobalSettings(globalSettings => ({
    ...globalSettings,
    theme: settings.theme,
    switchToastEnabled: settings.showSwitchNotifications,
  }));
}

export function saveAiSettings(settings: AiSettings): boolean {
  const normalizedSettings: AiSettings = {
    provider: isApiProvider(settings.provider) ? settings.provider : DEFAULT_SETTINGS.ai.provider,
    apiUrl: storedString(settings.apiUrl, DEFAULT_SETTINGS.ai.apiUrl),
    apiKey: storedString(settings.apiKey, DEFAULT_SETTINGS.ai.apiKey),
    customPrompt: storedString(settings.customPrompt, DEFAULT_SETTINGS.ai.customPrompt),
    jailbreakPrompt: storedString(settings.jailbreakPrompt, DEFAULT_SETTINGS.ai.jailbreakPrompt),
    model: storedString(settings.model, DEFAULT_SETTINGS.ai.model),
    temperature: storedNumber(
      settings.temperature,
      DEFAULT_SETTINGS.ai.temperature,
      value => value >= 0 && value <= 2,
    ),
    maxOutputTokens: storedNumber(
      settings.maxOutputTokens,
      DEFAULT_SETTINGS.ai.maxOutputTokens,
      value => value >= 1,
      true,
    ),
    timeoutSeconds: storedNumber(
      settings.timeoutSeconds,
      DEFAULT_SETTINGS.ai.timeoutSeconds,
      value => value >= 1,
      true,
    ),
  };

  return updateGlobalSettings(globalSettings => {
    const currentAi = isRecord(globalSettings.ai)
      ? globalSettings.ai as TimelineAiSettingsRecord
      : {};
    const currentOpenAiCompatible = isRecord(currentAi.openaiCompatible)
      ? currentAi.openaiCompatible as OpenAiCompatibleSettingsRecord
      : {};

    return {
      ...globalSettings,
      ai: {
        ...currentAi,
        mode: normalizedSettings.provider,
        customPrompt: normalizedSettings.customPrompt,
        jailbreakPrompt: normalizedSettings.jailbreakPrompt,
        openaiCompatible: {
          ...currentOpenAiCompatible,
          baseUrl: normalizedSettings.apiUrl,
          apiKey: normalizedSettings.apiKey,
          model: normalizedSettings.model,
          temperature: normalizedSettings.temperature,
          maxTokens: normalizedSettings.maxOutputTokens,
          timeoutSec: normalizedSettings.timeoutSeconds,
        },
      },
    };
  });
}

export function saveAutomationSettings(settings: AutomationSettings): boolean {
  return updateGlobalSettings(globalSettings => ({
    ...globalSettings,
    largeJumpDays: normalizeJumpNoticeDays(settings.largeJumpNoticeDays),
  }));
}
