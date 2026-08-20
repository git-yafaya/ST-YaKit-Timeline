<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { AnalysisValidationError, runTimelineScan } from '@/analysis/scanner';
import { generateTimelineAnalysis } from '@/st/ai-adapter';
import {
  buildWorldbookTimelineConfig,
  getDraftApplicationIssue,
  loadWorldbookTimelineConfig,
  saveWorldbookTimelineConfig,
  type WorldbookTimelineConfig,
} from '@/storage/worldbook-config';
import {
  readCurrentHostScope,
  readLastAssistantMessageText,
  watchCurrentHostScope,
  watchCurrentHostRuntime,
  type HostScopeSnapshot,
} from '@/st/sillytavern-adapter';
import { formatStoryTime } from '@/timeline/date';
import { parseWlogTime } from '@/timeline/wlog';
import {
  applyStoryTimeCandidate as applyStoryTimeCandidateToState,
  confirmStoryTimeRollback,
  rejectStoryTimeRollback,
  restoreChatTimelineState,
} from '@/timeline/runtime';
import {
  bindChatTimelineState,
  loadChatTimelineState,
  saveChatTimelineState,
  type ChatTimelineState,
} from '@/storage/chat-state';
import AppShell from '@/ui/components/AppShell.vue';
import { getPageLabel } from '@/ui/navigation';
import AnalysisPage from '@/ui/pages/AnalysisPage.vue';
import type {
  AnalysisDraft,
  AnalysisEntryPatch,
  AnalysisErrorState,
  AnalysisProgress,
  AnalysisScanMode,
} from '@/ui/pages/analysis';
import GroupPage from '@/ui/pages/GroupPage.vue';
import type { GroupManagementSummary } from '@/ui/pages/groups';
import LogsPage from '@/ui/pages/LogsPage.vue';
import type { RuntimeLogSummary, SystemLogSummary, TimelineLogEntry } from '@/ui/pages/logs';
import OverviewPage from '@/ui/pages/OverviewPage.vue';
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
import { closeTimeline, type TimelinePage, uiState } from '@/ui/state';
import { buildOverviewGroupSummaries, buildTimelineGroupDetails } from '@/ui/worldbook-view';

const pageTitle = computed(() => getPageLabel(uiState.activePage));
const managementGroups: readonly GroupManagementSummary[] = [];
const analysisDraft = ref<AnalysisDraft | null>(null);
const analysisProgress = ref<AnalysisProgress | null>(null);
const analysisError = ref<AnalysisErrorState | null>(null);
const analysisNotice = ref('');
const analysisApplying = ref(false);
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
const hostScope = ref<HostScopeSnapshot>({
  character: null,
  chatId: null,
  message: '',
  status: 'unavailable',
  worldbook: null,
});
const chatTimelineState = ref<ChatTimelineState | null>(null);
const runtimeNotice = ref('');
const timeActionBusy = ref(false);
const worldbookConfig = ref<WorldbookTimelineConfig | null>(null);
const overviewGroups = computed(() => buildOverviewGroupSummaries(worldbookConfig.value, hostScope.value.worldbook));
const timelineGroups = computed(() => buildTimelineGroupDetails(worldbookConfig.value, hostScope.value.worldbook));
const characterName = computed(() => {
  if (hostScope.value.character) return hostScope.value.character.name;
  return hostScope.value.status === 'no_character' ? '未选择角色' : '正在读取';
});
const worldbookName = computed(() => {
  if (hostScope.value.worldbook) return hostScope.value.worldbook.name;
  if (hostScope.value.status === 'no_worldbook') return '未绑定';
  if (hostScope.value.status === 'worldbook_unreadable') return '无法读取';
  return hostScope.value.status === 'no_character' ? '未选择角色' : '正在读取';
});
const canStartAnalysis = computed(() => (
  hostScope.value.status === 'ready' && (hostScope.value.worldbook?.entries.length ?? 0) > 0
));
const analysisSourceMessage = computed(() => {
  if (canStartAnalysis.value) return '';
  if (hostScope.value.status === 'ready') return '当前角色绑定的世界书没有可分析条目。';
  return hostScope.value.message || '当前角色世界书尚不可读取。';
});
const draftApplicationIssue = computed(() => {
  if (worldbookConfig.value) return '当前世界书已有正式配置，重新分析结果需经过差异合并，不能直接覆盖。';
  return getDraftApplicationIssue(analysisDraft.value, hostScope.value.worldbook);
});
const canApplyAnalysisDraft = computed(() => (
  Boolean(analysisDraft.value) && !analysisApplying.value && draftApplicationIssue.value === null
));
const hostTheme = ref<ResolvedTheme>(detectSillyTavernTheme());
const resolvedTheme = computed(() => resolveTheme(settings.general.theme, hostTheme.value));
const storyTimeLabel = computed(() => {
  const currentTime = chatTimelineState.value?.currentTime;
  return currentTime ? formatStoryTime(currentTime) : '等待有效 <wlog>';
});
const rollbackPrompt = computed(() => {
  const pendingRollback = chatTimelineState.value?.pendingRollback;
  if (!pendingRollback) return undefined;
  return {
    from: formatStoryTime(pendingRollback.from),
    to: formatStoryTime(pendingRollback.to),
  };
});
let hostScopeVersion = 0;
let stopWatchingHostTheme: (() => void) | undefined;
let stopWatchingHostScope: (() => void) | undefined;
let stopWatchingHostRuntime: (() => void) | undefined;
let analysisAbortController: AbortController | undefined;
let analysisRequestVersion = 0;
let activeAnalysisScopeKey = '';
let analysisDraftScopeKey = '';

