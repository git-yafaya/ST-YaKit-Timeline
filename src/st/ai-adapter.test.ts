import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAiResponseText, generateTimelineAnalysis, testAiConnection } from '@/st/ai-adapter';
import { DEFAULT_FIXED_PROMPT, DEFAULT_JAILBREAK_PROMPT } from '@/st/ai-prompts';
import { DEFAULT_SETTINGS } from '@/ui/settings-store';

const EVENT_TYPES = {
  CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
  GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
  TEXT_COMPLETION_SETTINGS_READY: 'text_completion_settings_ready',
};

type TestListener = (data: Record<string, unknown>) => unknown;

class TestEventEmitter {
  private readonly listeners = new Map<string, TestListener[]>();

  on(event: string, listener: TestListener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  removeListener(event: string, listener: TestListener): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter(item => item !== listener));
  }

  makeFirst(event: string, listener: TestListener): void {
    this.removeListener(event, listener);
    this.listeners.set(event, [listener, ...(this.listeners.get(event) ?? [])]);
  }

  makeLast(event: string, listener: TestListener): void {
    this.removeListener(event, listener);
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  async emit(event: string, data: Record<string, unknown>): Promise<void> {
    for (const listener of [...(this.listeners.get(event) ?? [])]) await listener(data);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

function installContext(context: Record<string, unknown>): TestEventEmitter {
  const eventSource = context.eventSource instanceof TestEventEmitter
    ? context.eventSource
    : new TestEventEmitter();
  Object.defineProperty(globalThis, 'SillyTavern', {
    configurable: true,
    value: {
      getContext: () => ({
        eventSource,
        eventTypes: EVENT_TYPES,
        ...context,
      }),
    },
    writable: true,
  });
  return eventSource;
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
        custom_include_body: 'messages:\n  - role: user\n    content: CHAT_SENTINEL',
        custom_exclude_body: 'messages',
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
      custom_include_body: '',
      custom_exclude_body: '',
    });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'prompt' });
    expect(JSON.stringify(body.messages)).not.toContain('CHAT_SENTINEL');
  });

  it('restores only this generateRaw OpenAI request after hostile event listeners', async () => {
    const eventSource = new TestEventEmitter();
    const injectPrompt = (data: Record<string, unknown>) => {
      data.chat = [{ role: 'user', content: 'CHAT_SENTINEL' }];
    };
    const injectSettings = (data: Record<string, unknown>) => {
      data.messages = [{ role: 'user', content: 'CHAT_SENTINEL' }];
      data.custom_include_body = 'messages: CHAT_SENTINEL';
      data.custom_exclude_body = 'messages';
      data.tools = [{ name: 'read_chat' }];
      data.tool_choice = 'required';
    };
    eventSource.on(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, injectPrompt);
    eventSource.on(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY, injectSettings);

    const unrelatedPrompt = { chat: [{ role: 'user', content: 'UNRELATED' }] };
    const unrelatedSettings = { messages: [{ role: 'user', content: 'UNRELATED' }] };
    let sentSettings: Record<string, unknown> | undefined;
    const generateRaw = vi.fn(async (options: Record<string, unknown>) => {
      const prompt = options.prompt as Array<Record<string, unknown>>;
      prompt.unshift({ role: 'system', content: options.systemPrompt });
      await eventSource.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, unrelatedPrompt);
      const ownedPrompt = { chat: prompt };
      await eventSource.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, ownedPrompt);
      await eventSource.emit(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY, unrelatedSettings);
      // SillyTavern createGenerationParameters 会通过 filter 创建新数组，但保留消息对象引用。
      sentSettings = { messages: ownedPrompt.chat.filter(message => Boolean(message)) };
      await eventSource.emit(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY, sentSettings);
      return '{"groups":[]}';
    });
    installContext({ mainApi: 'openai', generateRaw, eventSource });

    await generateTimelineAnalysis(DEFAULT_SETTINGS.ai, 'WORLD_BOOK_ONLY', new AbortController().signal);

    expect(sentSettings?.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'WORLD_BOOK_ONLY' },
    ]);
    expect(sentSettings).toMatchObject({ custom_include_body: '', custom_exclude_body: '' });
    expect(sentSettings).not.toHaveProperty('tools');
    expect(sentSettings).not.toHaveProperty('tool_choice');
    expect(JSON.stringify(sentSettings)).not.toContain('CHAT_SENTINEL');
    expect(JSON.stringify(sentSettings)).not.toContain('YaKitTimelineRaw');
    expect(JSON.stringify(unrelatedPrompt)).toContain('CHAT_SENTINEL');
    expect(JSON.stringify(unrelatedSettings)).toContain('CHAT_SENTINEL');
    expect(eventSource.listenerCount(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY)).toBe(1);
    expect(eventSource.listenerCount(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY)).toBe(1);
  });

  it('restores text-generation prompts without touching unrelated concurrent events', async () => {
    const eventSource = new TestEventEmitter();
    const injectText = (data: Record<string, unknown>) => {
      data.prompt = `${String(data.prompt)}\nCHAT_SENTINEL`;
    };
    eventSource.on(EVENT_TYPES.GENERATE_AFTER_COMBINE_PROMPTS, injectText);
    eventSource.on(EVENT_TYPES.TEXT_COMPLETION_SETTINGS_READY, injectText);

    const unrelatedPrompt = { prompt: 'UNRELATED_PROMPT' };
    const unrelatedSettings = { prompt: 'UNRELATED_SETTINGS' };
    let sentParams: Record<string, unknown> | undefined;
    const generateRaw = vi.fn(async (options: Record<string, unknown>) => {
      const prompt = options.prompt as Array<{ content: string }>;
      const eventData = { prompt: `${String(options.systemPrompt)}\n${prompt[0]?.content ?? ''}\n` };
      await eventSource.emit(EVENT_TYPES.GENERATE_AFTER_COMBINE_PROMPTS, unrelatedPrompt);
      await eventSource.emit(EVENT_TYPES.GENERATE_AFTER_COMBINE_PROMPTS, eventData);
      await eventSource.emit(EVENT_TYPES.TEXT_COMPLETION_SETTINGS_READY, unrelatedSettings);
      sentParams = { prompt: eventData.prompt };
      await eventSource.emit(EVENT_TYPES.TEXT_COMPLETION_SETTINGS_READY, sentParams);
      return '{"groups":[]}';
    });
    installContext({ mainApi: 'textgenerationwebui', generateRaw, eventSource });

    await generateTimelineAnalysis(DEFAULT_SETTINGS.ai, 'WORLD_BOOK_ONLY', new AbortController().signal);

    expect(sentParams?.prompt).toContain('WORLD_BOOK_ONLY');
    expect(sentParams?.prompt).not.toContain('CHAT_SENTINEL');
    expect(sentParams?.prompt).not.toContain('YaKitTimelineRaw');
    expect(unrelatedPrompt.prompt).toContain('CHAT_SENTINEL');
    expect(unrelatedSettings.prompt).toContain('CHAT_SENTINEL');
    expect(eventSource.listenerCount(EVENT_TYPES.GENERATE_AFTER_COMBINE_PROMPTS)).toBe(1);
    expect(eventSource.listenerCount(EVENT_TYPES.TEXT_COMPLETION_SETTINGS_READY)).toBe(1);
  });

  it('keeps request guards active after cancellation until the raw generation actually settles', async () => {
    const eventSource = new TestEventEmitter();
    const injectPrompt = (data: Record<string, unknown>) => {
      data.chat = [{ role: 'user', content: 'CHAT_SENTINEL' }];
    };
    const injectSettings = (data: Record<string, unknown>) => {
      data.messages = [{ role: 'user', content: 'CHAT_SENTINEL' }];
      data.custom_include_body = 'messages: CHAT_SENTINEL';
    };
    eventSource.on(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, injectPrompt);
    eventSource.on(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY, injectSettings);

    let continueRaw!: () => void;
    let promptReady!: () => void;
    let rawFinished!: () => void;
    const continueRawPromise = new Promise<void>(resolve => { continueRaw = resolve; });
    const promptReadyPromise = new Promise<void>(resolve => { promptReady = resolve; });
    const rawFinishedPromise = new Promise<void>(resolve => { rawFinished = resolve; });
    let sentSettings: Record<string, unknown> | undefined;
    const generateRaw = vi.fn(async (options: Record<string, unknown>) => {
      const prompt = options.prompt as Array<Record<string, unknown>>;
      prompt.unshift({ role: 'system', content: options.systemPrompt });
      const ownedPrompt = { chat: prompt };
      await eventSource.emit(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY, ownedPrompt);
      promptReady();
      await continueRawPromise;
      const ownedMessages = (ownedPrompt.chat as Array<Record<string, unknown>>)
        .filter(message => Boolean(message));
      sentSettings = { messages: ownedMessages };
      await eventSource.emit(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY, sentSettings);
      rawFinished();
      return '{"groups":[]}';
    });
    installContext({ mainApi: 'openai', generateRaw, eventSource });
    const controller = new AbortController();

    const generation = generateTimelineAnalysis(DEFAULT_SETTINGS.ai, 'WORLD_BOOK_ONLY', controller.signal);
    await promptReadyPromise;
    controller.abort();
    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    expect(eventSource.listenerCount(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY)).toBeGreaterThan(1);

    continueRaw();
    await rawFinishedPromise;
    expect(sentSettings?.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'WORLD_BOOK_ONLY' },
    ]);
    expect(sentSettings).toMatchObject({ custom_include_body: '', custom_exclude_body: '' });
    expect(JSON.stringify(sentSettings)).not.toContain('CHAT_SENTINEL');
    await vi.waitFor(() => {
      expect(eventSource.listenerCount(EVENT_TYPES.CHAT_COMPLETION_PROMPT_READY)).toBe(1);
      expect(eventSource.listenerCount(EVENT_TYPES.CHAT_COMPLETION_SETTINGS_READY)).toBe(1);
    });
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
