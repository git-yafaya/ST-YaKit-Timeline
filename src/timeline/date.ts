import type { StoryDate, StoryTime } from '@/timeline/types';

const DATE_PATTERN = /^(\d{1,6})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

export function isValidStoryDate(date: StoryDate): boolean {
  return (
    Number.isInteger(date.year) &&
    date.year >= 1 &&
    Number.isInteger(date.month) &&
    date.month >= 1 &&
    date.month <= 12 &&
    Number.isInteger(date.day) &&
    date.day >= 1 &&
    date.day <= daysInMonth(date.year, date.month)
  );
}

export function parseStoryDate(value: string): StoryDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const date: StoryDate = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isValidStoryDate(date) ? date : null;
}

export function formatStoryDate(date: StoryDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function formatStoryTime(time: StoryTime): string {
  const date = `${time.year}年${time.month}月${time.day}日`;
  if (time.hour === undefined || time.minute === undefined) return date;
  return `${date} ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export function compareStoryDates(left: StoryDate, right: StoryDate): number {
  return toStoryDay(left) - toStoryDay(right);
}

export function differenceInStoryDays(earlier: StoryDate, later: StoryDate): number {
  return toStoryDay(later) - toStoryDay(earlier);
}

function toStoryDay(date: StoryDate): number {
  const previousYears = date.year - 1;
  let days =
    previousYears * 365 +
    Math.floor(previousYears / 4) -
    Math.floor(previousYears / 100) +
    Math.floor(previousYears / 400);

  for (let month = 1; month < date.month; month += 1) {
    days += daysInMonth(date.year, month);
  }
  return days + date.day - 1;
}
