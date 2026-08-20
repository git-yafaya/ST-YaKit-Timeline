import type { EntryId } from '@/timeline/types';
import type { OverviewGroupMode } from '@/ui/pages/overview';

export type TimelineEntryState = 'active' | 'inactive' | 'warning';
export type TimelineStatusFilter = 'all' | 'active' | 'inactive' | 'attention' | 'manual';

export interface TimelineEntrySummary {
  contentPreview?: string;
  enabled: boolean;
  entryId: EntryId;
  manuallyModified: boolean;
  pending: boolean;
  originalComment: string;
  rangeLabel: string;
  state: TimelineEntryState;
  title: string;
  warning?: string;
}

export interface TimelineGroupDetail {
  activeEntryTitle?: string;
  entries: readonly TimelineEntrySummary[];
  id: string;
  mode: OverviewGroupMode;
  name: string;
}
