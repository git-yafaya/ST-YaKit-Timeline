<script setup lang="ts">
import { computed } from 'vue';
import AppShell from '@/ui/components/AppShell.vue';
import { getPageLabel } from '@/ui/navigation';
import AnalysisPage from '@/ui/pages/AnalysisPage.vue';
import type { AnalysisDraft, AnalysisProgress } from '@/ui/pages/analysis';
import GroupPage from '@/ui/pages/GroupPage.vue';
import type { GroupManagementSummary } from '@/ui/pages/groups';
import LogsPage from '@/ui/pages/LogsPage.vue';
import type { RuntimeLogSummary, SystemLogSummary, TimelineLogEntry } from '@/ui/pages/logs';
import OverviewPage from '@/ui/pages/OverviewPage.vue';
import type { OverviewGroupSummary } from '@/ui/pages/overview';
import TimelinePageView from '@/ui/pages/TimelinePage.vue';
import type { TimelineGroupDetail } from '@/ui/pages/timeline';
import { closeTimeline, type TimelinePage, uiState } from '@/ui/state';

const pageTitle = computed(() => getPageLabel(uiState.activePage));
// 世界书适配层接入前保持为空，避免把 HTML 原型样例当成真实数据。
const overviewGroups: readonly OverviewGroupSummary[] = [];
const timelineGroups: readonly TimelineGroupDetail[] = [];
const managementGroups: readonly GroupManagementSummary[] = [];
const analysisDraft: AnalysisDraft | null = null;
const analysisProgress: AnalysisProgress | null = null;
const runtimeLogs: readonly TimelineLogEntry[] = [];
const systemLogs: readonly TimelineLogEntry[] = [];
const runtimeLogSummary: RuntimeLogSummary | null = null;
const systemLogSummary: SystemLogSummary | null = null;

function selectPage(page: TimelinePage): void {
  uiState.activePage = page;
}

function openAnalysis(): void {
  selectPage('analysis');
}

function inspectTimeline(): void {
  selectPage('timeline');
}
</script>

<template>
  <div class="timeline-root">
    <Transition name="timeline-fade">
      <AppShell
        v-if="uiState.open"
        :active-page="uiState.activePage"
        @close="closeTimeline"
        @select-page="selectPage"
      >
        <OverviewPage
          v-if="uiState.activePage === 'overview'"
          :groups="overviewGroups"
          @inspect="inspectTimeline"
          @reanalyze="openAnalysis"
        />

        <TimelinePageView
          v-else-if="uiState.activePage === 'timeline'"
          :groups="timelineGroups"
          @start-analysis="openAnalysis"
        />

        <GroupPage
          v-else-if="uiState.activePage === 'groups'"
          :groups="managementGroups"
          @start-analysis="openAnalysis"
        />

        <AnalysisPage
          v-else-if="uiState.activePage === 'analysis'"
          :draft="analysisDraft"
          :progress="analysisProgress"
        />

        <LogsPage
          v-else-if="uiState.activePage === 'logs'"
          :runtime-logs="runtimeLogs"
          :runtime-summary="runtimeLogSummary"
          :system-logs="systemLogs"
          :system-summary="systemLogSummary"
        />

        <template v-else>
          <div class="empty-state">
            <span class="empty-icon" aria-hidden="true">◇</span>
            <h1>{{ pageTitle }}</h1>
            <p>页面入口已建立，功能将在对应领域模块接入后启用。</p>
          </div>
        </template>
      </AppShell>
    </Transition>
  </div>
</template>
