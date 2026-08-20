import { TIMELINE_ANALYSIS_JSON_SCHEMA } from '@/analysis/scanner';
import { DEFAULT_FIXED_PROMPT } from '@/st/ai-prompts';
import type { AiSettings } from '@/ui/pages/settings';

interface GenerateRawOptions {
  jsonSchema?: Record<string, unknown>;
  prompt: string;
  responseLength?: number;
  systemPrompt?: string;
}

interface SillyTavernAiContext {
  chatCompletionSettings?: Record<string, unknown>;
  generateRaw?: (options: GenerateRawOptions) => Promise<unknown>;
  getRequestHeaders?: () => HeadersInit;
  mainApi?: unknown;
}

interface SillyTavernAiApi {
  getContext: () => SillyTavernAiContext;
}

const STRUCTURED_SCHEMA = {
  name: 'timeline_analysis_draft',
  description: '世界书时间线分析草稿',
  strict: true,
  returnInvalid: true,
  value: TIMELINE_ANALYSIS_JSON_SCHEMA,
};

const CONNECTION_TEST_PROMPT = [
  '这是 YaKit-理脉 AI 连通性测试，不要分析任何世界书内容。',
  '请只返回最小合法 JSON：{"groups":[]}，不要返回 Markdown、解释或其他文字。',
].join('\n');

function getContext(): SillyTavernAiContext {
  const api = (globalThis as unknown as { SillyTavern?: SillyTavernAiApi }).SillyTavern;
  const context = api?.getContext();
  if (!context) throw new Error('无法读取 SillyTavern 当前 AI 配置');
  return context;
}

function abortError(): DOMException {
  return new DOMException('分析已取消', 'AbortError');
}

function requestHeaders(context: SillyTavernAiContext): HeadersInit {
  return context.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' };
}

function responseContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (Array.isArray(record.content)) {
    return record.content.map(responseContent).filter(Boolean).join('');
  }
  return '';
}

export function extractAiResponseText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object'
    ? choices[0] as Record<string, unknown>
    : null;
  const choiceMessage = firstChoice?.message && typeof firstChoice.message === 'object'
    ? firstChoice.message as Record<string, unknown>
    : null;
  const choiceText = responseContent(choiceMessage?.content) || responseContent(firstChoice?.text);
  if (choiceText) return choiceText;

  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  const candidate = candidates[0] && typeof candidates[0] === 'object'
    ? candidates[0] as Record<string, unknown>
    : null;
  const candidateContent = candidate?.content && typeof candidate.content === 'object'
    ? candidate.content as Record<string, unknown>
    : null;
  const parts = Array.isArray(candidateContent?.parts) ? candidateContent.parts : [];
  const candidateText = parts.map(responseContent).filter(Boolean).join('');
  if (candidateText) return candidateText;

  return responseContent(record.content) || responseContent(record.response) || responseContent(record.output_text);
}

function withTimeoutSignal(parent: AbortSignal, timeoutSeconds: number): {
  cleanup: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent.reason ?? abortError());
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(new DOMException('请求超时', 'TimeoutError')),
    Math.max(1, timeoutSeconds) * 1000,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timeoutId);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

async function postChatCompletion(
  context: SillyTavernAiContext,
  body: Record<string, unknown>,
  settings: AiSettings,
  signal: AbortSignal,
): Promise<string> {
  const timeout = withTimeoutSignal(signal, settings.timeoutSeconds);
  try {
    const response = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(body),
      cache: 'no-cache',
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`AI 请求失败（HTTP ${response.status}）`);
    const text = extractAiResponseText(payload);
    if (!text) throw new Error('AI 接口未返回可分析内容');
    return text;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timeout.signal.aborted) throw new Error(`AI 请求超时（${Math.max(1, settings.timeoutSeconds)} 秒）`);
    throw error;
  } finally {
    timeout.cleanup();
  }
}

function systemPrompt(settings: AiSettings): string {
  return [
    settings.jailbreakPrompt.trim(),
    settings.fixedPrompt.trim() || DEFAULT_FIXED_PROMPT,
  ].filter(Boolean).join('\n\n');
}

