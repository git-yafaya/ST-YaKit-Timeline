export type LogLevel = 'success' | 'info' | 'warning' | 'error';
export type LogView = 'runtime' | 'system';

export interface TimelineLogEntry {
  category: string;
  description: string;
  id: string;
  level: LogLevel;
  occurredAt: string;
  title: string;
}

export interface RuntimeLogSummary {
  recentSwitch?: string;
  statusLabel: string;
}

export interface SystemLogSummary {
  controlLabel: string;
  recentError?: string;
  statusLabel: string;
}