function hostScopeKey(snapshot: HostScopeSnapshot): string {
  return [snapshot.character?.id ?? '', snapshot.chatId ?? '', snapshot.worldbook?.key ?? ''].join('\u0000');
}

function stopAnalysisForScopeChange(): void {
  if (!analysisProgress.value) return;
  analysisRequestVersion += 1;
  analysisAbortController?.abort();
  analysisAbortController = undefined;
  activeAnalysisScopeKey = '';
  analysisProgress.value = null;
  analysisError.value = { message: '角色、聊天或绑定世界书已变化，本次分析已安全停止。' };
}

function persistChatState(state: ChatTimelineState): boolean {
  chatTimelineState.value = state;
  if (!hostScope.value.chatId) return true;
  const saved = saveChatTimelineState(state);
  if (!saved) runtimeNotice.value = '聊天状态保存失败；当前页面状态仍保留在内存中。';
  return saved;
}

function restoreChatState(snapshot: HostScopeSnapshot, config: WorldbookTimelineConfig | null): void {
  const existing = loadChatTimelineState();
  const lastMessage = readLastAssistantMessageText();
  const restored = restoreChatTimelineState({
    existing,
    groupIds: config?.groups.map(group => group.id) ?? [],
    lastAssistantTime: lastMessage ? parseWlogTime(lastMessage) : null,
    worldbookKey: snapshot.worldbook?.key ?? null,
  });
  chatTimelineState.value = restored.state;

  let saved = true;
  if (restored.shouldPersist && snapshot.chatId) saved = saveChatTimelineState(restored.state);
  if (!saved) {
    runtimeNotice.value = '聊天状态保存失败；当前页面状态仍保留在内存中。';
  } else if (restored.source === 'last_ai') {
    runtimeNotice.value = '已从当前聊天最后一条 AI 回复恢复故事时间。';
  } else if (!restored.state.currentTime && !restored.state.pendingRollback) {
    runtimeNotice.value = '⚠ 当前聊天尚未获得有效故事时间，请让 AI 输出完整 <wlog>。';
  } else if (!restored.state.pendingRollback) {
    runtimeNotice.value = '';
  }
}

async function refreshHostScope(): Promise<void> {
  const version = ++hostScopeVersion;
  const snapshot = await readCurrentHostScope();
  if (version !== hostScopeVersion) return;
  const nextScopeKey = hostScopeKey(snapshot);
  if (activeAnalysisScopeKey && activeAnalysisScopeKey !== nextScopeKey) stopAnalysisForScopeChange();
  if (analysisDraftScopeKey && analysisDraftScopeKey !== nextScopeKey) {
    analysisDraft.value = null;
    analysisDraftScopeKey = '';
  }
  hostScope.value = snapshot;
  const config = snapshot.worldbook
    ? loadWorldbookTimelineConfig(snapshot.worldbook.key)
    : null;
  worldbookConfig.value = config;
  restoreChatState(snapshot, config);
}

onMounted(() => {
  stopWatchingHostTheme = watchSillyTavernTheme(theme => {
    hostTheme.value = theme;
  });
  stopWatchingHostScope = watchCurrentHostScope(() => refreshHostScope());
  stopWatchingHostRuntime = watchCurrentHostRuntime(() => processLatestAssistantMessage());
  void refreshHostScope();
});

onBeforeUnmount(() => {
  stopWatchingHostTheme?.();
  stopWatchingHostScope?.();
  stopWatchingHostRuntime?.();
  analysisAbortController?.abort();
  if (aiSaveResetTimer !== undefined) globalThis.clearTimeout(aiSaveResetTimer);
});

function selectPage(page: TimelinePage): void {
  uiState.activePage = page;
}

function openAnalysis(): void {
  selectPage('analysis');
}

