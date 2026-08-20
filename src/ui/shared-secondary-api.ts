const SHARED_SECONDARY_API_NAMESPACE = 'yakit-shared-secondary-api';
const SHARED_SECONDARY_API_VERSION = 3;
const SILLYTAVERN_SECRETS_MODULE = '../../../../secrets.js';

export interface SharedSecondaryConnection {
  id: string;
  name: string;
  apiUrl: string;
  model: string;
  secretId: string;
}

export interface SharedSecondaryRequestConfig extends SharedSecondaryConnection {}

export interface SaveSharedSecondaryConnectionInput {
  id?: string;
  name?: string;
  apiUrl?: string;
  model?: string;
  secretId?: string;
  /** 仅用于本次 Secrets 写入，绝不会保存到 extensionSettings。 */
  apiKey?: string;
}

interface SharedSecondaryStore {
  version: 3;
  activeConnectionId: string;
  connections: SharedSecondaryConnection[];
}

interface SillyTavernContext {
  extensionSettings: Record<string, unknown>;
  saveSettingsDebounced?: () => void;
}

interface SillyTavernApi {
  getContext?: () => SillyTavernContext;
}

interface SecretStateEntry {
  active?: boolean;
  id?: string;
}

interface SillyTavernSecretsModule {
  SECRET_KEYS?: { CUSTOM?: string };
  rotateSecret?: (key: string, id: string) => Promise<void>;
  secret_state?: Record<string, unknown>;
  writeSecret?: (key: string, value: string, label?: string) => Promise<string | null | undefined>;
}

type SecretLoader = () => Promise<SillyTavernSecretsModule>;

let testSecretLoader: SecretLoader | null = null;
let sharedSaveQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneConnection(connection: SharedSecondaryConnection): SharedSecondaryConnection {
  return { ...connection };
}

function createConnectionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `secondary_${randomId}`
    : `secondary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeOpenAiCompatibleUrl(value: unknown): string {
  const url = normalizedString(value).replace(/\/+$/, '');
  if (!url) return '';
  if (/\/chat\/completions$/i.test(url)) return url.replace(/\/chat\/completions$/i, '');
  if (/^https?:\/\/[^/?#]+$/i.test(url)) return `${url}/v1`;
  return url;
}

function normalizeConnection(
  value: unknown,
  usedIds: Set<string>,
  fallbackName: string,
): SharedSecondaryConnection {
  const source = isRecord(value) ? value : {};
  let id = normalizedString(source.id);
  if (!id || usedIds.has(id)) id = createConnectionId();
  usedIds.add(id);

  return {
    id,
    name: normalizedString(source.name) || fallbackName,
    apiUrl: normalizeOpenAiCompatibleUrl(source.apiUrl),
    model: normalizedString(source.model),
    secretId: normalizedString(source.secretId),
  };
}

function normalizeStore(value: unknown): SharedSecondaryStore {
  const source = isRecord(value) ? value : {};
  const rawConnections = Array.isArray(source.connections) ? source.connections : [];
  const usedIds = new Set<string>();
  const connections = rawConnections.map((connection, index) =>
    normalizeConnection(connection, usedIds, `副 API ${index + 1}`));

  if (connections.length === 0) {
    connections.push(normalizeConnection({}, usedIds, '副 API 1'));
  }

  const requestedActiveId = normalizedString(source.activeConnectionId);
  const activeConnectionId = connections.some(connection => connection.id === requestedActiveId)
    ? requestedActiveId
    : connections[0].id;

  return {
    version: SHARED_SECONDARY_API_VERSION,
    activeConnectionId,
    connections,
  };
}

function getSillyTavernContext(): SillyTavernContext {
  try {
    const api = (globalThis as unknown as { SillyTavern?: SillyTavernApi }).SillyTavern;
    const context = api?.getContext?.();
    if (!context || !isRecord(context.extensionSettings)) throw new Error('missing context');
    return context;
  } catch {
    throw new Error('当前无法读取 SillyTavern 上下文，无法使用共享副 API');
  }
}

function scheduleSettingsSave(context: SillyTavernContext): void {
  if (typeof context.saveSettingsDebounced !== 'function') {
    throw new Error('当前 SillyTavern 不支持保存共享副 API 设置');
  }
  context.saveSettingsDebounced();
}

function storesEqual(left: unknown, right: SharedSecondaryStore): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function readStore(persistNormalization = true): {
  context: SillyTavernContext;
  store: SharedSecondaryStore;
} {
  const context = getSillyTavernContext();
  const current = context.extensionSettings[SHARED_SECONDARY_API_NAMESPACE];
  const store = normalizeStore(current);

  if (!storesEqual(current, store)) {
    context.extensionSettings[SHARED_SECONDARY_API_NAMESPACE] = store;
    if (persistNormalization) scheduleSettingsSave(context);
  }

  return { context, store };
}

function writeStore(context: SillyTavernContext, store: SharedSecondaryStore): void {
  context.extensionSettings[SHARED_SECONDARY_API_NAMESPACE] = store;
  scheduleSettingsSave(context);
}

async function loadSecretsModule(): Promise<SillyTavernSecretsModule> {
  if (testSecretLoader) return testSecretLoader();

  try {
    return await import(/* @vite-ignore */ SILLYTAVERN_SECRETS_MODULE) as SillyTavernSecretsModule;
  } catch {
    throw new Error('无法加载 SillyTavern Secrets 模块，无法安全保存副 API Key');
  }
}

function getActiveCustomSecretId(secrets: SillyTavernSecretsModule, customKey: string): string {
  const state = secrets.secret_state?.[customKey];
  if (!Array.isArray(state)) return '';
  const active = (state as SecretStateEntry[]).find(item => item?.active);
  return normalizedString(active?.id);
}

async function saveApiKey(name: string, apiKey: string): Promise<string> {
  const secrets = await loadSecretsModule();
  const customKey = normalizedString(secrets.SECRET_KEYS?.CUSTOM);
  if (!customKey || typeof secrets.writeSecret !== 'function') {
    throw new Error('当前 SillyTavern 不支持通过 Secrets 保存副 API Key');
  }

  const previousActiveId = getActiveCustomSecretId(secrets, customKey);
  const secretId = await secrets.writeSecret(customKey, apiKey, `YaKit-理脉 · ${name}`);
  if (!secretId) throw new Error('副 API Key 写入 SillyTavern Secrets 失败');

  if (previousActiveId && previousActiveId !== secretId) {
    try {
      if (typeof secrets.rotateSecret !== 'function') throw new Error('宿主未提供 rotateSecret');
      await secrets.rotateSecret(customKey, previousActiveId);
    } catch (error) {
      console.warn('[YaKit-Timeline] 无法恢复之前活动的 Custom Secret。', error);
    }
  }

  return secretId;
}

export function listSharedSecondaryConnections(): SharedSecondaryConnection[] {
  return readStore().store.connections.map(cloneConnection);
}

export function getSharedSecondaryConnection(connectionId = ''): SharedSecondaryConnection | undefined {
  const store = readStore().store;
  const requestedId = normalizedString(connectionId) || store.activeConnectionId;
  const connection = store.connections.find(item => item.id === requestedId);
  return connection ? cloneConnection(connection) : undefined;
}

export function setActiveSharedSecondaryConnection(connectionId: string): SharedSecondaryConnection {
  const { context, store } = readStore(false);
  const requestedId = normalizedString(connectionId);
  const connection = store.connections.find(item => item.id === requestedId);
  if (!connection) throw new Error(`找不到共享副 API 连接：${requestedId || '空 ID'}`);

  store.activeConnectionId = connection.id;
  writeStore(context, store);
  return cloneConnection(connection);
}

async function saveSharedSecondaryConnectionNow(
  input: SaveSharedSecondaryConnectionInput,
): Promise<SharedSecondaryConnection> {
  const initialStore = readStore(false).store;
  const requestedId = normalizedString(input.id);
  const existingIndex = requestedId
    ? initialStore.connections.findIndex(connection => connection.id === requestedId)
    : -1;
  const initialConnection = existingIndex >= 0 ? initialStore.connections[existingIndex] : undefined;
  const id = requestedId || createConnectionId();
  const requestedName = normalizedString(input.name);
  const apiKey = normalizedString(input.apiKey);
  const savedSecretId = apiKey
    ? await saveApiKey(requestedName || initialConnection?.name || `副 API ${initialStore.connections.length + 1}`, apiKey)
    : '';

  // Secrets 写入可能耗时；提交前重新读取共享 Store，避免覆盖纪实或另一标签页期间写入的连接。
  const { context, store } = readStore(false);
  const latestIndex = store.connections.findIndex(connection => connection.id === id);
  const latestConnection = latestIndex >= 0 ? store.connections[latestIndex] : undefined;
  const fallbackConnection = latestConnection ?? initialConnection;
  const connection: SharedSecondaryConnection = {
    id,
    name: requestedName || fallbackConnection?.name || `副 API ${store.connections.length + 1}`,
    apiUrl: input.apiUrl === undefined
      ? normalizeOpenAiCompatibleUrl(fallbackConnection?.apiUrl)
      : normalizeOpenAiCompatibleUrl(input.apiUrl),
    model: input.model === undefined ? fallbackConnection?.model ?? '' : normalizedString(input.model),
    secretId: savedSecretId || (input.secretId === undefined
      ? fallbackConnection?.secretId ?? ''
      : normalizedString(input.secretId)),
  };

  if (latestIndex >= 0) store.connections[latestIndex] = connection;
  else store.connections.push(connection);
  store.activeConnectionId = connection.id;
  writeStore(context, store);
  return cloneConnection(connection);
}

export function saveSharedSecondaryConnection(
  input: SaveSharedSecondaryConnectionInput,
): Promise<SharedSecondaryConnection> {
  const task = sharedSaveQueue.then(
    () => saveSharedSecondaryConnectionNow(input),
    () => saveSharedSecondaryConnectionNow(input),
  );
  sharedSaveQueue = task.then(() => undefined, () => undefined);
  return task;
}

export function getSharedSecondaryRequestConfig(
  connectionId = '',
): SharedSecondaryRequestConfig | null {
  const connection = getSharedSecondaryConnection(connectionId);
  if (!connection) return null;
  return {
    ...connection,
    apiUrl: normalizeOpenAiCompatibleUrl(connection.apiUrl),
  };
}

/** 仅供单元测试替换宿主 Secrets 模块；生产代码不要调用。 */
export function __setSharedSecondarySecretLoaderForTests(loader: SecretLoader | null): void {
  testSecretLoader = loader;
}
