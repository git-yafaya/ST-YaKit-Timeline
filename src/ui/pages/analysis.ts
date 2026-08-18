import type { EntryId } from '@/timeline/types';

export type AnalysisConfidence = 'high' | 'medium' | 'low';
export type AnalysisScanMode = 'quick' | 'deep';
export type AnalysisStage = 'filtering' | 'batches' | 'summary' | 'validation';

export interface AnalysisDraftEntry {
  boundaryDate?: string;
  confidence: AnalysisConfidence;
  contentStartDate?: string;
  entryId: EntryId;
  manuallyLocked?: boolean;
  selected: boolean;
  sourceComment: string;
  title: string;
  warnings?: readonly string[];
}

export interface AnalysisDraftGroup {
  entries: readonly AnalysisDraftEntry[];
  id: string;
  name: string;
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
