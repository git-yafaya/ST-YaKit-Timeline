import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAvailableModels, parseModelIds } from '@/ui/model-provider';
import type { AiSettings } from '@/ui/pages/settings';
import { DEFAULT_SETTINGS } from '@/ui/settings-store';

function installContext(context: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'SillyTavern', {
    configurable: true,
    value: { getContext: () => context },
    writable: true,
  });
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function independentSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    ...DEFAULT_SETTINGS.ai,
    provider: 'independent',
    apiUrl: 'https://api.example.test/v1',
    apiKey: 'example-key',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.SillyTavern = undefined;
});

describe('model provider', () => {
  it('normalizes, deduplicates, and sorts model identifiers', () => {
    expect(parseModelIds({
      data: [{ id: 'model-z' }, { name: 'model-a' }, 'model-z', { id: '' }, null],
    })).toEqual(['model-a', 'model-z']);

    expect(parseModelIds({ data: { data: [{ id: 'nested-model' }] } })).toEqual(['nested-model']);
  });

  it('loads the current chat-completion model list through SillyTavern', async () => {
    installContext({
      mainApi: 'openai',
      getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'token' }),
      chatCompletionSettings: {
        chat_completion_source: 'custom',
        custom_url: 'https://main.example.test/v1',
        custom_include_headers: '',
        unrelated_setting: 'not-sent',
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [{ id: 'main-model' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAvailableModels(DEFAULT_SETTINGS.ai)).resolves.toEqual(['main-model']);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/backends/chat-completions/status');
    expect(JSON.parse(String(request.body))).toEqual({
      chat_completion_source: 'custom',
      custom_url: 'https://main.example.test/v1',
      custom_include_headers: '',
    });
  });

  it('loads text-completion models from the current configured server', async () => {
    installContext({
      mainApi: 'textgenerationwebui',
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      textCompletionSettings: {
        type: 'generic',
        server_urls: { generic: 'http://127.0.0.1:5000' },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [{ id: 'text-model' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAvailableModels(DEFAULT_SETTINGS.ai)).resolves.toEqual(['text-model']);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/backends/text-completions/status');
    expect(JSON.parse(String(request.body))).toEqual({
      api_server: 'http://127.0.0.1:5000',
      api_type: 'generic',
    });
  });

  it('loads independent API models through the SillyTavern backend proxy', async () => {
    installContext({
      mainApi: 'openai',
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    });
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [{ id: 'backup-model' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAvailableModels(independentSettings())).resolves.toEqual(['backup-model']);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/backends/chat-completions/status');
    expect(JSON.parse(String(request.body))).toEqual({
      chat_completion_source: 'openai',
      reverse_proxy: 'https://api.example.test/v1',
      proxy_password: 'example-key',
    });
  });

  it('rejects an independent model request before fetch when its URL is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAvailableModels(independentSettings({ apiUrl: '  ' })))
      .rejects.toThrow('请先填写副 API URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an empty model response as a failure', async () => {
    installContext({
      mainApi: 'openai',
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      chatCompletionSettings: { chat_completion_source: 'openai' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: [] })));

    await expect(fetchAvailableModels(DEFAULT_SETTINGS.ai)).rejects.toThrow('接口未返回可用模型');
  });
});
