import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setSharedSecondarySecretLoaderForTests,
  getSharedSecondaryConnection,
  getSharedSecondaryRequestConfig,
  listSharedSecondaryConnections,
  normalizeOpenAiCompatibleUrl,
  saveSharedSecondaryConnection,
  setActiveSharedSecondaryConnection,
} from '@/ui/shared-secondary-api';

const SHARED_NAMESPACE = 'yakit-shared-secondary-api';

function installSillyTavern(extensionSettings: Record<string, unknown> = {}) {
  const saveSettingsDebounced = vi.fn();
  Object.defineProperty(globalThis, 'SillyTavern', {
    configurable: true,
    value: {
      getContext: () => ({ extensionSettings, saveSettingsDebounced }),
    },
    writable: true,
  });
  return { extensionSettings, saveSettingsDebounced };
}

afterEach(() => {
  __setSharedSecondarySecretLoaderForTests(null);
  Object.defineProperty(globalThis, 'SillyTavern', {
    configurable: true,
    value: undefined,
    writable: true,
  });
});

describe('shared secondary API', () => {
  it('直接识别 YaKit-纪实写入的 v3 共享连接与活动连接', () => {
    const { saveSettingsDebounced } = installSillyTavern({
      [SHARED_NAMESPACE]: {
        version: 3,
        activeConnectionId: 'chat-secondary',
        connections: [
          {
            id: 'timeline-secondary',
            name: '理脉连接',
            apiUrl: 'https://timeline.example/v1',
            model: 'timeline-model',
            secretId: 'timeline-secret',
          },
          {
            id: 'chat-secondary',
            name: '纪实连接',
            apiUrl: 'https://chat.example/v1',
            model: 'chat-model',
            secretId: 'chat-secret',
          },
        ],
      },
    });

    expect(listSharedSecondaryConnections()).toHaveLength(2);
    expect(getSharedSecondaryConnection()).toEqual({
      id: 'chat-secondary',
      name: '纪实连接',
      apiUrl: 'https://chat.example/v1',
      model: 'chat-model',
      secretId: 'chat-secret',
    });
    expect(getSharedSecondaryConnection('timeline-secondary')?.name).toBe('理脉连接');
    expect(saveSettingsDebounced).not.toHaveBeenCalled();
  });

  it('规范化 v3 存储并清除普通设置中的明文 Key', () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      [SHARED_NAMESPACE]: {
        version: 2,
        activeConnectionId: 'missing',
        connections: [{
          id: ' shared-id ',
          name: ' 共享连接 ',
          apiUrl: ' https://api.example/chat/completions/ ',
          model: ' model-a ',
          secretId: ' secret-a ',
          apiKey: 'must-not-remain',
        }],
      },
    });

    expect(listSharedSecondaryConnections()).toEqual([{
      id: 'shared-id',
      name: '共享连接',
      apiUrl: 'https://api.example',
      model: 'model-a',
      secretId: 'secret-a',
    }]);
    expect(extensionSettings[SHARED_NAMESPACE]).toEqual({
      version: 3,
      activeConnectionId: 'shared-id',
      connections: [{
        id: 'shared-id',
        name: '共享连接',
        apiUrl: 'https://api.example',
        model: 'model-a',
        secretId: 'secret-a',
      }],
    });
    expect(JSON.stringify(extensionSettings)).not.toContain('must-not-remain');
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
  });

  it('切换活动连接会触发宿主保存并拒绝未知 ID', () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      [SHARED_NAMESPACE]: {
        version: 3,
        activeConnectionId: 'one',
        connections: [
          { id: 'one', name: '一', apiUrl: '', model: '', secretId: '' },
          { id: 'two', name: '二', apiUrl: '', model: '', secretId: '' },
        ],
      },
    });

    expect(setActiveSharedSecondaryConnection('two').id).toBe('two');
    expect((extensionSettings[SHARED_NAMESPACE] as { activeConnectionId: string }).activeConnectionId)
      .toBe('two');
    expect(getSharedSecondaryConnection()?.id).toBe('two');
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
    expect(() => setActiveSharedSecondaryConnection('unknown')).toThrow('找不到共享副 API 连接');
  });

  it('创建连接时将 Key 写入 Secrets、恢复旧活动项且普通设置无明文', async () => {
    const { extensionSettings, saveSettingsDebounced } = installSillyTavern({
      [SHARED_NAMESPACE]: {
        version: 3,
        activeConnectionId: 'old-connection',
        connections: [{
          id: 'old-connection',
          name: '旧连接',
          apiUrl: 'https://old.example/v1',
          model: 'old-model',
          secretId: 'old-connection-secret',
        }],
      },
    });
    const writeSecret = vi.fn().mockResolvedValue('new-secret-id');
    const rotateSecret = vi.fn().mockResolvedValue(undefined);
    __setSharedSecondarySecretLoaderForTests(async () => ({
      SECRET_KEYS: { CUSTOM: 'api_key_custom' },
      secret_state: {
        api_key_custom: [
          { id: 'previous-active-secret', active: true },
          { id: 'another-secret', active: false },
        ],
      },
      writeSecret,
      rotateSecret,
    }));

    const saved = await saveSharedSecondaryConnection({
      name: ' 共享 OpenAI ',
      apiUrl: ' https://api.example.test/ ',
      model: ' model-x ',
      apiKey: '  plaintext-key  ',
    });

    expect(saved).toMatchObject({
      name: '共享 OpenAI',
      apiUrl: 'https://api.example.test/v1',
      model: 'model-x',
      secretId: 'new-secret-id',
    });
    expect(writeSecret).toHaveBeenCalledWith(
      'api_key_custom',
      'plaintext-key',
      'YaKit-理脉 · 共享 OpenAI',
    );
    expect(rotateSecret).toHaveBeenCalledWith('api_key_custom', 'previous-active-secret');
    expect(JSON.stringify(extensionSettings)).not.toContain('plaintext-key');
    expect((extensionSettings[SHARED_NAMESPACE] as { activeConnectionId: string }).activeConnectionId)
      .toBe(saved.id);
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
    expect(getSharedSecondaryRequestConfig(saved.id)).toEqual(saved);
  });

  it('等待 Secrets 写入期间会合并纪实新增的连接而不覆盖它', async () => {
    const { extensionSettings } = installSillyTavern({
      [SHARED_NAMESPACE]: {
        version: 3,
        activeConnectionId: 'base',
        connections: [{ id: 'base', name: '基础', apiUrl: '', model: '', secretId: '' }],
      },
    });
    let resolveWrite: ((secretId: string) => void) | undefined;
    const writeSecret = vi.fn(() => new Promise<string>(resolve => {
      resolveWrite = resolve;
    }));
    __setSharedSecondarySecretLoaderForTests(async () => ({
      SECRET_KEYS: { CUSTOM: 'api_key_custom' },
      secret_state: { api_key_custom: [] },
      writeSecret,
      rotateSecret: vi.fn(),
    }));

    const saving = saveSharedSecondaryConnection({
      id: 'base',
      name: '理脉编辑',
      apiUrl: 'https://timeline.example/v1',
      model: 'timeline-model',
      apiKey: 'plaintext-key',
    });
    await vi.waitFor(() => expect(writeSecret).toHaveBeenCalledOnce());
    (extensionSettings[SHARED_NAMESPACE] as {
      activeConnectionId: string;
      connections: Array<Record<string, string>>;
    }).connections.push({
      id: 'chat-added',
      name: '纪实新增',
      apiUrl: 'https://chat.example/v1',
      model: 'chat-model',
      secretId: 'chat-secret',
    });
    resolveWrite?.('timeline-secret');
    await saving;

    expect(listSharedSecondaryConnections()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'base', name: '理脉编辑', secretId: 'timeline-secret' }),
      expect.objectContaining({ id: 'chat-added', name: '纪实新增', secretId: 'chat-secret' }),
    ]));
    expect(JSON.stringify(extensionSettings)).not.toContain('plaintext-key');
  });

  it('更新连接且 Key 留空时保留原 Secret 并设为活动连接', async () => {
    const { saveSettingsDebounced } = installSillyTavern({
      [SHARED_NAMESPACE]: {
        version: 3,
        activeConnectionId: 'other',
        connections: [
          { id: 'other', name: '其他', apiUrl: '', model: '', secretId: '' },
          {
            id: 'target',
            name: '目标',
            apiUrl: 'https://target.example/v1',
            model: 'old-model',
            secretId: 'keep-secret',
          },
        ],
      },
    });

    const saved = await saveSharedSecondaryConnection({
      id: 'target',
      model: 'new-model',
      apiKey: '   ',
    });

    expect(saved).toEqual({
      id: 'target',
      name: '目标',
      apiUrl: 'https://target.example/v1',
      model: 'new-model',
      secretId: 'keep-secret',
    });
    expect(getSharedSecondaryConnection()?.id).toBe('target');
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
  });

  it('恢复旧 Custom Secret 失败时仍保留已安全写入的共享连接', async () => {
    const { extensionSettings } = installSillyTavern();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    __setSharedSecondarySecretLoaderForTests(async () => ({
      SECRET_KEYS: { CUSTOM: 'api_key_custom' },
      secret_state: { api_key_custom: [{ id: 'previous-secret', active: true }] },
      writeSecret: vi.fn().mockResolvedValue('saved-secret'),
      rotateSecret: vi.fn().mockRejectedValue(new Error('rotate failed')),
    }));

    await expect(saveSharedSecondaryConnection({
      name: '可用连接',
      apiUrl: 'https://api.example.test/v1',
      model: 'model-z',
      apiKey: 'plaintext-key',
    })).resolves.toMatchObject({ secretId: 'saved-secret' });
    expect(JSON.stringify(extensionSettings)).not.toContain('plaintext-key');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('生成与 ST 自定义后端兼容的请求配置并规范化 URL', () => {
    installSillyTavern({
      [SHARED_NAMESPACE]: {
        version: 3,
        activeConnectionId: 'active',
        connections: [{
          id: 'active',
          name: '活动连接',
          apiUrl: 'https://api.example.test/v1',
          model: 'model-y',
          secretId: 'secret-y',
        }],
      },
    });

    expect(normalizeOpenAiCompatibleUrl(' https://root.example/ ')).toBe('https://root.example/v1');
    expect(normalizeOpenAiCompatibleUrl('https://root.example/v1/chat/completions')).toBe('https://root.example/v1');
    expect(getSharedSecondaryRequestConfig()).toEqual({
      id: 'active',
      name: '活动连接',
      apiUrl: 'https://api.example.test/v1',
      model: 'model-y',
      secretId: 'secret-y',
    });
    expect(getSharedSecondaryRequestConfig('missing')).toBeNull();
  });

  it('宿主上下文缺失时给出清晰错误且不尝试保存', async () => {
    expect(() => listSharedSecondaryConnections()).toThrow('无法读取 SillyTavern 上下文');
    expect(() => getSharedSecondaryConnection()).toThrow('无法读取 SillyTavern 上下文');
    await expect(saveSharedSecondaryConnection({ name: '无宿主' }))
      .rejects.toThrow('无法读取 SillyTavern 上下文');
  });
});
