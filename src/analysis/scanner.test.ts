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

function promptInputEntries(prompt: string): Array<Record<string, unknown>> {
  const marker = '输入条目：';
  const markerIndex = prompt.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const inputWithRepairNote = prompt.slice(markerIndex + marker.length);
  const input = inputWithRepairNote.split('\n\n上一次输出校验失败：', 1)[0];
  return JSON.parse(input) as Array<Record<string, unknown>>;
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

  it('uses AI only for deep scans and retries invalid output up to a valid result', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('```json\n{"groups":[{"name":"主线","entries":[{"entryId":1,"title":"第一章","contentStartDate":"424-05-01","boundaryDate":null,"confidence":0.9,"warnings":[]}]}]}\n```');
    const result = await runTimelineScan({
      entries: sources,
      generate,
      mode: 'deep',
      signal: new AbortController().signal,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.candidateCount).toBe(2);
    expect(result.scanMode).toBe('deep');
    expect(result.groups[0].entries[0].entryId).toBe(1);
  });

  it('sends only entryId, comment, and content to deep-scan AI', async () => {
    const source = {
      ...entry(17, '允许评论', '允许正文'),
      chat: 'CHAT_SENTINEL',
      secret: 'SECRET_SENTINEL',
      roleCard: 'ROLE_CARD_SENTINEL',
      chatMetadata: 'CHAT_METADATA_SENTINEL',
    } as WorldInfoEntrySnapshot;
    const generate = vi.fn().mockResolvedValue({ groups: [] });

    await runTimelineScan({
      entries: [source],
      generate,
      mode: 'deep',
      signal: new AbortController().signal,
    });

    const prompt = generate.mock.calls[0]?.[0] as string;
    const serialized = prompt.match(/输入条目：([\s\S]*)$/)?.[1];
    expect(serialized).toBeDefined();
    expect(JSON.parse(serialized as string)).toEqual([{
      entryId: 17,
      comment: '允许评论',
      content: '允许正文',
    }]);
    expect(prompt).toContain('当前角色卡实际绑定世界书');
    expect(prompt).toContain('entryId、comment、content');
    expect(prompt).toContain('聊天消息正文、角色卡正文、chatMetadata');
    expect(prompt).not.toContain('CHAT_SENTINEL');
    expect(prompt).not.toContain('SECRET_SENTINEL');
    expect(prompt).not.toContain('ROLE_CARD_SENTINEL');
    expect(prompt).not.toContain('CHAT_METADATA_SENTINEL');
  });

  it('stops after three invalid results and keeps the last raw output', async () => {
    const source = {
      ...entry(17, '允许评论', '允许正文'),
      chat: 'CHAT_SENTINEL',
      secret: 'SECRET_SENTINEL',
      roleCard: 'ROLE_CARD_SENTINEL',
      chatMetadata: 'CHAT_METADATA_SENTINEL',
    } as WorldInfoEntrySnapshot;
    const generate = vi.fn().mockResolvedValue('still invalid');
    await expect(runTimelineScan({
      entries: [source],
      generate,
      mode: 'deep',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'AnalysisValidationError',
      rawOutput: 'still invalid',
    } satisfies Partial<AnalysisValidationError>);
    expect(generate).toHaveBeenCalledTimes(3);
    const prompts = generate.mock.calls.map(call => call[0] as string);
    for (const prompt of prompts) {
      expect(promptInputEntries(prompt)).toEqual([{
        entryId: 17,
        comment: '允许评论',
        content: '允许正文',
      }]);
      expect(prompt).not.toContain('CHAT_SENTINEL');
      expect(prompt).not.toContain('SECRET_SENTINEL');
      expect(prompt).not.toContain('ROLE_CARD_SENTINEL');
      expect(prompt).not.toContain('CHAT_METADATA_SENTINEL');
    }
    expect(prompts[1]).toBeDefined();
    expect(prompts[2]).toBeDefined();
    expect(prompts[1]?.startsWith(prompts[0] ?? '')).toBe(true);
    expect(prompts[2]?.startsWith(prompts[0] ?? '')).toBe(true);
    const allowedRepairNote = '\n\n上一次输出校验失败：AI 返回的内容不是合法 JSON。请修复并重新输出完整 JSON。';
    expect(prompts[0]).toBeDefined();
    expect(prompts[0]).not.toContain('上一次输出校验失败：');
    expect(prompts[1]?.slice(prompts[0]?.length)).toBe(allowedRepairNote);
    expect(prompts[2]?.slice(prompts[0]?.length)).toBe(allowedRepairNote);
  });

  it('does not call AI during quick scans and returns local candidates', async () => {
    const generate = vi.fn();
    const result = await runTimelineScan({
      entries: sources,
      generate,
      mode: 'quick',
      signal: new AbortController().signal,
    });
    expect(result.scanMode).toBe('quick');
    expect(result.candidateCount).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ id: 'local-quick-candidates', name: '本地候选' });
    expect(result.groups[0].entries[0]).toMatchObject({
      entryId: 1,
      contentStartDate: '424-05-01',
      confidence: 'low',
      selected: false,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns an empty local result without calling AI when quick scan finds no candidates', async () => {
    const generate = vi.fn();
    const result = await runTimelineScan({
      entries: [sources[1]],
      generate,
      mode: 'quick',
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ candidateCount: 0, groups: [], scanMode: 'quick' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('splits large scans into batches and performs a compact summary request', async () => {
    const manyEntries = Array.from({ length: 26 }, (_, index) => ({
      ...entry(index + 1, `条目 ${index + 1}`, '正文'),
      chat: `CHAT_SENTINEL_${index + 1}`,
      secret: `SECRET_SENTINEL_${index + 1}`,
    }) as WorldInfoEntrySnapshot);
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
    for (const [index, call] of generate.mock.calls.slice(0, 2).entries()) {
      const prompt = call[0] as string;
      const expectedEntries = index === 0
        ? Array.from({ length: 25 }, (_, entryIndex) => ({
          entryId: entryIndex + 1,
          comment: `条目 ${entryIndex + 1}`,
          content: '正文',
        }))
        : [{ entryId: 26, comment: '条目 26', content: '正文' }];
      expect(promptInputEntries(prompt)).toEqual(expectedEntries);
      expect(prompt).not.toContain('CHAT_SENTINEL');
      expect(prompt).not.toContain('SECRET_SENTINEL');
    }
    const summaryPrompt = generate.mock.calls[2]?.[0] as string;
    expect(summaryPrompt).toContain('只能使用分批 AI 已生成的结构化派生结果与允许的 entryId 列表');
    expect(summaryPrompt).toContain('不得读取、请求或使用世界书原始正文、聊天消息正文、角色卡正文或 chatMetadata');
    expect(summaryPrompt).toContain('分批结果：');
    expect(summaryPrompt).not.toContain('CHAT_SENTINEL');
    expect(summaryPrompt).not.toContain('SECRET_SENTINEL');
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
      mode: 'deep',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).toHaveBeenCalledOnce();
  });
});
