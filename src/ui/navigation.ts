import type { TimelinePage } from '@/ui/state';

export const TIMELINE_PAGES: ReadonlyArray<{ id: TimelinePage; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'timeline', label: '时间线' },
  { id: 'groups', label: '分组' },
  { id: 'analysis', label: 'AI分析' },
  { id: 'logs', label: '日志' },
  { id: 'settings', label: '设置' },
];

export function getPageLabel(pageId: TimelinePage): string {
  return TIMELINE_PAGES.find(page => page.id === pageId)?.label ?? '总览';
}
