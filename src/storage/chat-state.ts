import type { EntryId, StoryTime } from '@/timeline/types';
import { isValidStoryDate } from '@/timeline/date';
import { CHAT_METADATA_KEY, LEGACY_CHAT_METADATA_KEY } from '@/branding';

export const CHAT_TIMELINE_METADATA_KEY = CHAT_METADATA_KEY;
export const MAX_RUNTIME_LOGS = 100;

export type GroupMode = 'auto' | 'manual';
export type RuntimeLogLevel = 'success' | 'info' | 'warning' | 'error';

export interface ChatGroupState {
  activeEntryId?: EntryId;
  manualEnabledEntryIds: readonly EntryId[];
  mode: GroupMode;
}

export interface ChatRollbackState {
  from: StoryTime;
  to: StoryTime;
}

export interface ChatRuntimeLog {
  category: string;
  description: string;
  id: string;
  level: RuntimeLogLevel;
  occurredAt: string;
  title: string;
}

export interface ChatTimelineState {
  currentTime?: StoryTime;
  groups: Record<string, ChatGroupState>;
  logs: readonly ChatRuntimeLog[];
  pendingRollback?: ChatRollbackState;
  worldbookKey: string | null;
}

interface ChatStorageContext {
  chatMetadata?: unknown;
  saveChat?: () => Promise<unknown> | unknown;
  saveMetadata?: () => Promise<unknown> | unknown;
  saveMetadataDebounced?: () => void;
  updateChatMetadata?: (newValues: Record<string, unknown>, reset?: boolean) => void;
}

