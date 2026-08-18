import { reactive } from 'vue';

export type TimelinePage = 'overview' | 'timeline' | 'groups' | 'analysis' | 'logs' | 'settings';

export const uiState = reactive({
  open: false,
  activePage: 'overview' as TimelinePage,
});

export function openTimeline(): void {
  uiState.open = true;
}

export function closeTimeline(): void {
  uiState.open = false;
}
