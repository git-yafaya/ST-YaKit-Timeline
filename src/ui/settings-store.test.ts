import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGeneralSettings, saveGeneralSettings } from '@/ui/settings-store';

afterEach(() => {
  globalThis.SillyTavern = undefined;
});

describe('general settings persistence', () => {
  it('loads the stored theme preference without creating a third resolved theme', () => {
    globalThis.SillyTavern = {
      getContext: () => ({
        extensionSettings: {
          st_yafaya_timeline: {
            globalSettings: { theme: 'follow', switchToastEnabled: false },
          },
        },
        saveSettingsDebounced: vi.fn(),
      }),
    };

    expect(loadGeneralSettings({ theme: 'dark', showSwitchNotifications: true })).toEqual({
      theme: 'follow',
      showSwitchNotifications: false,
    });
  });

  it('writes manual theme choices through SillyTavern extension settings', () => {
    const extensionSettings: Record<string, unknown> = {};
    const saveSettingsDebounced = vi.fn();
    globalThis.SillyTavern = {
      getContext: () => ({ extensionSettings, saveSettingsDebounced }),
    };

    saveGeneralSettings({ theme: 'light', showSwitchNotifications: true });

    expect(extensionSettings).toEqual({
      st_yafaya_timeline: {
        globalSettings: { theme: 'light', switchToastEnabled: true },
      },
    });
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
  });
});
