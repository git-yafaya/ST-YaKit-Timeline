export interface StoryDate {
  year: number;
  month: number;
  day: number;
}

export interface StoryTime extends StoryDate {
  hour?: number;
  minute?: number;
  raw: string;
}

export type EntryId = string | number;

export interface MatchableTimelineEntry {
  entryId: EntryId;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  managed?: boolean;
}

export interface MatchableTimelineGroup {
  entries: readonly MatchableTimelineEntry[];
}

export type MatchResult =
  | {
      status: 'matched';
      entry: MatchableTimelineEntry;
    }
  | {
      status: 'no_match';
      reason: string;
    }
  | {
      status: 'conflict';
      reason: string;
      entryIds: EntryId[];
    }
  | {
      status: 'invalid_config';
      reason: string;
    };
