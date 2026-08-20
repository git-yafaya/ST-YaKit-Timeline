import type { ChatGroupState, ChatTimelineState } from '@/storage/chat-state';
import type { WorldbookTimelineConfig, TimelineGroupConfig } from '@/storage/worldbook-config';
import type { WorldbookWriteAdapter, WorldbookSnapshot } from '@/st/sillytavern-adapter';
import { matchTimelineEntry } from '@/timeline/matcher';
import type { EntryId, StoryTime } from '@/timeline/types';

export type TimelineSyncStatus = 'blocked' | 'error' | 'skipped' | 'synced' | 'unchanged';

export interface TimelineGroupSyncResult {
  changed: boolean;
  groupId: string;
  status: TimelineSyncStatus;
  targetEntryId?: EntryId;
  message: string;
}

export interface TimelineSyncResult {
  changed: boolean;
  groups: readonly TimelineGroupSyncResult[];
  hasFailure: boolean;
}

export interface TimelineSyncOptions {
  adapter: WorldbookWriteAdapter;
  config: WorldbookTimelineConfig;
  currentTime: StoryTime;
  state: ChatTimelineState;
  hasControl?: () => boolean;
}

export interface ManualEntryToggleOptions {
  adapter: WorldbookWriteAdapter;
  config: WorldbookTimelineConfig;
  entryId: EntryId;
  enabled: boolean;
  groupId: string;
  hasControl?: () => boolean;
}

export interface ManualEntryToggleResult {
  changed: boolean;
  enabled: boolean;
  message: string;
  status: 'blocked' | 'error' | 'synced' | 'unchanged';
}

function idKey(entryId: EntryId): string {
  return String(entryId);
}

function groupState(state: ChatTimelineState, groupId: string): ChatGroupState {
  return state.groups[groupId] ?? { manualEnabledEntryIds: [], mode: 'auto' };
}

function managedEntries(group: TimelineGroupConfig): TimelineGroupConfig['entries'] {
  return group.entries.filter(entry => entry.managed);
}

function worldbookEntriesById(worldbook: WorldbookSnapshot): Map<string, WorldbookSnapshot['entries'][number]> {
  return new Map(worldbook.entries.map(entry => [idKey(entry.id), entry]));
}

function currentWorldbookError(worldbook: WorldbookSnapshot | null, expectedKey: string): string | null {
  if (!worldbook) return '当前角色绑定的世界书不可读取，已阻止自动切换。';
  if (worldbook.key !== expectedKey) return '当前角色绑定的世界书已变化，已阻止自动切换。';
  return null;
}

function desiredStates(
  group: TimelineGroupConfig,
  targetEntryId: EntryId,
): Map<string, { entryId: EntryId; enabled: boolean }> {
  const targetKey = idKey(targetEntryId);
  return new Map(
    managedEntries(group).map(entry => [idKey(entry.entryId), {
      entryId: entry.entryId,
      enabled: idKey(entry.entryId) === targetKey,
    }]),
  );
}

function verifyDesired(
  worldbook: WorldbookSnapshot | null,
  expectedKey: string,
  desired: Map<string, { entryId: EntryId; enabled: boolean }>,
): string | null {
  const scopeError = currentWorldbookError(worldbook, expectedKey);
  if (scopeError) return scopeError;
  const entries = worldbookEntriesById(worldbook!);
  for (const [key, state] of desired) {
    const actual = entries.get(key);
    if (!actual) return `目标世界书条目不存在：${String(state.entryId)}`;
    if (actual.enabled !== state.enabled) {
      return `条目 ${String(state.entryId)} 写入后状态不一致。`;
    }
  }
  return null;
}

function discardPendingChanges(adapter: WorldbookWriteAdapter): void {
  const internal = adapter as WorldbookWriteAdapter & { discardPendingChanges?: () => void };
  internal.discardPendingChanges?.();
}

