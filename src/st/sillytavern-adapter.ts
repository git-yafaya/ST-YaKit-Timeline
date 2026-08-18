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
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface SillyTavernHostContext {
  characterId?: unknown;
  characters?: unknown;
  chatId?: unknown;
  eventSource?: HostEventSource;
  eventTypes?: Record<string, unknown>;
  loadWorldInfo?: (name: string) => Promise<unknown>;
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

export function watchCurrentHostScope(listener: () => void): () => void {
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
