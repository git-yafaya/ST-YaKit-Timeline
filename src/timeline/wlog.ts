import { isValidStoryDate } from '@/timeline/date';
import type { StoryTime } from '@/timeline/types';

const WLOG_PATTERN = /<wlog\b([^>]*)>[\s\S]*?<\/wlog\s*>/gi;
const TIME_ATTRIBUTE_PATTERN = /\btime\s*=\s*(["'])(.*?)\1/i;
const STORY_TIME_PATTERN =
  /^\s*(?:🕒\s*)?(?:时间\s*[:：]\s*)?(\d{1,6})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[/／]\s*(\d{1,2})\s*[:：]\s*(\d{1,2}))?\s*$/u;

/** 从当前消息末尾向前取最后一个完整且合法的 wlog 时间。 */
export function parseWlogTime(messageText: string): StoryTime | null {
  const attributes = Array.from(messageText.matchAll(WLOG_PATTERN), match => match[1]);

  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    const timeAttribute = TIME_ATTRIBUTE_PATTERN.exec(attributes[index]);
    if (!timeAttribute) continue;

    const parsed = parseStoryTimeValue(timeAttribute[2]);
    if (parsed) return parsed;
  }
  return null;
}

export function parseStoryTimeValue(raw: string): StoryTime | null {
  const match = STORY_TIME_PATTERN.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidStoryDate({ year, month, day })) return null;

  const result: StoryTime = { year, month, day, raw };
  if (match[4] !== undefined && match[5] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    result.hour = hour;
    result.minute = minute;
  }
  return result;
}
