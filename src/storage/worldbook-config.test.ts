import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWorldbookTimelineConfig,
  detectWorldbookConfigStale,
  getDraftApplicationIssue,
  loadWorldbookTimelineConfig,
  mergeWorldbookTimelineConfig,
  deleteTimelineGroup,
  createTimelineGroup,
  saveWorldbookTimelineConfig,
} from '@/storage/worldbook-config';
import type { WorldbookSnapshot } from '@/st/sillytavern-adapter';
import type { AnalysisDraft } from '@/ui/pages/analysis';

const worldbook: WorldbookSnapshot = {
  key: '当前世界书',
  name: '当前世界书',
  entries: [
    { id: 17, comment: '世界线-17', content: '第一段正文', enabled: true },
    { id: 18, comment: '世界线-18', content: '第二段正文', enabled: false },
  ],
};

const draft: AnalysisDraft = {
  candidateCount: 2,
  groups: [{
    id: 'ai-group-1',
    name: '主线剧情',
    entries: [
      {
        entryId: 17,
        title: '米里希昂篇',
        sourceComment: '世界线-17',
        contentStartDate: '419-11-10',
        boundaryDate: '419-12-26',
        confidence: 'high',
        selected: true,
        warnings: [],
      },
      {
        entryId: 18,
        title: '西部港篇',
        sourceComment: '世界线-18',
        contentStartDate: '420-02-10',
        confidence: 'high',
        selected: true,
        warnings: [],
      },
    ],
  }],
};

function installStorage(initial: Record<string, unknown> = {}) {
  const saveSettingsDebounced = vi.fn();
  Object.defineProperty(globalThis, 'SillyTavern', {
    configurable: true,
    value: { getContext: () => ({ extensionSettings: initial, saveSettingsDebounced }) },
    writable: true,
  });
  return { extensionSettings: initial, saveSettingsDebounced };
}

afterEach(() => {
  globalThis.SillyTavern = undefined;
});

