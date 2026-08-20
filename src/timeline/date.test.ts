import { describe, expect, it } from 'vitest';
import {
  compareStoryDates,
  differenceInStoryDays,
  formatStoryDate,
  formatStoryTime,
  isLeapYear,
  parseStoryDate,
} from '@/timeline/date';

describe('story date', () => {
  it('解析并格式化三位故事年份', () => {
    const date = parseStoryDate('424-05-14');
    expect(date).toEqual({ year: 424, month: 5, day: 14 });
    expect(formatStoryDate(date!)).toBe('424-05-14');
  });

  it('拒绝不存在的日期', () => {
    expect(parseStoryDate('419-02-29')).toBeNull();
    expect(parseStoryDate('424-13-01')).toBeNull();
    expect(parseStoryDate('424-5-14')).toBeNull();
  });

  it('按公历规则处理闰年', () => {
    expect(isLeapYear(400)).toBe(true);
    expect(isLeapYear(420)).toBe(true);
    expect(isLeapYear(500)).toBe(false);
    expect(parseStoryDate('420-02-29')).not.toBeNull();
  });

  it('跨月、跨年比较日期与天数', () => {
    const left = parseStoryDate('419-12-31')!;
    const right = parseStoryDate('420-01-01')!;
    expect(compareStoryDates(left, right)).toBeLessThan(0);
    expect(differenceInStoryDays(left, right)).toBe(1);
  });

  it('格式化带时分和不带时分的故事时间', () => {
    expect(formatStoryTime({ year: 424, month: 5, day: 14, hour: 7, minute: 5, raw: 'raw' }))
      .toBe('424年5月14日 07:05');
    expect(formatStoryTime({ year: 424, month: 5, day: 14, raw: 'raw' }))
      .toBe('424年5月14日');
  });
});
