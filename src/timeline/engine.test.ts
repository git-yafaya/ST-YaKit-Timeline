import { describe, expect, it } from 'vitest';
import type { ChatTimelineState } from '@/storage/chat-state';
import type { TimelineGroupConfig, WorldbookTimelineConfig } from '@/storage/worldbook-config';
import type { WorldbookSnapshot, WorldbookWriteAdapter } from '@/st/sillytavern-adapter';
import { syncAutomaticTimeline, toggleManualTimelineEntry } from '@/timeline/engine';

function worldbook(entries: Array<{ id: number; enabled: boolean }>): WorldbookSnapshot {
  return {
    key: 'book',
    name: 'book',
    entries: entries.map(entry => ({
      id: entry.id,
      comment: `entry-${entry.id}`,
      content: `content-${entry.id}`,
      enabled: entry.enabled,
    })),
  };
}

function group(id: string, entryIds: number[]): TimelineGroupConfig {
  return {
    id,
    name: id,
    nameLocked: false,
    blocked: false,
    entries: entryIds.map((entryId, index) => ({
      entryId,
      boundaryDate: index === 0 ? '0420-01-01' : undefined,
      confidence: 1,
      contentHash: String(entryId),
      contentStartDate: index === 0 ? '0419-01-01' : '0420-01-01',
      displayTitle: `entry-${entryId}`,
      effectiveEndDate: index === 0 && entryIds.length > 1 ? '0419-12-31' : null,
      effectiveStartDate: index === 0 ? '0419-01-01' : '0420-01-01',
      managed: true,
      manualFields: [],
      originalComment: `entry-${entryId}`,
      stale: false,
      titleLocked: false,
      warnings: [],
    })),
  };
}

function state(groupIds: string[], modes: Record<string, 'auto' | 'manual'> = {}): ChatTimelineState {
  return {
    groups: Object.fromEntries(groupIds.map(id => [id, {
      manualEnabledEntryIds: [],
      mode: modes[id] ?? 'auto',
    }])),
    logs: [],
    worldbookKey: 'book',
  };
}

function config(groups: readonly TimelineGroupConfig[]): WorldbookTimelineConfig {
  return { groups, updatedAt: 1, worldbookKey: 'book', worldbookName: 'book' };
}

function fakeAdapter(initial: WorldbookSnapshot): WorldbookWriteAdapter & { saveCount: number } {
  let current = initial;
  let pending = current;
  const adapter: WorldbookWriteAdapter & { saveCount: number } = {
    saveCount: 0,
    readCurrentWorldbook: async () => current,
    setEntryEnabled: async (entryId, enabled) => {
      pending = {
        ...pending,
        entries: pending.entries.map(entry => String(entry.id) === String(entryId) ? { ...entry, enabled } : entry),
      };
    },
    saveWorldbook: async () => {
      adapter.saveCount += 1;
      current = pending;
    },
  };
  return adapter;
}

describe('timeline engine', () => {
  it('自动组只切换受管条目，并保存后保持单组隔离', async () => {
    const adapter = fakeAdapter(worldbook([
      { id: 1, enabled: true },
      { id: 2, enabled: true },
      { id: 3, enabled: true },
    ]));
    const result = await syncAutomaticTimeline({
      adapter,
      config: config([group('main', [1, 2]), group('other', [3])]),
      currentTime: { year: 419, month: 6, day: 1, raw: '0419-06-01' },
      state: state(['main', 'other']),
    });

    expect(result.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: 'main', status: 'synced', targetEntryId: 1 }),
      expect.objectContaining({ groupId: 'other', status: 'unchanged', targetEntryId: 3 }),
    ]));
    expect(adapter.saveCount).toBe(1);
    expect((await adapter.readCurrentWorldbook())?.entries.map(entry => [entry.id, entry.enabled])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
  });

  it('重复纳管会阻断相关自动组而不写入', async () => {
    const adapter = fakeAdapter(worldbook([{ id: 1, enabled: true }]));
    const result = await syncAutomaticTimeline({
      adapter,
      config: config([group('a', [1]), group('b', [1])]),
      currentTime: { year: 419, month: 6, day: 1, raw: '0419-06-01' },
      state: state(['a', 'b']),
    });
    expect(result.hasFailure).toBe(true);
    expect(result.groups.every(item => item.status === 'blocked')).toBe(true);
    expect(adapter.saveCount).toBe(0);
  });

  it('手动组只写入用户点选的单个条目', async () => {
    const adapter = fakeAdapter(worldbook([{ id: 1, enabled: false }, { id: 2, enabled: true }]));
    const result = await toggleManualTimelineEntry({
      adapter,
      config: config([group('main', [1, 2])]),
      entryId: 1,
      enabled: true,
      groupId: 'main',
      hasControl: () => true,
    });
    expect(result.status).toBe('synced');
    expect((await adapter.readCurrentWorldbook())?.entries.map(entry => entry.enabled)).toEqual([true, true]);
  });
});
