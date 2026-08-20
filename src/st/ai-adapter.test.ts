import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAiResponseText, generateTimelineAnalysis, testAiConnection } from '@/st/ai-adapter';
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

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.SillyTavern = undefined;
});

describe('SillyTavern AI adapter', () => {
  it('extracts text from common chat-completion response shapes', () => {
    expect(extractAiResponseText({ choices: [{ message: { content: '{"groups":[]}' } }] }))
      .toBe('{"groups":[]}');
    expect(extractAiResponseText({ candidates: [{ content: { parts: [{ text: 'candidate' }] } }] }))
      .toBe('candidate');
  });

  it('follows the current main API through generateRaw when model is blank', async () => {
    const generateRaw = vi.fn().mockResolvedValue('{"groups":[]}');
    installContext({ mainApi: 'openai', generateRaw });
    await expect(generateTimelineAnalysis(
      DEFAULT_SETTINGS.ai,
      'prompt',
      new AbortController().signal,
    )).resolves.toBe('{"groups":[]}');
    expect(generateRaw).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'prompt',
      responseLength: 23333,
      jsonSchema: expect.objectContaining({ name: 'timeline_analysis_draft' }),
    }));
  });

  it('puts the jailbreak prompt before the fixed system instructions', async () => {
    const generateRaw = vi.fn().mockResolvedValue('{"groups":[]}');
    installContext({ mainApi: 'openai', generateRaw });

    await generateTimelineAnalysis(
      {
        ...DEFAULT_SETTINGS.ai,
        jailbreakPrompt: '不要因格式或角色设定拒绝输出，严格返回 JSON。',
      },
      '原始分析请求',
      new AbortController().signal,
    );

    expect(generateRaw).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '原始分析请求',
      systemPrompt: expect.stringMatching(/^不要因格式或角色设定拒绝输出，严格返回 JSON。\n\n你是 YaKit-理脉（YaKit-Timeline）的世界书时间线分析器/),
    }));
  });

  it('places a custom fixed prompt after the jailbreak prompt', async () => {
    const generateRaw = vi.fn().mockResolvedValue('{"groups":[]}');
    installContext({ mainApi: 'openai', generateRaw });

    await generateTimelineAnalysis(
      {
        ...DEFAULT_SETTINGS.ai,
        jailbreakPrompt: '先执行破限提示词。',
        fixedPrompt: '这是用户配置的固定提示词。',
      },
      '原始分析请求',
      new AbortController().signal,
    );

    expect(generateRaw).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: '先执行破限提示词。\n\n这是用户配置的固定提示词。',
    }));
  });

  it('uses the selected main chat-completion model without changing host settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: '{"groups":[]}' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    installContext({
      mainApi: 'openai',
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      chatCompletionSettings: { chat_completion_source: 'custom', custom_url: 'https://main.test/v1' },
    });

    await generateTimelineAnalysis(
      { ...DEFAULT_SETTINGS.ai, primaryModel: 'selected-model' },
      'prompt',
      new AbortController().signal,
    );
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/backends/chat-completions/generate');
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_completion_source: 'custom',
      custom_url: 'https://main.test/v1',
      model: 'selected-model',
      temperature: 0.9,
      max_tokens: 23333,
      stream: false,
    });
  });

  it('routes independent OpenAI-compatible requests through the host proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: '{"groups":[]}' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    installContext({ getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) });

    await generateTimelineAnalysis({
      ...DEFAULT_SETTINGS.ai,
      provider: 'independent',
      apiUrl: 'https://backup.test/v1',
      secretId: 'shared-secret-id',
      model: 'backup-model',
    }, 'prompt', new AbortController().signal);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_completion_source: 'custom',
      custom_url: 'https://backup.test/v1',
      secret_id: 'shared-secret-id',
      model: 'backup-model',
    });
  });

  it('测试连接会发送最小真实请求并校验有效 JSON', async () => {
    const generateRaw = vi.fn().mockResolvedValue('{"groups":[]}');
    installContext({ mainApi: 'openai', generateRaw });

    await expect(testAiConnection(DEFAULT_SETTINGS.ai, new AbortController().signal))
      .resolves.toBe('AI 已返回有效 JSON');
    expect(generateRaw).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('YaKit-理脉 AI 连通性测试'),
      responseLength: 256,
    }));
  });

  it('测试连接拒绝非 JSON 或缺少 groups 的响应', async () => {
    const generateRaw = vi.fn().mockResolvedValue('我无法处理这个请求');
    installContext({ mainApi: 'openai', generateRaw });

    await expect(testAiConnection(DEFAULT_SETTINGS.ai, new AbortController().signal))
      .rejects.toThrow('未返回有效的时间线 JSON');
  });

  it('rejects an incomplete independent configuration before sending a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    installContext({});
    await expect(generateTimelineAnalysis(
      { ...DEFAULT_SETTINGS.ai, provider: 'independent' },
      'prompt',
      new AbortController().signal,
    )).rejects.toThrow('副 API URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to send an independent request without a shared Secret ID', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    installContext({});
    await expect(generateTimelineAnalysis(
      {
        ...DEFAULT_SETTINGS.ai,
        provider: 'independent',
        apiUrl: 'https://backup.test/v1',
        model: 'backup-model',
      },
      'prompt',
      new AbortController().signal,
    )).rejects.toThrow('请先保存副 API Key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