describe('worldbook timeline config', () => {
  it('derives adjacent effective ranges and hashes source content without changing native entries', async () => {
    const original = structuredClone(worldbook);
    const config = await buildWorldbookTimelineConfig(draft, worldbook, 12345);

    expect(config).toMatchObject({
      worldbookKey: '当前世界书',
      worldbookName: '当前世界书',
      updatedAt: 12345,
      groups: [{
        id: 'ai-group-1',
        name: '主线剧情',
        blocked: false,
        entries: [
          { entryId: 17, effectiveStartDate: '419-11-10', effectiveEndDate: '419-12-25', managed: true },
          { entryId: 18, effectiveStartDate: '419-12-26', effectiveEndDate: null, managed: true },
        ],
      }],
    });
    expect(config.groups[0].entries[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(worldbook).toEqual(original);
  });

  it('blocks unresolved confidence, warnings, missing boundaries, and unknown IDs', () => {
    const clone = structuredClone(draft);
    clone.groups[0].entries[0].confidence = 'medium';
    expect(getDraftApplicationIssue(clone, worldbook)).toContain('待确认');

    clone.groups[0].entries[0].confidence = 'high';
    clone.groups[0].entries[0].warnings = ['日期异常'];
    expect(getDraftApplicationIssue(clone, worldbook)).toContain('未处理警告');

    clone.groups[0].entries[0].warnings = [];
    clone.groups[0].entries[0].boundaryDate = undefined;
    expect(getDraftApplicationIssue(clone, worldbook)).toContain('切换边界');

    clone.groups[0].entries[0].boundaryDate = '419-12-26';
    clone.groups[0].entries[0].entryId = 999;
    expect(getDraftApplicationIssue(clone, worldbook)).toContain('不在当前世界书');
  });

  it('requires explicit confirmation before managing a selected low-confidence entry', () => {
    const clone = structuredClone(draft);
    clone.groups[0].entries[0].confidence = 'low';
    expect(getDraftApplicationIssue(clone, worldbook)).toContain('尚未人工确认');
    clone.groups[0].entries[0].manuallyLocked = true;
    expect(getDraftApplicationIssue(clone, worldbook)).toBeNull();
  });

  it('saves only the current worldbook slot and preserves unrelated settings', async () => {
    const { extensionSettings, saveSettingsDebounced } = installStorage({
      yakit_timeline: {
        globalSettings: { theme: 'dark' },
        worldbooks: { other: { worldbookKey: 'other', groups: [] } },
        unknown: true,
      },
    });
    const config = await buildWorldbookTimelineConfig(draft, worldbook, 12345);
    expect(saveWorldbookTimelineConfig(config)).toBe(true);
    expect(extensionSettings).toMatchObject({
      yakit_timeline: {
        globalSettings: { theme: 'dark' },
        worldbooks: {
          other: { worldbookKey: 'other', groups: [] },
          当前世界书: config,
        },
        unknown: true,
      },
    });
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
    expect(loadWorldbookTimelineConfig('当前世界书')).toEqual(config);
  });

  it('restores the previous namespace when scheduling persistence fails', async () => {
    const extensionSettings: Record<string, unknown> = {
      yakit_timeline: { globalSettings: { theme: 'light' } },
    };
    const previous = extensionSettings.yakit_timeline;
    Object.defineProperty(globalThis, 'SillyTavern', {
      configurable: true,
      value: {
        getContext: () => ({
          extensionSettings,
          saveSettingsDebounced: () => { throw new Error('save failed'); },
        }),
      },
      writable: true,
    });
    const config = await buildWorldbookTimelineConfig(draft, worldbook);
    expect(saveWorldbookTimelineConfig(config)).toBe(false);
    expect(extensionSettings.yakit_timeline).toBe(previous);
  });

  it('重新分析保留人工锁定字段，并把未重新识别的旧映射安全停用', async () => {
    const previous = await buildWorldbookTimelineConfig(draft, worldbook, 12345);
    const locked = previous.groups[0].entries[0];
    const preserved = {
      ...previous,
      groups: [{
        ...previous.groups[0],
        entries: [{
          ...locked,
          displayTitle: '人工标题',
          manualFields: ['displayTitle'],
          titleLocked: true,
        }, previous.groups[0].entries[1]],
      }],
    };
    const nextDraft: AnalysisDraft = {
      candidateCount: 1,
      groups: [{
        id: 'ai-group-1',
        name: '主线剧情',
        entries: [{
          ...draft.groups[0].entries[0],
          title: 'AI 新标题',
        }],
      }],
    };

    const merged = await mergeWorldbookTimelineConfig(preserved, nextDraft, worldbook, 99999);
    expect(merged.groups[0].entries[0]).toMatchObject({ displayTitle: '人工标题', titleLocked: true });
    expect(merged.groups[0].entries[1]).toMatchObject({ entryId: 18, managed: false, stale: true });
    expect(merged.groups[0].blocked).toBe(true);
  });

  it('分组编辑不删除世界书条目，删除组会移到未分组并停止纳管', async () => {
    const previous = await buildWorldbookTimelineConfig(draft, worldbook, 12345);
    const withManual = createTimelineGroup(previous, '人工组');
    const deleted = deleteTimelineGroup(withManual, 'ai-group-1');
    const ungrouped = deleted.groups.find(group => group.id === '__ungrouped__');
    expect(ungrouped?.entries).toHaveLength(2);
    expect(ungrouped?.entries.every(entry => entry.managed === false)).toBe(true);
    expect(deleted.groups.some(group => group.id === 'ai-group-1')).toBe(false);
  });

  it('检测正文 Hash 变化但保留旧配置继续运行', async () => {
    const previous = await buildWorldbookTimelineConfig(draft, worldbook, 12345);
    const changedBook = { ...worldbook, entries: worldbook.entries.map(entry => entry.id === 17 ? { ...entry, content: '改过的正文' } : entry) };
    const result = await detectWorldbookConfigStale(previous, changedBook);
    expect(result.changed).toBe(true);
    expect(result.config.groups[0].entries[0]).toMatchObject({ managed: true, stale: true });
    expect(result.config.groups[0].entries[0].warnings[0]).toContain('正文');
  });
});