async function startAnalysis(mode: AnalysisScanMode): Promise<void> {
  const snapshot = hostScope.value;
  const worldbook = snapshot.worldbook;
  if (snapshot.status !== 'ready' || !worldbook || worldbook.entries.length === 0) {
    analysisError.value = { message: analysisSourceMessage.value };
    return;
  }

  analysisAbortController?.abort();
  const controller = new AbortController();
  analysisAbortController = controller;
  const requestVersion = ++analysisRequestVersion;
  const scopeKey = hostScopeKey(snapshot);
  activeAnalysisScopeKey = scopeKey;
  analysisError.value = null;
  analysisNotice.value = '';
  const aiSettings = { ...settings.ai };

  try {
    const draft = await runTimelineScan({
      entries: worldbook.entries,
      mode,
      signal: controller.signal,
      generate: (prompt, signal) => generateTimelineAnalysis(aiSettings, prompt, signal),
      onProgress: progress => {
        if (requestVersion === analysisRequestVersion && !controller.signal.aborted) {
          analysisProgress.value = progress;
        }
      },
    });
    if (
      requestVersion !== analysisRequestVersion ||
      controller.signal.aborted ||
      scopeKey !== hostScopeKey(hostScope.value)
    ) return;
    analysisDraft.value = draft;
    analysisDraftScopeKey = scopeKey;
  } catch (error) {
    if (requestVersion !== analysisRequestVersion || controller.signal.aborted) return;
    analysisError.value = {
      message: error instanceof Error ? error.message : 'AI 分析失败',
      rawOutput: error instanceof AnalysisValidationError ? error.rawOutput : undefined,
    };
  } finally {
    if (requestVersion === analysisRequestVersion) {
      analysisProgress.value = null;
      analysisAbortController = undefined;
      activeAnalysisScopeKey = '';
    }
  }
}

function cancelAnalysis(): void {
  if (!analysisProgress.value) return;
  analysisRequestVersion += 1;
  analysisAbortController?.abort();
  analysisAbortController = undefined;
  activeAnalysisScopeKey = '';
  analysisProgress.value = null;
  analysisError.value = null;
  analysisNotice.value = '';
}

function showMissingTimeNotice(): void {
  runtimeNotice.value = chatTimelineState.value?.currentTime
    ? '⚠ 本轮未检测到有效时间，已沿用上次时间。请自行重 Roll 或补充完整 <wlog>。'
    : '⚠ 当前聊天尚未获得有效故事时间，请让 AI 输出完整 <wlog>。';
}

function applyStoryTimeCandidate(nextTime: NonNullable<ReturnType<typeof parseWlogTime>>): void {
  const state = chatTimelineState.value;
  if (!state) return;

  const result = applyStoryTimeCandidateToState(state, nextTime);
  if (result.kind === 'blocked_by_pending_rollback') {
    runtimeNotice.value = '⚠ 请先处理待确认的时间倒退，新的时间不会覆盖当前状态。';
    return;
  }

  const saved = persistChatState(result.state);
  if (!saved) return;
  if (result.kind === 'pending_rollback') {
    runtimeNotice.value = '';
    return;
  }
  if (result.kind === 'unchanged') {
    runtimeNotice.value = '';
    return;
  }
  if (result.kind === 'forward' && result.jumpDays > settings.automation.largeJumpNoticeDays) {
    runtimeNotice.value = `ℹ 检测到较大时间跳跃（${result.jumpDays} 天），已按新日期记录故事时间。`;
    return;
  }
  if (result.kind === 'same_date') {
    runtimeNotice.value = '故事时间已更新；日期未变化，未操作世界书。';
    return;
  }
  runtimeNotice.value = '故事时间已更新；当前阶段尚未执行世界书条目开关切换。';
}

async function processLatestAssistantMessage(): Promise<void> {
  if (!chatTimelineState.value) await refreshHostScope();
  const latestMessage = readLastAssistantMessageText();
  const nextTime = latestMessage ? parseWlogTime(latestMessage) : null;
  if (!nextTime) {
    showMissingTimeNotice();
    return;
  }
  applyStoryTimeCandidate(nextTime);
}

async function getCurrentTime(): Promise<void> {
  if (timeActionBusy.value) return;
  timeActionBusy.value = true;
  try {
    if (!chatTimelineState.value) await refreshHostScope();
    const latestMessage = readLastAssistantMessageText();
    const nextTime = latestMessage ? parseWlogTime(latestMessage) : null;
    if (!nextTime) {
      showMissingTimeNotice();
      return;
    }
    applyStoryTimeCandidate(nextTime);
  } finally {
    timeActionBusy.value = false;
  }
}

function confirmRollback(): void {
  const state = chatTimelineState.value;
  if (!state?.pendingRollback) return;
  if (persistChatState(confirmStoryTimeRollback(state))) {
    runtimeNotice.value = '已确认应用时间倒退；当前阶段尚未执行世界书条目开关切换。';
  }
}

