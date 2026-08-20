import { describe, expect, it, vi } from 'vitest';
import type { WorldInfoEntrySnapshot } from '@/st/sillytavern-adapter';
import {
  AnalysisValidationError,
  isQuickScanCandidate,
  runTimelineScan,
  selectScanEntries,
  validateAnalysisDraft,
} from '@/analysis/scanner';

function entry(id: string | number, comment: string, content: string): WorldInfoEntrySnapshot {
  return { id, comment, content, enabled: false };
}

const sources = [
  entry(1, '第一章', '<world_timeline>424-05-01 事件 A\n424-05-12 事件 B</world_timeline>'),
  entry('2', '普通设定', '这里没有日期。'),
];

describe('timeline analysis scanner', () => {
  it('filters quick candidates conservatively while deep scan keeps every entry', () => {
    expect(isQuickScanCandidate(sources[0])).toBe(true);
    expect(isQuickScanCandidate(sources[1])).toBe(false);
    expect(selectScanEntries(sources, 'quick').map(item => item.id)).toEqual([1]);
    expect(selectScanEntries(sources, 'deep').map(item => item.id)).toEqual([1, '2']);
  });

  it('validates IDs, dates, confidence, and low-confidence selection', () => {
    const draft = validateAnalysisDraft({
      groups: [{
        name: '主线',
        entries: [
          { entryId: 1, title: '事件 A', contentStartDate: '424-05-01', boundaryDate: null, confidence: 0.91, warnings: [] },
          { entryId: '2', title: '可能相关', contentStartDate: null, boundaryDate: null, confidence: 0.2, warnings: ['时间不明确'] },
        ],
      }],
    }, sources);

    expect(draft.groups[0].entries[0]).toMatchObject({
      confidence: 'high',
      selected: true,
      entryId: 1,
      sourceContent: sources[0].content,
    });
    expect(draft.groups[0].entries[1]).toMatchObject({ confidence: 'low', selected: false, entryId: '2' });
    expect(() => validateAnalysisDraft({
      groups: [{ name: '错误', entries: [{ entryId: 99, title: '未知', confidence: 1, warnings: [] }] }],
    }, sources)).toThrow('不存在的条目 ID');
    expect(() => validateAnalysisDraft({
      groups: [{ name: '错误', entries: [{ entryId: 1, title: '日期错误', contentStartDate: '424-02-30', confidence: 1, warnings: [] }] }],
    }, sources)).toThrow('不是合法日期');
  });

  it('accepts JSON fences and retries invalid AI output up to a valid result', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('```json\n{"groups":[{"name":"主线","entries":[{"entryId":1,"title":"第一章","contentStartDate":"424-05-01","boundaryDate":null,"confidence":0.9,"warnings":[]}]}]}\n```');
    const result = await runTimelineScan({
      entries: sources,
      generate,
      mode: 'quick',
      signal: new AbortController().signal,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.candidateCount).toBe(1);
    expect(result.groups[0].entries[0].entryId).toBe(1);
  });

  it('stops after three invalid results and keeps the last raw output', async () => {
    const generate = vi.fn().mockResolvedValue('still invalid');
    await expect(runTimelineScan({
      entries: sources,
      generate,
      mode: 'quick',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'AnalysisValidationError',
      rawOutput: 'still invalid',
    } satisfies Partial<AnalysisValidationError>);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('does not call AI when quick scan finds no candidates', async () => {
    const generate = vi.fn();
    const result = await runTimelineScan({
      entries: [sources[1]],
      generate,
      mode: 'quick',
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ candidateCount: 0, groups: [] });
    expect(generate).not.toHaveBeenCalled();
  });

  it('splits large scans into batches and performs a compact summary request', async () => {
    const manyEntries = Array.from({ length: 26 }, (_, index) => entry(index + 1, `条目 ${index + 1}`, '正文'));
    const outputFor = (ids: number[]) => ({
      groups: [{
        name: '主线',
        entries: ids.map(id => ({
          entryId: id,
          title: `条目 ${id}`,
          contentStartDate: null,
          boundaryDate: null,
          confidence: 0.9,
          warnings: [],
        })),
      }],
    });
    const generate = vi.fn()
      .mockResolvedValueOnce(outputFor(Array.from({ length: 25 }, (_, index) => index + 1)))
      .mockResolvedValueOnce(outputFor([26]))
      .mockResolvedValueOnce(outputFor(Array.from({ length: 26 }, (_, index) => index + 1)));
    const progress = vi.fn();

    const result = await runTimelineScan({
      entries: manyEntries,
      generate,
      mode: 'deep',
      onProgress: progress,
      signal: new AbortController().signal,
    });

    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.candidateCount).toBe(26);
    expect(result.groups[0].entries).toHaveLength(26);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'summary' }));
  });

  it('drops a late AI result after the user cancels scanning', async () => {
    const controller = new AbortController();
    const generate = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { groups: [] };
    });

    await expect(runTimelineScan({
      entries: sources,
      generate,
      mode: 'quick',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).toHaveBeenCalledOnce();
  });
});
