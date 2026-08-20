import { TECHNICAL_NAME } from '@/branding';

interface ExtensionEndpointPayload extends Record<string, unknown> {
  isUpToDate?: unknown;
  remoteUrl?: unknown;
  shortCommitHash?: unknown;
}

export interface ExtensionUpdateCheckResult {
  extensionName: string;
  isUpToDate: boolean;
  remoteUrl: string;
}

export interface ExtensionUpdateResult {
  isUpToDate: boolean;
  shortCommitHash: string;
}

const extensionNames = ['ST-YaKit-Timeline', TECHNICAL_NAME];

function requestHeaders(): HeadersInit {
  try {
    const context = (globalThis as unknown as {
      SillyTavern?: { getContext?: () => { getRequestHeaders?: () => HeadersInit } };
    }).SillyTavern?.getContext?.();
    return context?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' };
  } catch {
    return { 'Content-Type': 'application/json' };
  }
}

function isRecord(value: unknown): value is ExtensionEndpointPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function postExtensionEndpoint(
  endpoint: 'update' | 'version',
  extensionName: string,
  signal?: AbortSignal,
): Promise<ExtensionEndpointPayload> {
  const response = await fetch(`/api/extensions/${endpoint}`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({ extensionName, global: false }),
    signal,
  });
  const responseText = await response.text();
  let payload: unknown = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(responseText || response.statusText || `HTTP ${response.status}`);
  }
  if (!isRecord(payload)) throw new Error('宿主返回了无法识别的更新信息');
  return payload;
}

function readUpToDate(payload: ExtensionEndpointPayload): boolean {
  if (typeof payload.isUpToDate !== 'boolean') throw new Error('宿主未返回有效的版本状态');
  return payload.isUpToDate;
}

export async function checkExtensionUpdate(signal?: AbortSignal): Promise<ExtensionUpdateCheckResult> {
  let lastError: unknown;
  for (const extensionName of extensionNames) {
    try {
      const payload = await postExtensionEndpoint('version', extensionName, signal);
      return {
        extensionName,
        isUpToDate: readUpToDate(payload),
        remoteUrl: typeof payload.remoteUrl === 'string' ? payload.remoteUrl : '',
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法连接到 SillyTavern 更新服务');
}

export async function updateExtension(
  extensionName: string,
  signal?: AbortSignal,
): Promise<ExtensionUpdateResult> {
  const payload = await postExtensionEndpoint('update', extensionName, signal);
  return {
    isUpToDate: readUpToDate(payload),
    shortCommitHash: typeof payload.shortCommitHash === 'string' ? payload.shortCommitHash : '',
  };
}
