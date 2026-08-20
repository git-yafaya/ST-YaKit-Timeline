import type { EntryId } from '@/timeline/types';

export type HostScopeStatus =
  | 'ready'
  | 'unavailable'
  | 'no_character'
  | 'no_worldbook'
  | 'worldbook_unreadable';

export interface CharacterRef {
  avatar: string;
  id: string;
  name: string;
}

export interface WorldInfoEntrySnapshot {
  comment: string;
  content: string;
  enabled: boolean;
  id: string | number;
}

export interface WorldbookSnapshot {
  entries: readonly WorldInfoEntrySnapshot[];
  key: string;
  name: string;
}

export interface HostScopeSnapshot {
  character: CharacterRef | null;
  chatId: string | null;
  message: string;
  status: HostScopeStatus;
  worldbook: WorldbookSnapshot | null;
}

interface HostEventSource {
  on?: (event: string, listener: (...args: unknown[]) => unknown) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => unknown) => void;
}

interface SillyTavernHostContext {
  characterId?: unknown;
  characters?: unknown;
  chat?: unknown;
  chatId?: unknown;
  eventSource?: HostEventSource;
  eventTypes?: Record<string, unknown>;
  loadWorldInfo?: (name: string) => Promise<unknown>;
  saveWorldInfo?: (name: string, data: unknown, immediately?: boolean) => Promise<unknown> | unknown;
}

interface SillyTavernHostApi {
  getContext: () => SillyTavernHostContext;
}

const WATCHED_EVENT_KEYS = [
  'APP_READY',
  'CHAT_CHANGED',
  'CHARACTER_EDITED',
  'WORLDINFO_UPDATED',
] as const;

const RUNTIME_EVENT_KEYS = ['MESSAGE_RECEIVED'] as const;