interface ChatStorageApi {
  getContext: () => ChatStorageContext;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getContext(): ChatStorageContext | null {
  try {
    return (globalThis as unknown as { SillyTavern?: ChatStorageApi }).SillyTavern?.getContext() ?? null;
  } catch {
    return null;
  }
}

function isEntryId(value: unknown): value is EntryId {
  return (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isFinite(value));
}

function isStoryTime(value: unknown): value is StoryTime {
  const time = recordValue(value);
  if (!time || typeof time.raw !== 'string' || time.raw.length === 0) return false;

  const hasHour = Object.hasOwn(time, 'hour');
  const hasMinute = Object.hasOwn(time, 'minute');
  if (hasHour !== hasMinute) return false;
  if (hasHour && (
    typeof time.hour !== 'number' ||
    !Number.isInteger(time.hour) ||
    time.hour < 0 ||
    time.hour > 23 ||
    typeof time.minute !== 'number' ||
    !Number.isInteger(time.minute) ||
    time.minute < 0 ||
    time.minute > 59
  )) return false;

  return (
    typeof time.year === 'number' &&
    typeof time.month === 'number' &&
    typeof time.day === 'number' &&
    isValidStoryDate({ year: time.year, month: time.month, day: time.day })
  );
}

function isRuntimeLog(value: unknown): value is ChatRuntimeLog {
  const log = recordValue(value);
  return Boolean(
    log &&
    typeof log.category === 'string' &&
    typeof log.description === 'string' &&
    typeof log.id === 'string' &&
    (log.level === 'success' || log.level === 'info' || log.level === 'warning' || log.level === 'error') &&
    typeof log.occurredAt === 'string' &&
    typeof log.title === 'string'
  );
}

function isGroupState(value: unknown): value is ChatGroupState {
  const group = recordValue(value);
  if (!group || (group.mode !== 'auto' && group.mode !== 'manual')) return false;
  if (!Array.isArray(group.manualEnabledEntryIds) || !group.manualEnabledEntryIds.every(isEntryId)) return false;

  const ids = group.manualEnabledEntryIds.map(String);
  if (new Set(ids).size !== ids.length) return false;
  return !Object.hasOwn(group, 'activeEntryId') || isEntryId(group.activeEntryId);
}

function cloneStoryTime(time: StoryTime): StoryTime {
  return time.hour === undefined || time.minute === undefined
    ? { year: time.year, month: time.month, day: time.day, raw: time.raw }
    : {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      raw: time.raw,
    };
}

function cloneEntryId(entryId: EntryId): EntryId {
  return typeof entryId === 'string' ? entryId : entryId;
}

function cloneGroupState(group: ChatGroupState): ChatGroupState {
  return {
    ...(group.activeEntryId === undefined ? {} : { activeEntryId: cloneEntryId(group.activeEntryId) }),
    manualEnabledEntryIds: group.manualEnabledEntryIds.map(cloneEntryId),
    mode: group.mode,
  };
}

function cloneChatState(state: ChatTimelineState): ChatTimelineState {
  return {
    ...(state.currentTime ? { currentTime: cloneStoryTime(state.currentTime) } : {}),
    groups: Object.fromEntries(Object.entries(state.groups).map(([id, group]) => [id, cloneGroupState(group)])),
    logs: state.logs.map(log => ({ ...log })),
    ...(state.pendingRollback ? {
      pendingRollback: {
        from: cloneStoryTime(state.pendingRollback.from),
        to: cloneStoryTime(state.pendingRollback.to),
      },
    } : {}),
    worldbookKey: state.worldbookKey,
  };
}

export function isChatTimelineState(value: unknown): value is ChatTimelineState {
  const state = recordValue(value);
  if (!state || (state.worldbookKey !== null && typeof state.worldbookKey !== 'string')) return false;
  const groups = recordValue(state.groups);
  if (!groups || !Object.entries(groups).every(([id, group]) => id.length > 0 && isGroupState(group))) {
    return false;
  }
  if (!Array.isArray(state.logs) || state.logs.length > MAX_RUNTIME_LOGS || !state.logs.every(isRuntimeLog)) {
    return false;
  }
  if (Object.hasOwn(state, 'currentTime') && state.currentTime !== undefined && !isStoryTime(state.currentTime)) {
    return false;
  }
  if (Object.hasOwn(state, 'pendingRollback') && state.pendingRollback !== undefined) {
    const pending = recordValue(state.pendingRollback);
    if (
      !state.currentTime ||
      !pending ||
      !isStoryTime(pending.from) ||
      !isStoryTime(pending.to)
    ) return false;
  }
  return true;
}

export function createChatTimelineState(
  worldbookKey: string | null,
  groupIds: readonly string[] = [],
): ChatTimelineState {
  const groups: Record<string, ChatGroupState> = {};
  for (const groupId of [...new Set(groupIds)].filter(id => id.length > 0)) {
    groups[groupId] = { manualEnabledEntryIds: [], mode: 'auto' };
  }
  return { groups, logs: [], worldbookKey };
}

/** 将当前世界书的组映射合并进聊天状态，保留已有的聊天级模式与开关记录。 */
export function bindChatTimelineState(
  state: ChatTimelineState,
  worldbookKey: string | null,
  groupIds: readonly string[] = [],
): ChatTimelineState {
  const next = cloneChatState(state);
  if (worldbookKey) next.worldbookKey = worldbookKey;

  const uniqueGroupIds = [...new Set(groupIds)].filter(id => id.length > 0);
  if (uniqueGroupIds.length === 0) return next;

  next.groups = Object.fromEntries(uniqueGroupIds.map(groupId => [
    groupId,
    next.groups[groupId] ? cloneGroupState(next.groups[groupId]) : { manualEnabledEntryIds: [], mode: 'auto' },
  ]));
  return next;
}

export function loadChatTimelineState(): ChatTimelineState | null {
  const context = getContext();
  const metadata = recordValue(context?.chatMetadata);
  const current = metadata?.[CHAT_TIMELINE_METADATA_KEY];
  if (isChatTimelineState(current)) return cloneChatState(current);
  const legacy = metadata?.[LEGACY_CHAT_METADATA_KEY];
  return isChatTimelineState(legacy) ? cloneChatState(legacy) : null;
}

export function saveChatTimelineState(state: ChatTimelineState): boolean {
  if (!isChatTimelineState(state)) return false;
  const context = getContext();
  if (!context) return false;

  const next = cloneChatState(state);
  try {
    if (typeof context.updateChatMetadata === 'function') {
      const updates: Record<string, unknown> = { [CHAT_TIMELINE_METADATA_KEY]: next };
      updates[LEGACY_CHAT_METADATA_KEY] = undefined;
      context.updateChatMetadata(updates);
    } else {
      const metadata = recordValue(context.chatMetadata);
      if (!metadata) return false;
      metadata[CHAT_TIMELINE_METADATA_KEY] = next;
      delete metadata[LEGACY_CHAT_METADATA_KEY];
    }

    if (typeof context.saveMetadataDebounced === 'function') {
      context.saveMetadataDebounced();
      return true;
    }
    if (typeof context.saveMetadata === 'function') {
      void Promise.resolve(context.saveMetadata()).catch(() => undefined);
      return true;
    }
    if (typeof context.saveChat === 'function') {
      void Promise.resolve(context.saveChat()).catch(() => undefined);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function appendChatRuntimeLog(state: ChatTimelineState, log: ChatRuntimeLog): ChatTimelineState {
  if (!isRuntimeLog(log)) return cloneChatState(state);
  return {
    ...cloneChatState(state),
    logs: [...state.logs, { ...log }].slice(-MAX_RUNTIME_LOGS),
  };
}

export function setChatGroupMode(
  state: ChatTimelineState,
  groupId: string,
  mode: GroupMode,
): ChatTimelineState {
  if (!groupId) return cloneChatState(state);
  const next = cloneChatState(state);
  next.groups[groupId] = next.groups[groupId] ?? { manualEnabledEntryIds: [], mode: 'auto' };
  next.groups[groupId] = { ...next.groups[groupId], mode };
  return next;
}

export function setChatGroupActiveEntry(
  state: ChatTimelineState,
  groupId: string,
  entryId: EntryId | undefined,
): ChatTimelineState {
  if (!groupId) return cloneChatState(state);
  const next = cloneChatState(state);
  const group = next.groups[groupId] ?? { manualEnabledEntryIds: [], mode: 'auto' as const };
  next.groups[groupId] = { ...group };
  if (entryId === undefined) delete next.groups[groupId].activeEntryId;
  else next.groups[groupId].activeEntryId = entryId;
  return next;
}

export function setChatManualEntryEnabled(
  state: ChatTimelineState,
  groupId: string,
  entryId: EntryId,
  enabled: boolean,
): ChatTimelineState {
  if (!groupId) return cloneChatState(state);
  const next = cloneChatState(state);
  const group = next.groups[groupId] ?? { manualEnabledEntryIds: [], mode: 'manual' as const };
  const key = String(entryId);
  const ids = group.manualEnabledEntryIds.filter(id => String(id) !== key);
  if (enabled) ids.push(entryId);
  next.groups[groupId] = { ...group, manualEnabledEntryIds: ids };
  return next;
}

export function clearChatRuntimeLogs(state: ChatTimelineState): ChatTimelineState {
  return { ...cloneChatState(state), logs: [] };
}
