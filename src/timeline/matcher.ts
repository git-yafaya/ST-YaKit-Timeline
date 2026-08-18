import { compareStoryDates, differenceInStoryDays, isValidStoryDate, parseStoryDate } from '@/timeline/date';
import type {
  EntryId,
  MatchableTimelineEntry,
  MatchableTimelineGroup,
  MatchResult,
  StoryDate,
} from '@/timeline/types';

interface ParsedEntry {
  source: MatchableTimelineEntry;
  start: StoryDate;
  end: StoryDate | null;
}

/** 使用已确认配置做确定性匹配；任何结构歧义都返回错误，不选择“最近项”。 */
export function matchTimelineEntry(date: StoryDate, group: MatchableTimelineGroup): MatchResult {
  if (!isValidStoryDate(date)) {
    return { status: 'no_match', reason: '当前故事日期无效。' };
  }

  const entries = group.entries.filter(entry => entry.managed !== false);
  if (entries.length === 0) {
    return { status: 'invalid_config', reason: '时间线组没有可参与匹配的受管条目。' };
  }

  const parsed: ParsedEntry[] = [];
  for (const entry of entries) {
    const start = parseStoryDate(entry.effectiveStartDate);
    if (!start) {
      return { status: 'invalid_config', reason: `条目 ${String(entry.entryId)} 的生效起点无效。` };
    }

    const end = entry.effectiveEndDate ? parseStoryDate(entry.effectiveEndDate) : null;
    if (entry.effectiveEndDate && !end) {
      return { status: 'invalid_config', reason: `条目 ${String(entry.entryId)} 的生效终点无效。` };
    }
    if (end && compareStoryDates(end, start) < 0) {
      return { status: 'invalid_config', reason: `条目 ${String(entry.entryId)} 的终点早于起点。` };
    }
    parsed.push({ source: entry, start, end });
  }

  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    const startOrder = compareStoryDates(current.start, previous.start);
    if (startOrder === 0) {
      return conflict('多个条目具有相同的生效起点。', previous.source.entryId, current.source.entryId);
    }
    if (startOrder < 0) {
      return { status: 'invalid_config', reason: '条目顺序与生效起点不一致。' };
    }

    // 未显式保存终点时，由下一条起点自动推导为前一天。
    if (!previous.end) continue;
    const distance = differenceInStoryDays(previous.end, current.start);
    if (distance <= 0) {
      return conflict('相邻条目的有效时间范围重叠。', previous.source.entryId, current.source.entryId);
    }
    if (distance > 1) {
      return { status: 'invalid_config', reason: '相邻条目的有效时间范围存在空档。' };
    }
  }

  const last = parsed.at(-1)!;
  if (last.end) {
    return { status: 'invalid_config', reason: '最后一个条目的有效终点必须保持开放。' };
  }

  // 早于首条仍使用首条；晚于末条仍使用末条。
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    if (compareStoryDates(date, parsed[index].start) >= 0) {
      return { status: 'matched', entry: parsed[index].source };
    }
  }
  return { status: 'matched', entry: parsed[0].source };
}

function conflict(reason: string, ...entryIds: EntryId[]): MatchResult {
  return { status: 'conflict', reason, entryIds };
}
