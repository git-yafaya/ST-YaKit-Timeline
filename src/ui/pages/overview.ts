import type { EntryId } from '@/timeline/types';

export type OverviewGroupKind = 'route' | 'character' | 'world';
export type OverviewGroupMode = 'auto' | 'manual';

export interface OverviewActiveEntry {
  entryId: EntryId;
  rangeLabel: string;
  title: string;
}

export interface OverviewGroupSummary {
  activeEntry?: OverviewActiveEntry;
  id: string;
  kind: OverviewGroupKind;
  mode: OverviewGroupMode;
  name: string;
  warning?: string;
}
