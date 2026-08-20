import { describe, expect, it } from 'vitest';
import type { WorldbookTimelineConfig } from '@/storage/worldbook-config';
import type { WorldbookSnapshot } from '@/st/sillytavern-adapter';
import { buildOverviewGroupSummaries, buildTimelineGroupDetails } from '@/ui/worldbook-view';

const config: WorldbookTimelineConfig = {
  worldbookKey: 'book',
  worldbookName: 'book',
  updatedAt: 1,
  groups: [{
    id: 'group-1',
    name: '主线',
    nameLocked: false,
    blocked: false,
    entries: [{
      entryId: 1,
      originalComment: '旧名称',
      contentHash: 'hash',
      displayTitle: '第一篇',
      titleLocked: false,
      effectiveStartDate: '419-01-01',
      effectiveEndDate: null,
      confidence: 0.9,
      warnings: [],
      managed: true,
      manualFields: [],
      stale: false,
    }],
  }],
};

const worldbook: WorldbookSnapshot = {
  key: 'book',
  name: 'book',
  entries: [{ id: 1, comment: '当前名称', content: '正文', enabled: true }],
};

describe('worldbook config UI projections', () => {
  it('shows the actual enabled state from the current worldbook snapshot', () => {
    expect(buildOverviewGroupSummaries(config, worldbook)).toEqual([expect.objectContaining({
      name: '主线',
      mode: 'auto',
      activeEntry: expect.objectContaining({ title: '第一篇', rangeLabel: '419-01-01 ～ ∞' }),
    })]);
    expect(buildTimelineGroupDetails(config, worldbook)[0]).toMatchObject({
      activeEntryTitle: '第一篇',
      entries: [{
        originalComment: '当前名称',
        contentPreview: '正文',
        enabled: true,
        manuallyModified: false,
        pending: false,
        state: 'active',
      }],
    });
  });

  it('marks a deleted native entry as a visible warning instead of guessing a replacement', () => {
    const emptyBook = { ...worldbook, entries: [] };
    expect(buildOverviewGroupSummaries(config, emptyBook)[0].warning).toContain('不存在');
    expect(buildTimelineGroupDetails(config, emptyBook)[0].entries[0]).toMatchObject({
      enabled: false,
      state: 'warning',
      warning: expect.stringContaining('不存在'),
    });
  });

  it('does not project a configuration into a different worldbook', () => {
    expect(buildOverviewGroupSummaries(config, { ...worldbook, key: 'other' })).toEqual([]);
    expect(buildTimelineGroupDetails(config, { ...worldbook, key: 'other' })).toEqual([]);
  });

  it('exposes pending and manual flags for timeline filters', () => {
    const flagged = {
      ...config,
      groups: [{
        ...config.groups[0],
        entries: [{
          ...config.groups[0].entries[0],
          confidence: 0.6,
          manualFields: ['displayTitle'],
          titleLocked: false,
        }],
      }],
    };
    expect(buildTimelineGroupDetails(flagged, worldbook)[0].entries[0]).toMatchObject({
      manuallyModified: true,
      pending: true,
    });
  });
});
