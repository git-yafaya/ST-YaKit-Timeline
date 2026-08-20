import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsSnapshot } from '@/ui/pages/settings';
import {
  DEFAULT_SETTINGS,
  loadGeneralSettings,
  loadSettings,
  saveAiSettings,
  saveAutomationSettings,
  saveGeneralSettings,
} from '@/ui/settings-store';

function installSillyTavern(extensionSettings: Record<string, unknown> = {}) {
  const saveSettingsDebounced = vi.fn();
  globalThis.SillyTavern = {
    getContext: () => ({ extensionSettings, saveSettingsDebounced }),
  };
  return { extensionSettings, saveSettingsDebounced };
}

afterEach(() => {
  globalThis.SillyTavern = undefined;
});

describe('settings persistence', () => {
  it('uses the configured AI defaults for new installations', () => {
    expect(DEFAULT_SETTINGS.ai).toMatchObject({
      fixedPrompt: expect.stringContaining('世界书时间线配置分析器'),
      temperature: 0.9,
      maxOutputTokens: 23333,
      timeoutSeconds: 180,
    });
  });

  it('loads all stored setting sections from the SillyTavern namespace', () => {
    installSillyTavern({
      yakit_timeline: {
        globalSettings: {
          theme: 'dark',
          switchToastEnabled: false,
          largeJumpDays: 20,
          ai: {
            mode: 'independent',
            fixedPrompt: 'fixed prompt',
            jailbreakPrompt: 'jailbreak prompt',
            openaiCompatible: {
              baseUrl: 'https://api.example.test/v1',
              apiKey: 'secret-key',
              model: 'example-model',
              temperature: 0.7,
              maxTokens: 8192,
              timeoutSec: 120,
            },
          },
        },
      },
    });

    expect(loadSettings(DEFAULT_SETTINGS)).toEqual({
      general: { theme: 'dark', showSwitchNotifications: false },
      ai: {
        provider: 'independent',
        apiUrl: 'https://api.example.test/v1',
        apiKey: 'secret-key',
        fixedPrompt: 'fixed prompt',
        jailbreakPrompt: 'jailbreak prompt',
        model: 'example-model',
        temperature: 0.7,
        maxOutputTokens: 8192,
        timeoutSeconds: 120,
      },
      automation: { largeJumpNoticeDays: 20 },
    });
  });

  it('uses defaults when stored values are absent or invalid', () => {
    installSillyTavern({
      yakit_timeline: {
        globalSettings: {
          theme: 'system',
          switchToastEnabled: 'yes',
          largeJumpDays: 365,
          ai: {
            mode: 'unknown',
            fixedPrompt: '   ',
            openaiCompatible: {
              baseUrl: 42,
              apiKey: null,
              model: false,
              temperature: 3,
              maxTokens: 0,
              timeoutSec: Number.NaN,
            },
          },
        },
      },
    });

    expect(loadSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when SillyTavern context is unavailable', () => {
    expect(loadSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the focused general-settings loader compatible', () => {
    installSillyTavern({
      yakit_timeline: {
        globalSettings: { theme: 'follow', switchToastEnabled: false },
      },
    });

    expect(loadGeneralSettings({ theme: 'dark', showSwitchNotifications: true })).toEqual({
      theme: 'follow',
      showSwitchNotifications: false,
    });
  });

  it('saves general settings without replacing other plugin data', () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      yakit_timeline: {
        worldbooks: { bookA: { groups: [] } },
        globalSettings: {
          largeJumpDays: 15,
          ai: { mode: 'sillytavern' },
        },
      },
    });

    saveGeneralSettings({ theme: 'light', showSwitchNotifications: true });

    expect(extensionSettings).toEqual({
      yakit_timeline: {
        worldbooks: { bookA: { groups: [] } },
        globalSettings: {
          largeJumpDays: 15,
          ai: { mode: 'sillytavern' },
          theme: 'light',
          switchToastEnabled: true,
        },
      },
    });
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
  });

  it('saves AI settings while retaining automation, worldbooks, and unknown AI fields', () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      yakit_timeline: {
        worldbooks: { bookA: { groups: [] } },
        globalSettings: {
          theme: 'dark',
          largeJumpDays: 25,
          ai: {
            scanStrategy: 'deep',
            customPrompt: '已废弃的二级提示词',
            openaiCompatible: { organization: 'example-org' },
          },
        },
      },
    });

    const saved = saveAiSettings({
      provider: 'independent',
      apiUrl: 'https://api.example.test/v1',
      apiKey: 'secret-key',
      fixedPrompt: 'fixed prompt',
      jailbreakPrompt: 'jailbreak prompt',
      model: 'example-model',
      temperature: 0.4,
      maxOutputTokens: 6000,
      timeoutSeconds: 90,
    });

    expect(saved).toBe(true);
    expect(extensionSettings).toEqual({
      yakit_timeline: {
        worldbooks: { bookA: { groups: [] } },
        globalSettings: {
          theme: 'dark',
          largeJumpDays: 25,
          ai: {
            scanStrategy: 'deep',
            mode: 'independent',
            fixedPrompt: 'fixed prompt',
            jailbreakPrompt: 'jailbreak prompt',
            openaiCompatible: {
              organization: 'example-org',
              baseUrl: 'https://api.example.test/v1',
              apiKey: 'secret-key',
              model: 'example-model',
              temperature: 0.4,
              maxTokens: 6000,
              timeoutSec: 90,
            },
          },
        },
      },
    });
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
  });

  it('saves an allowed jump threshold without replacing AI settings', () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      yakit_timeline: {
        globalSettings: {
          theme: 'follow',
          ai: { mode: 'independent' },
        },
      },
    });

    saveAutomationSettings({ largeJumpNoticeDays: 30 });

    expect(extensionSettings).toEqual({
      yakit_timeline: {
        globalSettings: {
          theme: 'follow',
          ai: { mode: 'independent' },
          largeJumpDays: 30,
        },
      },
    });
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
  });

  it('normalizes unsupported jump thresholds to five days before saving', () => {
    const { extensionSettings } = installSillyTavern();

    saveAutomationSettings({ largeJumpNoticeDays: 365 });

    const snapshot = loadSettings(DEFAULT_SETTINGS);
    expect(snapshot.automation).toEqual({ largeJumpNoticeDays: 5 });
    expect(extensionSettings).toMatchObject({
      yakit_timeline: { globalSettings: { largeJumpDays: 5 } },
    });
  });

  it('does not mutate the provided fallback snapshot', () => {
    const fallback: SettingsSnapshot = structuredClone(DEFAULT_SETTINGS);
    installSillyTavern({
      yakit_timeline: { globalSettings: { theme: 'light', largeJumpDays: 10 } },
    });

    loadSettings(fallback);

    expect(fallback).toEqual(DEFAULT_SETTINGS);
  });

  it('reports a failed save when SillyTavern context is unavailable', () => {
    expect(saveAiSettings(DEFAULT_SETTINGS.ai)).toBe(false);
  });

  it('reports a failed save when SillyTavern rejects the scheduled write', () => {
    const extensionSettings: Record<string, unknown> = {};
    globalThis.SillyTavern = {
      getContext: () => ({
        extensionSettings,
        saveSettingsDebounced: () => {
          throw new Error('save failed');
        },
      }),
    };

    expect(saveAiSettings(DEFAULT_SETTINGS.ai)).toBe(false);
  });
});