function getContext(): SillyTavernHostContext | null {
  try {
    const api = (globalThis as unknown as { SillyTavern?: SillyTavernHostApi }).SillyTavern;
    return api?.getContext() ?? null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function currentCharacter(context: SillyTavernHostContext): { raw: Record<string, unknown>; ref: CharacterRef } | null {
  if (!Array.isArray(context.characters)) return null;
  const index = typeof context.characterId === 'number'
    ? context.characterId
    : Number.parseInt(String(context.characterId ?? ''), 10);
  if (!Number.isInteger(index) || index < 0) return null;

  const raw = recordValue(context.characters[index]);
  if (!raw) return null;
  const name = stringValue(raw.name);
  const avatar = stringValue(raw.avatar);
  if (!name && !avatar) return null;

  return {
    raw,
    ref: {
      id: avatar || String(index),
      name: name || avatar,
      avatar,
    },
  };
}

function boundWorldbookName(character: Record<string, unknown>): string {
  const data = recordValue(character.data);
  const extensions = recordValue(data?.extensions);
  return stringValue(extensions?.world);
}

function entryId(entry: Record<string, unknown>, fallback: string): string | number {
  return typeof entry.uid === 'number' || typeof entry.uid === 'string' ? entry.uid : fallback;
}

function cloneWorldInfo(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('世界书数据格式无效');
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function characterScopeToken(context: SillyTavernHostContext): string {
  const character = currentCharacter(context);
  return [
    String(context.characterId ?? ''),
    character?.ref.id ?? '',
    character ? boundWorldbookName(character.raw) : '',
  ].join('\u0000');
}

function assertCurrentBoundWorldbook(context: SillyTavernHostContext, worldbookKey: string): string {
  const character = currentCharacter(context);
  if (!character) throw new Error('当前未选择角色卡，已阻止世界书写入');
  const bound = boundWorldbookName(character.raw);
  if (!bound || bound !== worldbookKey) {
    throw new Error('当前角色绑定的世界书已变化，已阻止写入');
  }
  return characterScopeToken(context);
}

function findRawWorldbookEntry(worldInfo: Record<string, unknown>, wantedEntryId: EntryId): Record<string, unknown> {
  const entries = recordValue(worldInfo.entries);
  if (!entries) throw new Error('世界书条目数据格式无效');
  const wanted = String(wantedEntryId);
  for (const [key, value] of Object.entries(entries)) {
    const entry = recordValue(value);
    if (!entry) continue;
    const id = entryId(entry, key);
    if (String(id) === wanted) return entry;
  }
  throw new Error(`目标世界书条目不存在：${wanted}`);
}

export function parseWorldInfoEntries(worldInfo: unknown): WorldInfoEntrySnapshot[] | null {
  const world = recordValue(worldInfo);
  const entries = recordValue(world?.entries);
  if (!world || !entries) return null;

  return Object.entries(entries).flatMap(([key, value]) => {
    const entry = recordValue(value);
    if (!entry) return [];
    return [{
      id: entryId(entry, key),
      comment: stringValue(entry.comment),
      content: typeof entry.content === 'string' ? entry.content : '',
      enabled: entry.disable !== true,
    }];
  });
}

export interface WorldbookWriteAdapter {
  readCurrentWorldbook: () => Promise<WorldbookSnapshot | null>;
  saveWorldbook: () => Promise<void>;
  setEntryEnabled: (entryId: EntryId, enabled: boolean) => Promise<void>;
}

interface PendingWorldbookWrite {
  scopeToken: string;
  worldbookKey: string;
  worldInfo: Record<string, unknown>;
}

/**
 * 世界书写入的唯一适配入口。
 *
 * 适配层不暴露正文编辑能力：setEntryEnabled 只允许改目标条目的 disable，
 * saveWorldbook 使用立即保存，调用方必须在保存后自行复读并校验。
 */
export function createSillyTavernWorldbookAdapter(): WorldbookWriteAdapter {
  let pending: PendingWorldbookWrite | null = null;

  const adapter: WorldbookWriteAdapter & { discardPendingChanges: () => void } = {
    readCurrentWorldbook: async () => {
      const snapshot = await readCurrentHostScope();
      return snapshot.worldbook;
    },

    setEntryEnabled: async (entryId, enabled) => {
      try {
        const context = getContext();
        if (!context || typeof context.loadWorldInfo !== 'function') {
          throw new Error('当前 SillyTavern 无法读取世界书，已阻止写入');
        }
        const worldbook = await readCurrentHostScope();
        if (!worldbook.worldbook) throw new Error(worldbook.message || '当前角色没有可写入的世界书');

        const scopeToken = assertCurrentBoundWorldbook(context, worldbook.worldbook.key);
        if (
          !pending ||
          pending.worldbookKey !== worldbook.worldbook.key ||
          pending.scopeToken !== scopeToken
        ) {
          const loaded = await context.loadWorldInfo(worldbook.worldbook.key);
          pending = {
            scopeToken,
            worldbookKey: worldbook.worldbook.key,
            worldInfo: cloneWorldInfo(loaded),
          };
        }

        const entry = findRawWorldbookEntry(pending.worldInfo, entryId);
        entry.disable = !enabled;
      } catch (error) {
        pending = null;
        throw error;
      }
    },

    saveWorldbook: async () => {
      if (!pending) return;
      const context = getContext();
      if (!context || typeof context.saveWorldInfo !== 'function') {
        throw new Error('当前 SillyTavern 无法保存世界书，已阻止写入');
      }
      const scopeToken = assertCurrentBoundWorldbook(context, pending.worldbookKey);
      if (scopeToken !== pending.scopeToken) {
        pending = null;
        throw new Error('当前角色或世界书已变化，已阻止保存');
      }

      const savedWorldbookKey = pending.worldbookKey;
      const savedWorldInfo = pending.worldInfo;
      try {
        await context.saveWorldInfo(savedWorldbookKey, savedWorldInfo, true);
        pending = null;
      } catch (error) {
        pending = null;
        throw error;
      }
    },
    // 仅供引擎在控制权丢失时撤销未保存批次，不暴露正文或原生字段编辑能力。
    discardPendingChanges: () => { pending = null; },
  };
  return adapter;
}

function unavailableSnapshot(message: string): HostScopeSnapshot {
  return {
    character: null,
    chatId: null,
    message,
    status: 'unavailable',
    worldbook: null,
  };
}

export async function readCurrentHostScope(): Promise<HostScopeSnapshot> {
  const context = getContext();
  if (!context) return unavailableSnapshot('无法读取 SillyTavern 上下文');

  const chatId = stringValue(context.chatId) || null;
  const character = currentCharacter(context);
  if (!character) {
    return {
      character: null,
      chatId,
      message: '当前未选择角色卡',
      status: 'no_character',
      worldbook: null,
    };
  }

  const worldbookName = boundWorldbookName(character.raw);
  if (!worldbookName) {
    return {
      character: character.ref,
      chatId,
      message: '当前角色卡未绑定世界书',
      status: 'no_worldbook',
      worldbook: null,
    };
  }

  if (typeof context.loadWorldInfo !== 'function') {
    return {
      character: character.ref,
      chatId,
      message: '当前 SillyTavern 无法读取角色绑定的世界书',
      status: 'worldbook_unreadable',
      worldbook: null,
    };
  }

  try {
    const worldInfo = await context.loadWorldInfo(worldbookName);
    const entries = parseWorldInfoEntries(worldInfo);
    if (!entries) {
      return {
        character: character.ref,
        chatId,
        message: '当前角色绑定的世界书不存在或无法读取',
        status: 'worldbook_unreadable',
        worldbook: null,
      };
    }

    return {
      character: character.ref,
      chatId,
      message: '',
      status: 'ready',
      worldbook: {
        key: worldbookName,
        name: worldbookName,
        entries,
      },
    };
  } catch {
    return {
      character: character.ref,
      chatId,
      message: '当前角色绑定的世界书不存在或无法读取',
      status: 'worldbook_unreadable',
      worldbook: null,
    };
  }
}

/** 从当前聊天末尾向前读取最近一条 AI 消息，允许用户消息暂时位于末尾。 */
export function readLastAssistantMessageText(): string | null {
  const context = getContext();
  if (!Array.isArray(context?.chat) || context.chat.length === 0) return null;

  for (let index = context.chat.length - 1; index >= 0; index -= 1) {
    const message = recordValue(context.chat[index]);
    if (!message || message.is_user !== false || message.is_system === true) continue;
    if (typeof message.mes === 'string') return message.mes;
  }
  return null;
}

export function watchCurrentHostScope(listener: () => void | Promise<void>): () => void {
  const context = getContext();
  const eventSource = context?.eventSource;
  const eventTypes = context?.eventTypes;
  if (!eventSource?.on || !eventTypes) return () => undefined;

  const events = WATCHED_EVENT_KEYS
    .map(key => eventTypes[key])
    .filter((event): event is string => typeof event === 'string' && event.length > 0);
  const onChange = () => listener();
  for (const event of events) eventSource.on(event, onChange);

  return () => {
    if (!eventSource.removeListener) return;
    for (const event of events) eventSource.removeListener(event, onChange);
  };
}

/** 监听已完成的 AI 消息；流式 token 不会触发该事件。 */
export function watchCurrentHostRuntime(listener: () => void | Promise<void>): () => void {
  const context = getContext();
  const eventSource = context?.eventSource;
  const eventTypes = context?.eventTypes;
  if (!eventSource?.on || !eventTypes) return () => undefined;

  const events = RUNTIME_EVENT_KEYS
    .map(key => eventTypes[key])
    .filter((event): event is string => typeof event === 'string' && event.length > 0);
  const onMessageReceived = () => listener();
  for (const event of events) eventSource.on(event, onMessageReceived);

  return () => {
    if (!eventSource.removeListener) return;
    for (const event of events) eventSource.removeListener(event, onMessageReceived);
  };
}