function rejectRollback(): void {
  const state = chatTimelineState.value;
  if (!state?.pendingRollback) return;
  if (persistChatState(rejectStoryTimeRollback(state))) {
    runtimeNotice.value = '已拒绝时间倒退，继续沿用原故事时间。';
  }
}

function discardAnalysisDraft(): void {
  if (analysisProgress.value) return;
  analysisDraft.value = null;
  analysisDraftScopeKey = '';
  analysisError.value = null;
  analysisNotice.value = '';
}

function toggleAnalysisEntry(groupId: string, entryId: string | number, selected: boolean): void {
  if (!analysisDraft.value) return;
  analysisDraft.value = {
    ...analysisDraft.value,
    groups: analysisDraft.value.groups.map(group => group.id !== groupId ? group : {
      ...group,
      entries: group.entries.map(entry => entry.entryId !== entryId ? entry : {
        ...entry,
        selected,
        manuallyLocked: selected && entry.confidence === 'low' ? true : entry.manuallyLocked,
      }),
    }),
  };
}

function updateAnalysisEntry(groupId: string, entryId: string | number, patch: AnalysisEntryPatch): void {
  if (!analysisDraft.value) return;
  analysisDraft.value = {
    ...analysisDraft.value,
    groups: analysisDraft.value.groups.map(group => group.id !== groupId ? group : {
      ...group,
      entries: group.entries.map(entry => entry.entryId !== entryId ? entry : {
        ...entry,
        ...patch,
        confidence: 'high',
        manuallyLocked: true,
        warnings: [],
      }),
    }),
  };
}

function createAnalysisGroup(name: string): void {
  if (!analysisDraft.value) return;
  analysisDraft.value = {
    ...analysisDraft.value,
    groups: [
      ...analysisDraft.value.groups,
      { id: `manual-group-${Date.now()}`, name, entries: [] },
    ],
  };
}

async function applyAnalysisDraft(): Promise<void> {
  const draft = analysisDraft.value;
  const worldbook = hostScope.value.worldbook;
  const issue = draftApplicationIssue.value;
  if (!draft || !worldbook || issue || analysisApplying.value) {
    analysisError.value = { message: issue || '当前草稿无法应用。' };
    return;
  }

  const scopeKey = hostScopeKey(hostScope.value);
  analysisApplying.value = true;
  analysisError.value = null;
  analysisNotice.value = '';
  try {
    const config = await buildWorldbookTimelineConfig(draft, worldbook);
    if (scopeKey !== hostScopeKey(hostScope.value)) {
      analysisError.value = { message: '角色、聊天或绑定世界书已变化，正式配置未保存。' };
      return;
    }
    if (!saveWorldbookTimelineConfig(config)) {
      analysisError.value = { message: '保存失败：无法写入 SillyTavern 扩展设置。' };
      return;
    }

    worldbookConfig.value = config;
    if (chatTimelineState.value) {
      persistChatState(bindChatTimelineState(
        chatTimelineState.value,
        worldbook.key,
        config.groups.map(group => group.id),
      ));
    }
    analysisDraft.value = null;
    analysisDraftScopeKey = '';
    analysisNotice.value = '时间线配置已保存；当前聊天尚无有效时间时，不会修改世界书条目开关。';
    selectPage('overview');
  } catch (error) {
    analysisError.value = { message: error instanceof Error ? error.message : '正式配置生成失败。' };
  } finally {
    analysisApplying.value = false;
  }
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
        :character-name="characterName"
        :runtime-notice="runtimeNotice"
        :rollback-prompt="rollbackPrompt"
        :story-time="storyTimeLabel"
        :time-action-busy="timeActionBusy"
        :worldbook-name="worldbookName"
        @close="closeTimeline"
        @confirm-rollback="confirmRollback"
        @get-current-time="getCurrentTime"
        @reject-rollback="rejectRollback"
        @select-page="selectPage"
      >
        <Transition name="timeline-page" mode="out-in">
          <OverviewPage
            v-if="uiState.activePage === 'overview'"
            key="overview"
            :groups="overviewGroups"
            :source-entry-count="hostScope.worldbook?.entries.length ?? 0"
            :source-message="hostScope.message"
            :source-status="hostScope.status"
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
            :allow-apply="canApplyAnalysisDraft"
            :apply-blocked-message="draftApplicationIssue ?? ''"
            :applying="analysisApplying"
            :can-start="canStartAnalysis"
            :error="analysisError"
            :notice="analysisNotice"
            :progress="analysisProgress"
            :source-message="analysisSourceMessage"
            @cancel-analysis="cancelAnalysis"
            @apply-draft="applyAnalysisDraft"
            @create-group="createAnalysisGroup"
            @discard-draft="discardAnalysisDraft"
            @start-analysis="startAnalysis"
            @toggle-entry="toggleAnalysisEntry"
            @update-entry="updateAnalysisEntry"
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