async function writeAndVerify(
  adapter: WorldbookWriteAdapter,
  expectedKey: string,
  desired: Map<string, { entryId: EntryId; enabled: boolean }>,
  actual: Map<string, WorldbookSnapshot['entries'][number]>,
  hasControl: () => boolean,
): Promise<{ changed: boolean; error: string | null }> {
  if (!hasControl()) return { changed: false, error: '当前标签页没有世界书控制权，已阻止写入。' };

  const changes = [...desired.values()].filter(state => actual.get(idKey(state.entryId))?.enabled !== state.enabled);
  if (changes.length === 0) return { changed: false, error: null };

  try {
    for (const change of changes) {
      if (!hasControl()) {
        discardPendingChanges(adapter);
        return { changed: false, error: '写入过程中控制权已丢失，已停止后续写入。' };
      }
      await adapter.setEntryEnabled(change.entryId, change.enabled);
    }
    await adapter.saveWorldbook();
  } catch (error) {
    discardPendingChanges(adapter);
    return { changed: false, error: error instanceof Error ? error.message : '世界书保存失败。' };
  }

  let reread = await adapter.readCurrentWorldbook();
  let verificationError = verifyDesired(reread, expectedKey, desired);
  if (!verificationError) return { changed: true, error: null };

  // 外部世界书编辑或缓存延迟可能造成一次不一致；按同一目标集合重试一次。
  if (!hasControl()) {
    discardPendingChanges(adapter);
    return { changed: true, error: `${verificationError}；控制权已丢失，未重试。` };
  }
  try {
    const rereadEntries = reread ? worldbookEntriesById(reread) : new Map();
    for (const state of desired.values()) {
      if (rereadEntries.get(idKey(state.entryId))?.enabled !== state.enabled) {
        await adapter.setEntryEnabled(state.entryId, state.enabled);
      }
    }
    await adapter.saveWorldbook();
  } catch (error) {
    discardPendingChanges(adapter);
    return {
      changed: true,
      error: `${verificationError}；重试保存失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }

  reread = await adapter.readCurrentWorldbook();
  verificationError = verifyDesired(reread, expectedKey, desired);
  return { changed: true, error: verificationError };
}

function duplicateManagedEntryGroups(
  groups: readonly TimelineGroupConfig[],
  state: ChatTimelineState,
): Set<string> {
  const owners = new Map<string, string[]>();
  for (const group of groups) {
    if (groupState(state, group.id).mode !== 'auto' || group.blocked) continue;
    for (const entry of managedEntries(group)) {
      const list = owners.get(idKey(entry.entryId)) ?? [];
      list.push(group.id);
      owners.set(idKey(entry.entryId), list);
    }
  }
  return new Set([...owners.values()].filter(ids => ids.length > 1).flat());
}

async function syncGroup(
  options: TimelineSyncOptions,
  group: TimelineGroupConfig,
  duplicateGroups: Set<string>,
): Promise<TimelineGroupSyncResult> {
  const state = groupState(options.state, group.id);
  if (state.mode !== 'auto') {
    return { changed: false, groupId: group.id, status: 'skipped', message: '当前分组为手动模式。' };
  }
  const entries = managedEntries(group);
  if (entries.length === 0) {
    return { changed: false, groupId: group.id, status: 'skipped', message: '当前分组没有受管条目。' };
  }
  if (group.blocked) {
    return {
      changed: false,
      groupId: group.id,
      status: 'blocked',
      message: group.blockReason || '当前分组存在未处理配置异常。',
    };
  }
  if (duplicateGroups.has(group.id)) {
    return {
      changed: false,
      groupId: group.id,
      status: 'blocked',
      message: '同一世界书条目被多个自动分组纳管，已停止相关分组切换。',
    };
  }

  const match = matchTimelineEntry(options.currentTime, { entries });
  if (match.status !== 'matched') {
    return {
      changed: false,
      groupId: group.id,
      status: 'blocked',
      message: match.reason,
    };
  }

  const worldbook = await options.adapter.readCurrentWorldbook();
  const scopeError = currentWorldbookError(worldbook, options.config.worldbookKey);
  if (scopeError) {
    return { changed: false, groupId: group.id, status: 'blocked', message: scopeError };
  }

  const actual = worldbookEntriesById(worldbook!);
  for (const entry of entries) {
    if (!actual.has(idKey(entry.entryId))) {
      return {
        changed: false,
        groupId: group.id,
        status: 'blocked',
        targetEntryId: match.entry.entryId,
        message: `受管条目 ${String(entry.entryId)} 已不存在，已停止该分组切换。`,
      };
    }
  }

  const desired = desiredStates(group, match.entry.entryId);
  const write = await writeAndVerify(
    options.adapter,
    options.config.worldbookKey,
    desired,
    actual,
    options.hasControl ?? (() => true),
  );
  if (write.error) {
    return {
      changed: write.changed,
      groupId: group.id,
      status: 'error',
      targetEntryId: match.entry.entryId,
      message: write.error,
    };
  }
  return {
    changed: write.changed,
    groupId: group.id,
    status: write.changed ? 'synced' : 'unchanged',
    targetEntryId: match.entry.entryId,
    message: write.changed ? `已切换至「${match.entry.entryId}」。` : '目标开关状态已符合当前故事时间。',
  };
}

/** 自动模式的唯一运行入口：每组独立处理，单组异常不会中断其他组。 */
export async function syncAutomaticTimeline(options: TimelineSyncOptions): Promise<TimelineSyncResult> {
  const duplicateGroups = duplicateManagedEntryGroups(options.config.groups, options.state);
  const groups: TimelineGroupSyncResult[] = [];
  for (const group of options.config.groups) {
    groups.push(await syncGroup(options, group, duplicateGroups));
  }
  return {
    changed: groups.some(group => group.changed),
    groups,
    hasFailure: groups.some(group => group.status === 'blocked' || group.status === 'error'),
  };
}

export async function toggleManualTimelineEntry(
  options: ManualEntryToggleOptions,
): Promise<ManualEntryToggleResult> {
  const group = options.config.groups.find(item => item.id === options.groupId);
  if (!group) return { changed: false, enabled: options.enabled, status: 'blocked', message: '时间线分组不存在。' };
  if (group.blocked) {
    return {
      changed: false,
      enabled: options.enabled,
      status: 'blocked',
      message: group.blockReason || '当前分组存在未处理配置异常。',
    };
  }
  const entry = managedEntries(group).find(item => idKey(item.entryId) === idKey(options.entryId));
  if (!entry) {
    return { changed: false, enabled: options.enabled, status: 'blocked', message: '目标条目不是当前分组的受管条目。' };
  }
  if (!(options.hasControl ?? (() => true))()) {
    return { changed: false, enabled: options.enabled, status: 'blocked', message: '当前标签页没有世界书控制权，已阻止写入。' };
  }

  const worldbook = await options.adapter.readCurrentWorldbook();
  const scopeError = currentWorldbookError(worldbook, options.config.worldbookKey);
  if (scopeError) return { changed: false, enabled: options.enabled, status: 'blocked', message: scopeError };
  const actual = worldbookEntriesById(worldbook!);
  if (!actual.has(idKey(entry.entryId))) {
    return { changed: false, enabled: options.enabled, status: 'blocked', message: '目标世界书条目已不存在。' };
  }

  const desired = new Map([[idKey(entry.entryId), { entryId: entry.entryId, enabled: options.enabled }]]);
  const write = await writeAndVerify(
    options.adapter,
    options.config.worldbookKey,
    desired,
    actual,
    options.hasControl ?? (() => true),
  );
  if (write.error) return { changed: write.changed, enabled: options.enabled, status: 'error', message: write.error };
  return {
    changed: write.changed,
    enabled: options.enabled,
    status: write.changed ? 'synced' : 'unchanged',
    message: write.changed ? '手动开关已保存并复读确认。' : '目标条目已处于所选状态。',
  };
}
