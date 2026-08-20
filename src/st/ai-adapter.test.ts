import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAiResponseText, generateTimelineAnalysis, testAiConnection } from '@/st/ai-adapter';
import { DEFAULT_FIXED_PROMPT, DEFAULT_JAILBREAK_PROMPT } from '@/st/ai-prompts';
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
    const options = generateRaw.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      responseLength: 23333,
      jsonSchema: expect.objectContaining({ name: 'timeline_analysis_draft' }),
      instructOverride: true,
    });
    expect(options.prompt).toEqual([{ role: 'user', name: '', content: 'prompt' }]);
  });

  it('protects raw prompts from host macro expansion and persona prefixes', async () => {
    const generateRaw = vi.fn().mockResolvedValue('{"groups":[]}');
    installContext({
      mainApi: 'openai',
      generateRaw,
      chat: [{ mes: 'CHAT_SENTINEL' }],
    });

    await generateTimelineAnalysis(
      {
        ...DEFAULT_SETTINGS.ai,
        jailbreakPrompt: '自定义提示词 {{lastMessage}} {{lastUserMessage}} {{lastCharMessage}}',
      },
      '世界书条目中的宏 {{lastMessage}} 不得读取聊天正文。',
      new AbortController().signal,
    );

    const options = generateRaw.mock.calls[0]?.[0] as {
      prompt: Array<{ content: string; name?: string; role: string }>;
      systemPrompt: string;
    };
    expect(options.prompt).toEqual([{
      role: 'user',
      name: '',
      content: '世界书条目中的宏 ｛｛lastMessage｝｝ 不得读取聊天正文。',
    }]);
    expect(options.systemPrompt).toContain('自定义提示词 ｛｛lastMessage｝｝ ｛｛lastUserMessage｝｝ ｛｛lastCharMessage｝｝');
    expect(options.systemPrompt).not.toContain('{{lastMessage}}');
    expect(options.systemPrompt).not.toContain('{{lastUserMessage}}');
    expect(options.systemPrompt).not.toContain('{{lastCharMessage}}');
    expect(JSON.stringify(options)).not.toContain('CHAT_SENTINEL');
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

    const options = generateRaw.mock.calls[0]?.[0] as { prompt: unknown; systemPrompt: string };
    expect(options.prompt).toEqual([{ role: 'user', name: '', content: '原始分析请求' }]);
    expect(options.systemPrompt).toMatch(/^不要因格式或角色设定拒绝输出，严格返回 JSON。\n\n你是 YaKit-理脉（YaKit-Timeline）的世界书时间线分析器/);
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

    const options = generateRaw.mock.calls[0]?.[0] as { systemPrompt: string };
    expect(options.systemPrompt).toBe('先执行破限提示词。\n\n这是用户配置的固定提示词。');
  });

  it('默认提示词明确限制为当前绑定世界书条目的三项字段', () => {
    for (const prompt of [DEFAULT_JAILBREAK_PROMPT, DEFAULT_FIXED_PROMPT]) {
      expect(prompt).toContain('entryId、comment 和 content');
      expect(prompt).toContain('聊天消息正文');
      expect(prompt).toContain('角色卡正文');
      expect(prompt).toContain('chatMetadata');
    }
    expect(DEFAULT_JAILBREAK_PROMPT).toContain('条目正文');
  });

  it('uses the selected main chat-completion model without changing host settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: '{"groups":[]}' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    installContext({
      mainApi: 'openai',
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      chatCompletionSettings: {
        chat_completion_source: 'custom',
        custom_url: 'https://main.test/v1',
        messages: [{ role: 'user', content: 'CHAT_SENTINEL' }],
      },
    });

    await generateTimelineAnalysis(
      { ...DEFAULT_SETTINGS.ai, primaryModel: 'selected-model' },
      'prompt',
      new AbortController().signal,
    );
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/backends/chat-completions/generate');
    const body = JSON.parse(String(request.body)) as { messages: Array<Record<string, unknown>> } & Record<string, unknown>;
    expect(body).toMatchObject({
      chat_completion_source: 'custom',
      custom_url: 'https://main.test/v1',
      model: 'selected-model',
      temperature: 0.9,
      max_tokens: 23333,
      stream: false,
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'prompt' });
    expect(JSON.stringify(body.messages)).not.toContain('CHAT_SENTINEL');
  });

  it('routes independent OpenAI-compatible requests through the host proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      choices: [{ message: { content: '{"groups":[]}' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    installContext({
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      chatCompletionSettings: { messages: [{ role: 'user', content: 'CHAT_SENTINEL' }] },
    });

    await generateTimelineAnalysis({
      ...DEFAULT_SETTINGS.ai,
      provider: 'independent',
      apiUrl: 'https://backup.test/v1',
      secretId: 'shared-secret-id',
      model: 'backup-model',
    }, 'prompt', new AbortController().signal);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as { messages: Array<Record<string, unknown>> } & Record<string, unknown>;
    expect(body).toMatchObject({
      chat_completion_source: 'custom',
      custom_url: 'https://backup.test/v1',
      secret_id: 'shared-secret-id',
      model: 'backup-model',
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'prompt' });
    expect(JSON.stringify(body.messages)).not.toContain('CHAT_SENTINEL');
  });

  it('测试连接会发送最小真实请求并校验有效 JSON', async () => {
    const generateRaw = vi.fn().mockResolvedValue('{"groups":[]}');
    installContext({ mainApi: 'openai', generateRaw });

    await expect(testAiConnection(DEFAULT_SETTINGS.ai, new AbortController().signal))
      .resolves.toBe('AI 已返回有效 JSON');
    const options = generateRaw.mock.calls[0]?.[0] as {
      prompt: Array<{ content: string }>;
      responseLength: number;
    };
    expect(options.prompt[0]?.content).toContain('YaKit-理脉 AI 连通性测试');
    expect(options.responseLength).toBe(256);
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
