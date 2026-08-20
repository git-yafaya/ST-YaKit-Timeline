import type { AiSettings } from '@/ui/pages/settings';

interface SillyTavernModelContext {
  chatCompletionSettings?: Record<string, unknown>;
  getRequestHeaders?: () => HeadersInit;
  mainApi?: unknown;
  textCompletionSettings?: Record<string, unknown>;
}

interface SillyTavernModelApi {
  getContext: () => SillyTavernModelContext;
}

const CHAT_STATUS_FIELDS = [
  'reverse_proxy',
  'proxy_password',
  'chat_completion_source',
  'custom_url',
  'custom_include_headers',
  'azure_base_url',
  'azure_deployment_name',
  'azure_api_version',
  'siliconflow_endpoint',
  'minimax_endpoint',
  'workers_ai_account_id',
  'secret_id',
] as const;

function getSillyTavernContext(): SillyTavernModelContext {
  const api = (globalThis as unknown as { SillyTavern?: SillyTavernModelApi }).SillyTavern;
  const context = api?.getContext();
  if (!context) throw new Error('无法读取 SillyTavern 当前 API 配置');
  return context;
}

function requestHeaders(context: SillyTavernModelContext): HeadersInit {
  return context.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' };
}

function modelId(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null;
  if (!item || typeof item !== 'object') return null;

  const record = item as Record<string, unknown>;
  const value = typeof record.id === 'string'
    ? record.id
    : typeof record.name === 'string' ? record.name : '';
  return value.trim() || null;
}

export function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as Record<string, unknown>).data;
  const items = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).data)
      ? (data as Record<string, unknown>).data as unknown[]
      : [];

  return [...new Set(items.map(modelId).filter((id): id is string => id !== null))]
    .sort((left, right) => left.localeCompare(right));
}

async function postForModels(
  url: string,
  body: Record<string, unknown>,
  headers: HeadersInit,
  timeoutSeconds: number,
): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-cache',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`获取模型失败（HTTP ${response.status}）`);

    const models = parseModelIds(payload);
    if (models.length === 0) throw new Error('接口未返回可用模型');
    return models;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`获取模型超时（${Math.max(1, timeoutSeconds)} 秒）`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function chatCompletionRequest(settings: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of CHAT_STATUS_FIELDS) {
    if (settings[field] !== undefined) body[field] = settings[field];
  }
  return body;
}

function textCompletionEndpoint(settings: Record<string, unknown>): string {
  const type = typeof settings.type === 'string' ? settings.type : '';
  const serverUrls = settings.server_urls;
  if (!type || !serverUrls || typeof serverUrls !== 'object') return '';
  const endpoint = (serverUrls as Record<string, unknown>)[type];
  return typeof endpoint === 'string' ? endpoint.trim() : '';
}

async function fetchMainApiModels(settings: AiSettings): Promise<string[]> {
  const context = getSillyTavernContext();
  const headers = requestHeaders(context);

  if (context.mainApi === 'openai') {
    const currentSettings = context.chatCompletionSettings;
    if (!currentSettings) throw new Error('无法读取 SillyTavern 主 API 设置');
    return postForModels(
      '/api/backends/chat-completions/status',
      chatCompletionRequest(currentSettings),
      headers,
      settings.timeoutSeconds,
    );
  }

  if (context.mainApi === 'textgenerationwebui') {
    const currentSettings = context.textCompletionSettings;
    if (!currentSettings) throw new Error('无法读取 SillyTavern 文本补全设置');
    const endpoint = textCompletionEndpoint(currentSettings);
    const apiType = typeof currentSettings.type === 'string' ? currentSettings.type : '';
    if (!endpoint || !apiType) throw new Error('SillyTavern 当前主 API 尚未配置模型接口');
    return postForModels(
      '/api/backends/text-completions/status',
      { api_server: endpoint, api_type: apiType },
      headers,
      settings.timeoutSeconds,
    );
  }

  throw new Error('当前 SillyTavern 主 API 暂不提供模型列表');
}

async function fetchIndependentApiModels(settings: AiSettings): Promise<string[]> {
  const baseUrl = settings.apiUrl.trim();
  if (!baseUrl) throw new Error('请先填写副 API URL');
  if (!settings.secretId) throw new Error('请先保存副 API Key');

  const context = getSillyTavernContext();
  return postForModels(
    '/api/backends/chat-completions/status',
    {
      chat_completion_source: 'custom',
      custom_url: baseUrl,
      custom_include_headers: '',
      secret_id: settings.secretId,
    },
    requestHeaders(context),
    settings.timeoutSeconds,
  );
}

export function fetchAvailableModels(settings: AiSettings): Promise<string[]> {
  return settings.provider === 'independent'
    ? fetchIndependentApiModels(settings)
    : fetchMainApiModels(settings);
}
