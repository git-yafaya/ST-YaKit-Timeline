<script setup lang="ts">
import { computed } from 'vue';
import AppShell from '@/ui/components/AppShell.vue';
import { getPageLabel } from '@/ui/navigation';
import OverviewPage from '@/ui/pages/OverviewPage.vue';
import type { OverviewGroupSummary } from '@/ui/pages/overview';
import { closeTimeline, type TimelinePage, uiState } from '@/ui/state';

const pageTitle = computed(() => getPageLabel(uiState.activePage));
// 世界书适配层接入前保持为空，避免把 HTML 原型样例当成真实数据。
const overviewGroups: readonly OverviewGroupSummary[] = [];

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