function messages(settings: AiSettings, prompt: string): Array<{ content: string; role: 'system' | 'user' }> {
  return [
    { role: 'system', content: systemPrompt(settings) },
    { role: 'user', content: prompt },
  ];
}

async function generateWithMainApi(
  context: SillyTavernAiContext,
  settings: AiSettings,
  prompt: string,
  signal: AbortSignal,
): Promise<unknown> {
  const selectedModel = settings.primaryModel.trim();
  if (selectedModel && context.mainApi === 'openai' && context.chatCompletionSettings) {
    return postChatCompletion(context, {
      ...context.chatCompletionSettings,
      type: 'quiet',
      messages: messages(settings, prompt),
      model: selectedModel,
      temperature: settings.temperature,
      max_tokens: settings.maxOutputTokens,
      stream: false,
      n: 1,
      json_schema: STRUCTURED_SCHEMA,
    }, settings, signal);
  }

  if (typeof context.generateRaw !== 'function') {
    throw new Error('当前 SillyTavern 未提供 AI 静默生成能力');
  }
  if (signal.aborted) throw abortError();

  let removeAbortListener: () => void = () => undefined;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    timeoutId = globalThis.setTimeout(
      () => reject(new Error(`AI 请求超时（${Math.max(1, settings.timeoutSeconds)} 秒）`)),
      Math.max(1, settings.timeoutSeconds) * 1000,
    );
  });

  try {
    return await Promise.race([
      context.generateRaw({
        prompt,
        systemPrompt: systemPrompt(settings),
        responseLength: settings.maxOutputTokens,
        jsonSchema: STRUCTURED_SCHEMA,
      }),
      interrupted,
    ]);
  } finally {
    removeAbortListener();
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  }
}

function generateWithIndependentApi(
  context: SillyTavernAiContext,
  settings: AiSettings,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const baseUrl = settings.apiUrl.trim();
  const model = settings.model.trim();
  if (!baseUrl) throw new Error('请先在设置中填写副 API URL');
  if (!model) throw new Error('请先在设置中选择或填写副 API 模型名称');
  if (!settings.secretId) throw new Error('请先保存副 API Key');

  return postChatCompletion(context, {
    type: 'quiet',
    messages: messages(settings, prompt),
    model,
    temperature: settings.temperature,
    max_tokens: settings.maxOutputTokens,
    stream: false,
    n: 1,
    chat_completion_source: 'custom',
    custom_url: baseUrl,
    custom_include_headers: '',
    custom_include_body: '',
    custom_exclude_body: '',
    secret_id: settings.secretId,
    json_schema: STRUCTURED_SCHEMA,
  }, settings, signal);
}

export async function generateTimelineAnalysis(
  settings: AiSettings,
  prompt: string,
  signal: AbortSignal,
): Promise<unknown> {
  const context = getContext();
  return settings.provider === 'independent'
    ? generateWithIndependentApi(context, settings, prompt, signal)
    : generateWithMainApi(context, settings, prompt, signal);
}

function parseConnectionResponse(value: unknown): void {
  const direct = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (direct && Array.isArray(direct.groups)) return;

  const text = extractAiResponseText(value).trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(unfenced) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).groups)) {
      return;
    }
  } catch {
    // 统一报告为“返回内容无效”，避免把原始响应直接显示到设置页。
  }
  throw new Error('AI 已连接，但未返回有效的时间线 JSON 内容');
}

/** 发送最小真实生成请求，验证鉴权、模型调用和可解析响应，而不是只验证模型列表接口。 */
export async function testAiConnection(settings: AiSettings, signal: AbortSignal): Promise<string> {
  const response = await generateTimelineAnalysis(
    { ...settings, maxOutputTokens: Math.min(256, Math.max(64, settings.maxOutputTokens)) },
    CONNECTION_TEST_PROMPT,
    signal,
  );
  parseConnectionResponse(response);
  return 'AI 已返回有效 JSON';
}
