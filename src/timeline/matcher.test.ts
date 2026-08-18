import { describe, expect, it } from 'vitest';
import { matchTimelineEntry } from '@/timeline/matcher';
import type { MatchableTimelineGroup, StoryDate } from '@/timeline/types';

const group: MatchableTimelineGroup = {
  entries: [
    {
      entryId: 17,
      effectiveStartDate: '419-11-10',
      effectiveEndDate: '419-12-25',
    },
    {
      entryId: 18,
      effectiveStartDate: '419-12-26',
      effectiveEndDate: '420-03-16',
    },
    {
      entryId: 19,
      effectiveStartDate: '420-03-17',
      effectiveEndDate: null,
    },
  ],
};

const date = (year: number, month: number, day: number): StoryDate => ({ year, month, day });

describe('matchTimelineEntry', () => {
  it('早于首条实际起点时仍匹配首条', () => {
    expect(matchTimelineEntry(date(419, 1, 1), group)).toMatchObject({ status: 'matched', entry: { entryId: 17 } });
  });

  it('边界前一天匹配旧条目，边界当天立即匹配新条目', () => {
    expect(matchTimelineEntry(date(419, 12, 25), group)).toMatchObject({ status: 'matched', entry: { entryId: 17 } });
    expect(matchTimelineEntry(date(419, 12, 26), group)).toMatchObject({ status: 'matched', entry: { entryId: 18 } });
  });

  it('晚于最后一条时继续匹配最后一条', () => {
    expect(matchTimelineEntry(date(999, 12, 31), group)).toMatchObject({ status: 'matched', entry: { entryId: 19 } });
  });

  it('不让未纳管条目参与匹配', () => {
    const result = matchTimelineEntry(date(420, 1, 1), {
      entries: [
        { entryId: 'ignored', effectiveStartDate: '419-01-01', managed: false },
        { entryId: 'managed', effectiveStartDate: '420-02-01' },
      ],
    });
    expect(result).toMatchObject({ status: 'matched', entry: { entryId: 'managed' } });
  });

  it('相同起点返回冲突，不猜测目标条目', () => {
    const result = matchTimelineEntry(date(420, 1, 1), {
      entries: [
        { entryId: 1, effectiveStartDate: '420-01-01' },
        { entryId: 2, effectiveStartDate: '420-01-01' },
      ],
    });
    expect(result).toEqual({
      status: 'conflict',
      reason: '多个条目具有相同的生效起点。',
      entryIds: [1, 2],
    });
  });

  it('范围重叠返回冲突', () => {
    const result = matchTimelineEntry(date(420, 1, 1), {
      entries: [
        { entryId: 1, effectiveStartDate: '419-01-01', effectiveEndDate: '420-01-10' },
        { entryId: 2, effectiveStartDate: '420-01-01' },
      ],
    });
    expect(result).toMatchObject({ status: 'conflict', entryIds: [1, 2] });
  });

  it('范围空档返回非法配置', () => {
    const result = matchTimelineEntry(date(420, 1, 5), {
      entries: [
        { entryId: 1, effectiveStartDate: '419-01-01', effectiveEndDate: '419-12-31' },
        { entryId: 2, effectiveStartDate: '420-01-10' },
      ],
    });
    expect(result).toEqual({ status: 'invalid_config', reason: '相邻条目的有效时间范围存在空档。' });
  });

  it('当前故事日期无效时返回 no_match', () => {
    expect(matchTimelineEntry(date(420, 2, 30), group)).toEqual({
      status: 'no_match',
      reason: '当前故事日期无效。',
    });
  });

  it('拒绝无效日期、倒序和有终点的末条', () => {
    expect(
      matchTimelineEntry(date(420, 1, 1), {
        entries: [{ entryId: 1, effectiveStartDate: '420-02-30' }],
      }).status,
    ).toBe('invalid_config');
    expect(
      matchTimelineEntry(date(420, 1, 1), {
        entries: [
          { entryId: 1, effectiveStartDate: '420-02-01' },
          { entryId: 2, effectiveStartDate: '420-01-01' },
        ],
      }).status,
    ).toBe('invalid_config');
    expect(
      matchTimelineEntry(date(420, 1, 1), {
        entries: [{ entryId: 1, effectiveStartDate: '420-01-01', effectiveEndDate: '420-12-31' }],
      }).status,
    ).toBe('invalid_config');
  });
});
