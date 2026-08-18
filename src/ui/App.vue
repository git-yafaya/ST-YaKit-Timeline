<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
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
import SettingsPage from '@/ui/pages/SettingsPage.vue';
import type {
  AiSettings,
  AutomationSettings,
  GeneralSettings,
  SettingsSnapshot,
  ThemeMode,
} from '@/ui/pages/settings';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveAiSettings,
  saveAutomationSettings,
  saveGeneralSettings,
} from '@/ui/settings-store';
import { detectSillyTavernTheme, resolveTheme, type ResolvedTheme, watchSillyTavernTheme } from '@/ui/theme';
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
const settings = reactive<SettingsSnapshot>(loadSettings(DEFAULT_SETTINGS));
const hostTheme = ref<ResolvedTheme>(detectSillyTavernTheme());
const resolvedTheme = computed(() => resolveTheme(settings.general.theme, hostTheme.value));
let stopWatchingHostTheme: (() => void) | undefined;

onMounted(() => {
  stopWatchingHostTheme = watchSillyTavernTheme(theme => {
    hostTheme.value = theme;
  });
});

onBeforeUnmount(() => stopWatchingHostTheme?.());

function selectPage(page: TimelinePage): void {
  uiState.activePage = page;
}

function openAnalysis(): void {
  selectPage('analysis');
}

function inspectTimeline(): void {
  selectPage('timeline');
}

function saveGeneral(nextSettings: GeneralSettings): void {
  settings.general = { ...nextSettings };
  saveGeneralSettings(nextSettings);
}

function saveAi(nextSettings: AiSettings): void {
  settings.ai = { ...nextSettings };
  saveAiSettings(nextSettings);
}

function saveAutomation(nextSettings: AutomationSettings): void {
  settings.automation = { ...nextSettings };
  saveAutomationSettings(nextSettings);
}

function changeTheme(theme: ThemeMode): void {
  const nextSettings: GeneralSettings = { ...settings.general, theme };
  settings.general = nextSettings;
  saveGeneralSettings(nextSettings);
}
</script>

<template>
  <div class="timeline-root" :data-theme="resolvedTheme">
    <Transition name="timeline-fade">
      <AppShell
        v-if="uiState.open"
        :active-page="uiState.activePage"
        @close="closeTimeline"
        @select-page="selectPage"
      >
        <Transition name="timeline-page" mode="out-in">
          <OverviewPage
            v-if="uiState.activePage === 'overview'"
            key="overview"
            :groups="overviewGroups"
            @inspect="inspectTimeline"
            @reanalyze="openAnalysis"
          />

          <TimelinePageView
            v-else-if="uiState.activePage === 'timeline'"
            key="timeline"
            :groups="timelineGroups"
            @start-analysis="openAnalysis"
          />

          <GroupPage
            v-else-if="uiState.activePage === 'groups'"
            key="groups"
            :groups="managementGroups"
            @start-analysis="openAnalysis"
          />

          <AnalysisPage
            v-else-if="uiState.activePage === 'analysis'"
            key="analysis"
            :draft="analysisDraft"
            :progress="analysisProgress"
          />

          <LogsPage
            v-else-if="uiState.activePage === 'logs'"
            key="logs"
            :runtime-logs="runtimeLogs"
            :runtime-summary="runtimeLogSummary"
            :system-logs="systemLogs"
            :system-summary="systemLogSummary"
          />

          <SettingsPage
            v-else-if="uiState.activePage === 'settings'"
            key="settings"
            :settings="settings"
            @save-ai="saveAi"
            @save-automation="saveAutomation"
            @save-general="saveGeneral"
            @theme-change="changeTheme"
          />

          <div v-else key="fallback" class="empty-state">
            <span class="empty-icon" aria-hidden="true">◇</span>
            <h1>{{ pageTitle }}</h1>
            <p>页面入口已建立，功能将在对应领域模块接入后启用。</p>
          </div>
        </Transition>
      </AppShell>
    </Transition>
  </div>
</template>
