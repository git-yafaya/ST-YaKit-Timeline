import type { EntryId } from '@/timeline/types';

export type GroupEntryOrigin = 'ai' | 'manual';

export interface GroupManagementEntry {
  entryId: EntryId;
  originalComment: string;
  origin: GroupEntryOrigin;
  rangeLabel: string;
  title: string;
  warning?: string;
}

export interface GroupManagementSummary {
  entries: readonly GroupManagementEntry[];
  id: string;
  isUngrouped?: boolean;
  name: string;
}
