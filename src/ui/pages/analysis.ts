import type { EntryId } from '@/timeline/types';

export type AnalysisConfidence = 'high' | 'medium' | 'low';
export type AnalysisScanMode = 'quick' | 'deep';
export type AnalysisStage = 'filtering' | 'batches' | 'summary' | 'validation';

export interface AnalysisDraftEntry {
  boundaryDate?: string;
  confidence: AnalysisConfidence;
  contentStartDate?: string;
  entryId: EntryId;
  groupLocked?: boolean;
  manuallyLocked?: boolean;
  orderLocked?: boolean;
  selected: boolean;
  sourceComment: string;
  title: string;
  warnings?: readonly string[];
}

export interface AnalysisDraftGroup {
  entries: readonly AnalysisDraftEntry[];
  id: string;
  name: string;
  nameLocked?: boolean;
  orderLocked?: boolean;
}

export interface AnalysisDraft {
  candidateCount: number;
  groups: readonly AnalysisDraftGroup[];
}

export interface AnalysisEntryPatch {
  boundaryDate?: string;
  contentStartDate?: string;
  title: string;
}

export interface AnalysisProgress {
  label: string;
  percent: number;
  stage: AnalysisStage;
}

export interface AnalysisErrorState {
  message: string;
  rawOutput?: string;
}

export type AnalysisDiffStatus = 'added' | 'changed' | 'removed' | 'unchanged';

export interface AnalysisDiffItem {
  entryId: EntryId;
  newRange?: string;
  oldRange?: string;
  status: AnalysisDiffStatus;
  title: string;
}

export function renameAnalysisGroup(
  draft: AnalysisDraft,
  groupId: string,
  name: string,
): AnalysisDraft {
  const trimmed = name.trim();
  if (!trimmed) return draft;
  return {
    ...draft,
    groups: draft.groups.map(group => group.id === groupId
      ? { ...group, name: trimmed, nameLocked: true }
      : group),
  };
}

export function reorderAnalysisGroups(
  draft: AnalysisDraft,
  orderedGroupIds: readonly string[],
): AnalysisDraft {
  const lookup = new Map(draft.groups.map(group => [group.id, group]));
  const ordered = orderedGroupIds
    .map(id => lookup.get(id))
    .filter((group): group is AnalysisDraftGroup => Boolean(group));
  for (const group of draft.groups) if (!ordered.includes(group)) ordered.push(group);
  return {
    ...draft,
    groups: ordered.map(group => ({ ...group, orderLocked: true })),
  };
}

export function reorderAnalysisEntries(
  draft: AnalysisDraft,
  groupId: string,
  orderedEntryIds: readonly EntryId[],
): AnalysisDraft {
  const group = draft.groups.find(item => item.id === groupId);
  if (!group) return draft;
  const lookup = new Map(group.entries.map(entry => [String(entry.entryId), entry]));
  const ordered = orderedEntryIds
    .map(entryId => lookup.get(String(entryId)))
    .filter((entry): entry is AnalysisDraftEntry => Boolean(entry));
  for (const entry of group.entries) if (!ordered.includes(entry)) ordered.push(entry);
  return {
    ...draft,
    groups: draft.groups.map(item => item.id === groupId
      ? { ...item, entries: ordered.map(entry => ({ ...entry, orderLocked: true })) }
      : item),
  };
}

export function moveAnalysisEntry(
  draft: AnalysisDraft,
  sourceGroupId: string,
  targetGroupId: string,
  entryId: EntryId,
  targetEntryId?: EntryId,
): AnalysisDraft {
  if (sourceGroupId === targetGroupId) {
    const group = draft.groups.find(item => item.id === sourceGroupId);
    if (!group) return draft;
    const moved = group.entries.find(entry => String(entry.entryId) === String(entryId));
    if (!moved) return draft;
    const next = group.entries.filter(entry => String(entry.entryId) !== String(entryId));
    const index = targetEntryId === undefined
      ? next.length
      : next.findIndex(entry => String(entry.entryId) === String(targetEntryId));
    next.splice(index < 0 ? next.length : index, 0, moved);
    return reorderAnalysisEntries(draft, sourceGroupId, next.map(entry => entry.entryId));
  }
  const source = draft.groups.find(group => group.id === sourceGroupId);
  const target = draft.groups.find(group => group.id === targetGroupId);
  const moved = source?.entries.find(entry => String(entry.entryId) === String(entryId));
  if (!source || !target || !moved) return draft;

  const sourceEntries = source.entries.filter(entry => String(entry.entryId) !== String(entryId));
  const targetEntries = target.entries.filter(entry => String(entry.entryId) !== String(entryId));
  const movedEntry = { ...moved, groupLocked: true, orderLocked: true };
  const targetIndex = targetEntryId === undefined
    ? targetEntries.length
    : targetEntries.findIndex(entry => String(entry.entryId) === String(targetEntryId));
  targetEntries.splice(targetIndex < 0 ? targetEntries.length : targetIndex, 0, movedEntry);

  return {
    ...draft,
    groups: draft.groups.map(group => {
      if (group.id === sourceGroupId) return { ...group, entries: sourceEntries };
      if (group.id === targetGroupId) return { ...group, entries: targetEntries };
      return group;
    }),
  };
}
