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
import { fetchAvailableModels } from '@/ui/model-provider';
import type {
  AiSettings,
  AiSaveStatus,
  AutomationSettings,
  ConnectionStates,
  GeneralSettings,
  ModelCatalogs,
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
const modelCatalogs = reactive<ModelCatalogs>({
  sillytavern: { status: 'idle', models: [], message: '' },
  independent: { status: 'idle', models: [], message: '' },
});
const modelRequestVersions = { sillytavern: 0, independent: 0 };
const connectionStates = reactive<ConnectionStates>({
  sillytavern: { status: 'idle', message: '' },
  independent: { status: 'idle', message: '' },
});
const connectionRequestVersions = { sillytavern: 0, independent: 0 };
const aiSaveStatus = ref<AiSaveStatus>('idle');
const aiSaveMessage = ref('');
let aiSaveResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
const hostTheme = ref<ResolvedTheme>(detectSillyTavernTheme());
const resolvedTheme = computed(() => resolveTheme(settings.general.theme, hostTheme.value));
let stopWatchingHostTheme: (() => void) | undefined;

onMounted(() => {
  stopWatchingHostTheme = watchSillyTavernTheme(theme => {
    hostTheme.value = theme;
  });
});

onBeforeUnmount(() => {
  stopWatchingHostTheme?.();
  if (aiSaveResetTimer !== undefined) globalThis.clearTimeout(aiSaveResetTimer);
});

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
  const saved = saveAiSettings(nextSettings);
  aiSaveStatus.value = saved ? 'saved' : 'error';
  aiSaveMessage.value = saved ? 'AI 设置已保存' : '保存失败：无法写入 SillyTavern 扩展设置';
  if (saved) settings.ai = { ...nextSettings };

  if (aiSaveResetTimer !== undefined) globalThis.clearTimeout(aiSaveResetTimer);
  aiSaveResetTimer = globalThis.setTimeout(() => {
    aiSaveStatus.value = 'idle';
    aiSaveMessage.value = '';
  }, 3000);
}

function saveAutomation(nextSettings: AutomationSettings): void {
  settings.automation = { ...nextSettings };
  saveAutomationSettings(nextSettings);
}

async function requestModels(nextSettings: AiSettings): Promise<void> {
  const provider = nextSettings.provider;
  const version = ++modelRequestVersions[provider];
  const catalog = modelCatalogs[provider];
  catalog.status = 'loading';
  catalog.message = '';

  try {
    const models = await fetchAvailableModels(nextSettings);
    if (version !== modelRequestVersions[provider]) return;
    catalog.models = models;
    catalog.status = 'loaded';
    catalog.message = `已获取 ${models.length} 个模型`;
  } catch (error) {
    if (version !== modelRequestVersions[provider]) return;
    catalog.models = [];
    catalog.status = 'error';
    catalog.message = error instanceof Error ? error.message : '获取模型失败';
  }
}

async function testConnection(nextSettings: AiSettings): Promise<void> {
  const provider = nextSettings.provider;
  const connectionVersion = ++connectionRequestVersions[provider];
  const modelVersion = ++modelRequestVersions[provider];
  const connection = connectionStates[provider];
  const catalog = modelCatalogs[provider];
  connection.status = 'testing';
  connection.message = '正在测试连接…';
  catalog.status = 'loading';
  catalog.message = '';

  try {
    const models = await fetchAvailableModels(nextSettings);
    if (connectionVersion !== connectionRequestVersions[provider]) return;
    connection.status = 'connected';
    connection.message = `连接成功，可用模型 ${models.length} 个`;
    if (modelVersion === modelRequestVersions[provider]) {
      catalog.models = models;
      catalog.status = 'loaded';
      catalog.message = `已获取 ${models.length} 个模型`;
    }
  } catch (error) {
    if (connectionVersion !== connectionRequestVersions[provider]) return;
    const message = error instanceof Error ? error.message : '连接测试失败';
    connection.status = 'error';
    connection.message = message;
    if (modelVersion === modelRequestVersions[provider]) {
      catalog.models = [];
      catalog.status = 'error';
      catalog.message = message;
    }
  }
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
            :ai-save-message="aiSaveMessage"
            :ai-save-status="aiSaveStatus"
            :connection-states="connectionStates"
            :model-catalogs="modelCatalogs"
            :settings="settings"
            @request-models="requestModels"
            @save-ai="saveAi"
            @save-automation="saveAutomation"
            @save-general="saveGeneral"
            @test-connection="testConnection"
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
