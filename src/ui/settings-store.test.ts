import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsSnapshot } from '@/ui/pages/settings';
import {
  DEFAULT_SETTINGS,
  loadGeneralSettings,
  loadSettings,
  migrateLegacyIndependentApiSettings,
  saveAiSettings,
  saveAutomationSettings,
  saveGeneralSettings,
} from '@/ui/settings-store';
import { __setSharedSecondarySecretLoaderForTests } from '@/ui/shared-secondary-api';

function installSillyTavern(extensionSettings: Record<string, unknown> = {}) {
  const saveSettingsDebounced = vi.fn();
  globalThis.SillyTavern = {
    getContext: () => ({ extensionSettings, saveSettingsDebounced }),
  };
  return { extensionSettings, saveSettingsDebounced };
}

afterEach(() => {
  __setSharedSecondarySecretLoaderForTests(null);
  globalThis.SillyTavern = undefined;
});

describe('settings persistence', () => {
  it('uses the configured AI defaults for new installations', () => {
    expect(DEFAULT_SETTINGS.ai).toMatchObject({
      jailbreakPrompt: expect.stringContaining('明确授权'),
      fixedPrompt: expect.stringContaining('YaKit-理脉'),
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
        apiKeyConfigured: false,
        fixedPrompt: 'fixed prompt',
        jailbreakPrompt: 'jailbreak prompt',
        model: 'example-model',
        primaryModel: '',
        secondaryConnectionId: expect.stringMatching(/^secondary_/),
        secondaryConnectionName: '副 API 1',
        secretId: '',
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

    const loaded = loadSettings(DEFAULT_SETTINGS);
    expect(loaded.ai.secondaryConnectionId).toMatch(/^secondary_/);
    expect({
      ...loaded,
      ai: { ...loaded.ai, secondaryConnectionId: '' },
    }).toEqual(DEFAULT_SETTINGS);
  });

  it('优先读取 YaKit-纪实写入的共享副 API 且不暴露 Secret 内容', () => {
    installSillyTavern({
      yakit_timeline: {
        globalSettings: {
          ai: {
            mode: 'independent',
            secondaryConnectionId: 'shared-chat',
            openaiCompatible: {
              baseUrl: 'https://legacy.example/v1',
              apiKey: 'legacy-plaintext',
              model: 'legacy-model',
            },
          },
        },
      },
      'yakit-shared-secondary-api': {
        version: 3,
        activeConnectionId: 'shared-chat',
        connections: [{
          id: 'shared-chat',
          name: '纪实共享连接',
          apiUrl: 'https://shared.example/v1',
          model: 'shared-model',
          secretId: 'shared-secret-id',
        }],
      },
    });

    expect(loadSettings(DEFAULT_SETTINGS).ai).toMatchObject({
      provider: 'independent',
      apiUrl: 'https://shared.example/v1',
      apiKey: '',
      apiKeyConfigured: true,
      model: 'shared-model',
      secondaryConnectionId: 'shared-chat',
      secondaryConnectionName: '纪实共享连接',
      secretId: 'shared-secret-id',
    });
  });

  it('启动迁移会先把旧理脉明文 Key 写入 Secrets，再从普通设置删除', async () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      yakit_timeline: {
        globalSettings: {
          ai: {
            mode: 'independent',
            openaiCompatible: {
              baseUrl: 'https://legacy.example/v1',
              apiKey: 'legacy-plaintext',
              model: 'legacy-model',
              temperature: 0.6,
              maxTokens: 4096,
              timeoutSec: 90,
            },
          },
        },
      },
    });
    const writeSecret = vi.fn().mockResolvedValue('migrated-secret-id');
    __setSharedSecondarySecretLoaderForTests(async () => ({
      SECRET_KEYS: { CUSTOM: 'api_key_custom' },
      secret_state: { api_key_custom: [] },
      writeSecret,
      rotateSecret: vi.fn(),
    }));

    const migrated = await migrateLegacyIndependentApiSettings(loadSettings(DEFAULT_SETTINGS).ai);

    expect(migrated).toMatchObject({
      apiKey: '',
      apiKeyConfigured: true,
      apiUrl: 'https://legacy.example/v1',
      model: 'legacy-model',
      primaryModel: '',
      secretId: 'migrated-secret-id',
    });
    expect(writeSecret).toHaveBeenCalledWith(
      'api_key_custom',
      'legacy-plaintext',
      expect.stringContaining('YaKit-理脉'),
    );
    expect(JSON.stringify(extensionSettings)).not.toContain('legacy-plaintext');
    expect(extensionSettings).toMatchObject({
      'yakit-shared-secondary-api': {
        version: 3,
        activeConnectionId: migrated.secondaryConnectionId,
        connections: [{
          id: migrated.secondaryConnectionId,
          apiUrl: 'https://legacy.example/v1',
          model: 'legacy-model',
          secretId: 'migrated-secret-id',
        }],
      },
      yakit_timeline: {
        globalSettings: {
          ai: {
            mode: 'independent',
            primaryModel: '',
            secondaryConnectionId: migrated.secondaryConnectionId,
            openaiCompatible: {
              temperature: 0.6,
              maxTokens: 4096,
              timeoutSec: 90,
            },
          },
        },
      },
    });
    expect(saveSettingsDebounced).toHaveBeenCalledTimes(3);
  });

  it('已有纪实共享连接时会把旧理脉配置迁为新连接并清除明文', async () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      yakit_timeline: {
        globalSettings: {
          ai: {
            mode: 'independent',
            secondaryConnectionId: 'chat-shared',
            openaiCompatible: {
              baseUrl: 'https://timeline-legacy.example/v1',
              apiKey: 'timeline-legacy-key',
              model: 'timeline-legacy-model',
            },
          },
        },
      },
      'yakit-shared-secondary-api': {
        version: 3,
        activeConnectionId: 'chat-shared',
        connections: [{
          id: 'chat-shared',
          name: '纪实连接',
          apiUrl: 'https://chat.example/v1',
          model: 'chat-model',
          secretId: 'chat-secret',
        }],
      },
    });
    __setSharedSecondarySecretLoaderForTests(async () => ({
      SECRET_KEYS: { CUSTOM: 'api_key_custom' },
      secret_state: { api_key_custom: [] },
      writeSecret: vi.fn().mockResolvedValue('timeline-secret'),
      rotateSecret: vi.fn(),
    }));

    const loaded = loadSettings(DEFAULT_SETTINGS).ai;
    expect(loaded.apiKey).toBe('');
    const migrated = await migrateLegacyIndependentApiSettings(loaded);

    expect(migrated.secondaryConnectionId).not.toBe('chat-shared');
    expect(migrated).toMatchObject({
      apiUrl: 'https://timeline-legacy.example/v1',
      model: 'timeline-legacy-model',
      secondaryConnectionName: '理脉旧副 API',
      secretId: 'timeline-secret',
    });
    expect(extensionSettings).toMatchObject({
      'yakit-shared-secondary-api': {
        activeConnectionId: migrated.secondaryConnectionId,
        connections: expect.arrayContaining([
          expect.objectContaining({ id: 'chat-shared', secretId: 'chat-secret' }),
          expect.objectContaining({ id: migrated.secondaryConnectionId, secretId: 'timeline-secret' }),
        ]),
      },
    });
    expect(JSON.stringify(extensionSettings)).not.toContain('timeline-legacy-key');
    expect(saveSettingsDebounced).toHaveBeenCalledTimes(2);
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
      ...DEFAULT_SETTINGS.ai,
      provider: 'independent',
      apiUrl: 'https://api.example.test/v1',
      apiKey: 'secret-key',
      apiKeyConfigured: true,
      fixedPrompt: 'fixed prompt',
      jailbreakPrompt: 'jailbreak prompt',
      model: 'example-model',
      primaryModel: 'main-model',
      secondaryConnectionId: 'shared-secondary',
      secondaryConnectionName: '共享副 API',
      secretId: 'shared-secret',
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
            primaryModel: 'main-model',
            secondaryConnectionId: 'shared-secondary',
            fixedPrompt: 'fixed prompt',
            jailbreakPrompt: 'jailbreak prompt',
            openaiCompatible: {
              organization: 'example-org',
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
