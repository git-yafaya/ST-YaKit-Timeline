<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { AnalysisValidationError, runTimelineScan } from '@/analysis/scanner';
import { TECHNICAL_NAME, VERSION } from '@/branding';
import { generateTimelineAnalysis, testAiConnection } from '@/st/ai-adapter';
import {
  buildWorldbookTimelineConfig,
  createTimelineGroup,
  deleteTimelineGroup,
  getDraftApplicationIssue,
  detectWorldbookConfigStale,
  findWorldbookReconciliationSuggestions,
  findWorldbookConfigMigrationCandidates,
  isWorldbookTimelineConfig,
  loadWorldbookTimelineConfig,
  migrateWorldbookTimelineConfig,
  mergeTimelineGroups,
  mergeWorldbookTimelineConfig,
  moveTimelineEntries,
  renameTimelineGroup,
  reorderTimelineEntries,
  reorderTimelineGroups,
  sanitizeWorldbookTimelineConfig,
  saveWorldbookTimelineConfig,
  splitTimelineGroup,
  type WorldbookTimelineConfig,
} from '@/storage/worldbook-config';
import {
  createSillyTavernWorldbookAdapter,
  readCurrentHostScope,
  readLastAssistantMessageText,
  watchCurrentHostScope,
  watchCurrentHostRuntime,
  type HostScopeSnapshot,
} from '@/st/sillytavern-adapter';
import { formatStoryTime } from '@/timeline/date';
import { syncAutomaticTimeline, toggleManualTimelineEntry } from '@/timeline/engine';
import { validateTimelineGroup } from '@/timeline/matcher';
import { parseWlogTime } from '@/timeline/wlog';
import {
  applyStoryTimeCandidate as applyStoryTimeCandidateToState,
  confirmStoryTimeRollback,
  rejectStoryTimeRollback,
  restoreChatTimelineState,
} from '@/timeline/runtime';
import {
  appendChatRuntimeLog,
  bindChatTimelineState,
  clearChatRuntimeLogs,
  loadChatTimelineState,
  saveChatTimelineState,
  setChatGroupActiveEntry,
  setChatGroupMode,
  setChatManualEntryEnabled,
  type ChatRuntimeLog,
  type ChatTimelineState,
} from '@/storage/chat-state';
import AppShell from '@/ui/components/AppShell.vue';
import { getPageLabel } from '@/ui/navigation';
import AnalysisPage from '@/ui/pages/AnalysisPage.vue';
import {
  moveAnalysisEntry as moveAnalysisEntryDraft,
  renameAnalysisGroup as renameAnalysisGroupDraft,
  reorderAnalysisEntries as reorderAnalysisEntriesDraft,
  reorderAnalysisGroups as reorderAnalysisGroupsDraft,
} from '@/ui/pages/analysis';
import type {
  AnalysisDraft,
  AnalysisDiffItem,
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
import { checkExtensionUpdate, updateExtension } from '@/ui/extension-update';
import { fetchAvailableModels } from '@/ui/model-provider';
import {
  getSharedSecondaryConnection,
  listSharedSecondaryConnections,
  saveSharedSecondaryConnection,
  setActiveSharedSecondaryConnection,
  type SharedSecondaryConnection,
} from '@/ui/shared-secondary-api';
import type {
  AiSettings,
  AiSaveStatus,
  AutomationSettings,
  ConnectionStates,
  GeneralSettings,
  ModelCatalogs,
  SettingsSnapshot,
  ThemeMode,
  UpdateStatus,
} from '@/ui/pages/settings';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  migrateLegacyIndependentApiSettings,
  saveAiSettings,
  saveAutomationSettings,
  saveGeneralSettings,
} from '@/ui/settings-store';
import { detectSillyTavernTheme, resolveTheme, type ResolvedTheme, watchSillyTavernTheme } from '@/ui/theme';
import TimelinePageView from '@/ui/pages/TimelinePage.vue';
import { closeTimeline, type TimelinePage, uiState } from '@/ui/state';
import { buildOverviewGroupSummaries, buildTimelineGroupDetails } from '@/ui/worldbook-view';
import { TimelineControlLock, type ControlStatus } from '@/timeline/control-lock';
import type { EntryId } from '@/timeline/types';

const pageTitle = computed(() => getPageLabel(uiState.activePage));
const analysisDraft = ref<AnalysisDraft | null>(null);
const analysisProgress = ref<AnalysisProgress | null>(null);
const analysisScanMode = ref<AnalysisScanMode | null>(null);
const analysisError = ref<AnalysisErrorState | null>(null);
const analysisNotice = ref('');
const analysisApplying = ref(false);
const systemLogs = ref<TimelineLogEntry[]>([]);
const settings = reactive<SettingsSnapshot>(loadSettings(DEFAULT_SETTINGS));
const sharedSecondaryConnections = ref<SharedSecondaryConnection[]>([]);
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
const extensionUpdateState = reactive<{ message: string; status: UpdateStatus }>({
  message: '打开设置时自动检查更新。',
  status: 'idle',
});
const extensionUpdateName = ref('');
let extensionUpdateController: AbortController | undefined;
let sharedSettingsInitialization: Promise<void> | undefined;
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
const worldbookAdapter = createSillyTavernWorldbookAdapter();
const controlLock = new TimelineControlLock();
const controlStatus = ref<ControlStatus>('unsupported');
const controlWorldbookKey = ref('');
const overviewGroups = computed(() => buildOverviewGroupSummaries(
  worldbookConfig.value,
  hostScope.value.worldbook,
  chatTimelineState.value?.groups ?? {},
));
const timelineGroups = computed(() => buildTimelineGroupDetails(
  worldbookConfig.value,
  hostScope.value.worldbook,
  chatTimelineState.value?.groups ?? {},
));
const managementGroups = computed<readonly GroupManagementSummary[]>(() => {
  const config = worldbookConfig.value;
  if (!config || !hostScope.value.worldbook || config.worldbookKey !== hostScope.value.worldbook.key) return [];
  const sources = new Map(hostScope.value.worldbook.entries.map(entry => [String(entry.id), entry]));
  return config.groups.map(group => ({
    id: group.id,
    name: group.name,
    entries: group.entries.map(entry => ({
      entryId: entry.entryId,
      originalComment: sources.get(String(entry.entryId))?.comment || entry.originalComment,
      origin: entry.manualFields.length > 0 || entry.titleLocked ? 'manual' as const : 'ai' as const,
      rangeLabel: `${entry.effectiveStartDate} ～ ${entry.effectiveEndDate ?? '∞'}`,
      title: entry.displayTitle,
      warning: group.blockReason
        || validateTimelineGroup(group)
        || entry.warnings[0]
        || (entry.stale ? '当前映射可能已过期。' : undefined),
    })),
  }));
});
const runtimeLogs = computed<readonly TimelineLogEntry[]>(() => chatTimelineState.value?.logs ?? []);
const runtimeLogSummary = computed<RuntimeLogSummary>(() => {
  const last = [...runtimeLogs.value].reverse().find(log => log.category === 'worldbook' || log.category === 'time');
  return {
    recentSwitch: last?.occurredAt,
    statusLabel: chatTimelineState.value?.currentTime ? '已获得有效故事时间' : '等待有效故事时间',
  };
});
const systemLogSummary = computed<SystemLogSummary>(() => ({
  controlLabel: controlStatus.value === 'owner' ? '当前标签页持有控制权' : controlStatus.value === 'other' ? '其他标签页持有控制权' : '尚未取得控制权',
  recentError: systemLogs.value.find(log => log.level === 'error' || log.level === 'warning')?.description,
  statusLabel: hostScope.value.status === 'ready' ? '插件运行中' : hostScope.value.message || '等待宿主状态',
}));
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
  return getDraftApplicationIssue(analysisDraft.value, hostScope.value.worldbook);
});
const canApplyAnalysisDraft = computed(() => (
  Boolean(analysisDraft.value) && !analysisApplying.value && draftApplicationIssue.value === null
));
const analysisDiff = computed<readonly AnalysisDiffItem[]>(() => {
  const existing = worldbookConfig.value;
  const draft = analysisDraft.value;
  if (!existing || !draft) return [];
  const oldEntries = existing.groups.flatMap(group => group.entries);
  const oldById = new Map(oldEntries.map(entry => [String(entry.entryId), entry]));
  const used = new Set<string>();
  const diff: AnalysisDiffItem[] = [];
  for (const draftGroup of draft.groups) {
    for (const entry of draftGroup.entries.filter(item => item.selected)) {
      const old = oldById.get(String(entry.entryId));
      const newRange = `${entry.contentStartDate ?? '起点待确认'} ～ ${entry.boundaryDate ?? '∞'}`;
      if (!old) {
        diff.push({ entryId: entry.entryId, newRange, status: 'added', title: entry.title });
        continue;
      }
      used.add(String(old.entryId));
      const oldRange = `${old.effectiveStartDate} ～ ${old.effectiveEndDate ?? '∞'}`;
      const changed = old.displayTitle !== entry.title.trim()
        || old.effectiveStartDate !== entry.contentStartDate
        || (old.boundaryDate ?? '') !== (entry.boundaryDate ?? '');
      diff.push({ entryId: entry.entryId, newRange, oldRange, status: changed ? 'changed' : 'unchanged', title: entry.title });
    }
  }
  for (const old of oldEntries) {
    if (used.has(String(old.entryId))) continue;
    diff.push({
      entryId: old.entryId,
      oldRange: `${old.effectiveStartDate} ～ ${old.effectiveEndDate ?? '∞'}`,
      status: 'removed',
      title: old.displayTitle,
    });
  }
  return diff;
});
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
const worldbookMigrationDecisions = new Set<string>();
let stopWatchingHostTheme: (() => void) | undefined;
let stopWatchingHostScope: (() => void) | undefined;
let stopWatchingHostRuntime: (() => void) | undefined;
let analysisAbortController: AbortController | undefined;
let analysisRequestVersion = 0;
let activeAnalysisScopeKey = '';
let analysisDraftScopeKey = '';
let stopWatchingControl: (() => void) | undefined;
let hostScopeRefreshPromise: Promise<void> | undefined;
let hostScopeRefreshQueued = false;

function logTime(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function appendSystemLog(level: TimelineLogEntry['level'], title: string, description: string, category = 'system'): void {
  systemLogs.value = [
    {
      category,
      description,
      id: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      level,
      occurredAt: logTime(),
      title,
    },
    ...systemLogs.value,
  ].slice(0, 100);
}

function appendRuntimeLog(state: ChatTimelineState, log: Omit<ChatRuntimeLog, 'id' | 'occurredAt'>): ChatTimelineState {
  return appendChatRuntimeLog(state, {
    ...log,
    id: `runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    occurredAt: logTime(),
  });
}

async function ensureWorldbookControl(worldbookKey: string | null, force = false): Promise<boolean> {
  if (!worldbookKey) {
    controlLock.release();
    controlWorldbookKey.value = '';
    controlStatus.value = 'unsupported';
    return false;
  }
  if (controlWorldbookKey.value !== worldbookKey) {
    controlLock.release();
    controlWorldbookKey.value = worldbookKey;
    controlStatus.value = controlLock.status(worldbookKey);
  }
  const acquired = force
    ? controlLock.takeover(worldbookKey)
    : await controlLock.acquire(worldbookKey);
  controlStatus.value = controlLock.status(worldbookKey);
  if (acquired && controlStatus.value === 'owner') {
    runtimeNotice.value = controlStatus.value === 'owner' && runtimeNotice.value.includes('控制权')
      ? ''
      : runtimeNotice.value;
  }
  return acquired;
}

async function syncCurrentTimeline(reason: string, expectedScopeKey = hostScopeKey(hostScope.value)): Promise<void> {
  const config = worldbookConfig.value;
  const state = chatTimelineState.value;
  const worldbook = hostScope.value.worldbook;
  if (!config || !state?.currentTime || !worldbook || config.worldbookKey !== worldbook.key) return;
  if (expectedScopeKey !== hostScopeKey(hostScope.value)) return;

  const hasControl = await ensureWorldbookControl(worldbook.key);
  if (!hasControl) {
    runtimeNotice.value = '当前世界书由其他标签页控制；自动切换已暂停，可接管后继续。';
    appendSystemLog('warning', '自动切换暂停', '其他标签页持有当前世界书控制权。', 'control');
    return;
  }

  const result = await syncAutomaticTimeline({
    adapter: worldbookAdapter,
    config,
    currentTime: state.currentTime,
    state,
    hasControl: () => controlLock.hasControl(worldbook.key),
  });
  if (expectedScopeKey !== hostScopeKey(hostScope.value)) return;

  let nextState = state;
  for (const group of result.groups) {
    if (group.targetEntryId !== undefined && (group.status === 'synced' || group.status === 'unchanged')) {
      nextState = setChatGroupActiveEntry(nextState, group.groupId, group.targetEntryId);
    }
    if (group.status === 'synced') {
      nextState = appendRuntimeLog(nextState, {
        category: 'worldbook',
        description: `${group.message}（${reason}）`,
        level: 'success',
        title: '自动切换完成',
      });
    } else if (group.status === 'blocked' || group.status === 'error') {
      nextState = appendRuntimeLog(nextState, {
        category: 'worldbook',
        description: `${group.message}（分组：${group.groupId}）`,
        level: group.status === 'error' ? 'error' : 'warning',
        title: group.status === 'error' ? '自动切换失败' : '自动切换已阻断',
      });
    }
  }
  if (nextState !== state) persistChatState(nextState);
  const failure = result.groups.find(group => group.status === 'blocked' || group.status === 'error');
  if (failure) {
    runtimeNotice.value = `部分时间线组未切换：${failure.message}`;
  } else if (result.changed && settings.general.showSwitchNotifications) {
    runtimeNotice.value = '已按当前故事时间完成世界书条目切换。';
  }
}

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
  analysisScanMode.value = null;
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
    runtimeNotice.value = '已从当前聊天最近一条 AI 回复恢复故事时间。';
  } else if (!restored.state.currentTime && !restored.state.pendingRollback) {
    runtimeNotice.value = '⚠ 当前聊天尚未获得有效故事时间，请让 AI 输出完整 <wlog>。';
  } else if (!restored.state.pendingRollback) {
    runtimeNotice.value = '';
  }
}

async function refreshHostScopeInternal(): Promise<void> {
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
  let config = snapshot.worldbook
    ? loadWorldbookTimelineConfig(snapshot.worldbook.key)
    : null;
  if (!config && snapshot.worldbook && !worldbookMigrationDecisions.has(snapshot.worldbook.key)) {
    const candidates = await findWorldbookConfigMigrationCandidates(snapshot.worldbook);
    if (version !== hostScopeVersion) return;
    const candidate = candidates[0];
    if (candidate) {
      const sourceName = candidate.config.worldbookName || candidate.config.worldbookKey;
      const migrationMessage = [
        `检测到当前世界书可能由「${sourceName}」改名或重新导入。`,
        `已匹配 ${candidate.matchedEntryCount}/${candidate.totalEntryCount} 个受管条目（相似度 ${candidate.score}%）。`,
        '确认后会迁移插件配置并按正文 Hash 更新条目 ID；不会修改世界书正文或原生字段。',
        '取消则按新世界书处理，旧配置保留但不会接管当前世界书。是否迁移？',
      ].join('\n');
      const shouldMigrate = typeof globalThis.confirm === 'function' && globalThis.confirm(migrationMessage);
      worldbookMigrationDecisions.add(snapshot.worldbook.key);
      if (shouldMigrate) {
        const migrated = await migrateWorldbookTimelineConfig(candidate.config, snapshot.worldbook);
        if (version !== hostScopeVersion) return;
        if (saveWorldbookTimelineConfig(migrated)) {
          config = migrated;
          appendSystemLog(
            'warning',
            '世界书配置已迁移',
            `已从「${sourceName}」迁移 ${candidate.matchedEntryCount} 个受管条目映射。`,
            'config',
          );
        } else {
          worldbookMigrationDecisions.delete(snapshot.worldbook.key);
          appendSystemLog('error', '世界书配置迁移失败', '无法保存迁移后的时间线配置，当前世界书按新配置处理。', 'config');
        }
      } else {
        appendSystemLog('info', '世界书配置未迁移', '用户选择将当前世界书作为新世界书处理。', 'config');
      }
    }
  }
  if (config && snapshot.worldbook) {
    const freshness = await detectWorldbookConfigStale(config, snapshot.worldbook);
    if (version !== hostScopeVersion) return;
    if (freshness.changed) {
      config = freshness.config;
      saveWorldbookTimelineConfig(config);
      appendSystemLog('warning', '检测到世界书正文变化', '旧时间线配置继续保留，建议重新分析当前世界书。', 'config');
    }
  }
  worldbookConfig.value = config;
  restoreChatState(snapshot, config);
  void syncCurrentTimeline('进入当前聊天', nextScopeKey);
}

async function refreshHostScope(): Promise<void> {
  if (hostScopeRefreshPromise) {
    hostScopeRefreshQueued = true;
    const current = hostScopeRefreshPromise;
    await current;
    if (hostScopeRefreshQueued) {
      hostScopeRefreshQueued = false;
      await refreshHostScope();
    }
    return;
  }

  const current = refreshHostScopeInternal();
  hostScopeRefreshPromise = current;
  try {
    await current;
  } finally {
    if (hostScopeRefreshPromise === current) hostScopeRefreshPromise = undefined;
  }
}

onMounted(() => {
  sharedSettingsInitialization = initializeSharedSecondarySettings();
  stopWatchingHostTheme = watchSillyTavernTheme(theme => {
    hostTheme.value = theme;
  });
  stopWatchingControl = controlLock.onChange((key, status) => {
    if (key === controlWorldbookKey.value) controlStatus.value = status;
    if (status === 'other' && key === controlWorldbookKey.value) {
      runtimeNotice.value = '其他标签页已取得当前世界书控制权，自动切换已暂停。';
      appendSystemLog('warning', '控制权变更', '当前标签页不再拥有世界书写控制权。', 'control');
    }
  });
  stopWatchingHostScope = watchCurrentHostScope(() => refreshHostScope());
  stopWatchingHostRuntime = watchCurrentHostRuntime(() => processLatestAssistantMessage());
  void refreshHostScope();
});

onBeforeUnmount(() => {
  stopWatchingHostTheme?.();
  stopWatchingHostScope?.();
  stopWatchingHostRuntime?.();
  stopWatchingControl?.();
  controlLock.close();
  analysisAbortController?.abort();
  extensionUpdateController?.abort();
  if (aiSaveResetTimer !== undefined) globalThis.clearTimeout(aiSaveResetTimer);
});

function selectPage(page: TimelinePage): void {
  uiState.activePage = page;
}

function openAnalysis(): void {
  selectPage('analysis');
}

async function startAnalysis(mode: AnalysisScanMode): Promise<void> {
  if (mode === 'deep') await sharedSettingsInitialization;
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
  analysisScanMode.value = mode;
  const aiSettings = mode === 'deep' ? { ...settings.ai } : null;
  appendSystemLog(
    'info',
    mode === 'quick' ? '开始本地快速扫描' : '开始世界书 AI 分析',
    `${mode === 'quick' ? '快速' : '深度'}扫描已开始。`,
    'analysis',
  );

  try {
    const draft = await runTimelineScan({
      entries: worldbook.entries,
      mode,
      signal: controller.signal,
      generate: mode === 'deep' && aiSettings
        ? (prompt, signal) => generateTimelineAnalysis(aiSettings, prompt, signal)
        : undefined,
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
    appendSystemLog(
      'success',
      mode === 'quick' ? '本地快速扫描完成' : '世界书 AI 分析完成',
      `生成 ${draft.groups.length} 个候选时间线组。`,
      'analysis',
    );
  } catch (error) {
    if (requestVersion !== analysisRequestVersion || controller.signal.aborted) return;
    analysisError.value = {
      message: error instanceof Error ? error.message : mode === 'quick' ? '快速扫描失败' : 'AI 分析失败',
      rawOutput: error instanceof AnalysisValidationError ? error.rawOutput : undefined,
    };
    appendSystemLog(
      'error',
      mode === 'quick' ? '本地快速扫描失败' : '世界书 AI 分析失败',
      analysisError.value.message,
      'analysis',
    );
  } finally {
    if (requestVersion === analysisRequestVersion) {
      analysisProgress.value = null;
      analysisScanMode.value = null;
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
  analysisScanMode.value = null;
  analysisError.value = null;
  analysisNotice.value = '';
}

function showMissingTimeNotice(): void {
  runtimeNotice.value = chatTimelineState.value?.currentTime
    ? '⚠ 本轮未检测到有效时间，已沿用上次时间。请自行重 Roll 或补充完整 <wlog>。'
    : '⚠ 当前聊天尚未获得有效故事时间，请让 AI 输出完整 <wlog>。';
}

async function applyStoryTimeCandidate(nextTime: NonNullable<ReturnType<typeof parseWlogTime>>): Promise<void> {
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
  } else if (result.kind === 'same_date') {
    runtimeNotice.value = '故事时间已更新；日期未变化，未操作世界书。';
    return;
  }
  runtimeNotice.value = '故事时间已更新，正在同步世界书条目…';
  await syncCurrentTimeline(result.kind === 'initial' ? '首次获得故事时间' : '故事时间前进');
}

async function processLatestAssistantMessage(): Promise<void> {
  // MESSAGE_RECEIVED 可能紧接在 CHAT_CHANGED 后到达；先重新确认角色、聊天和世界书作用域，
  // 避免把新聊天的最新时间写进旧聊天状态。
  await refreshHostScope();
  const latestMessage = readLastAssistantMessageText();
  const nextTime = latestMessage ? parseWlogTime(latestMessage) : null;
  if (!nextTime) {
    showMissingTimeNotice();
    return;
  }
  await applyStoryTimeCandidate(nextTime);
}

async function getCurrentTime(): Promise<void> {
  if (timeActionBusy.value) return;
  timeActionBusy.value = true;
  try {
    // 手动读取也必须以当前聊天为准，不能依赖异步宿主事件已经完成刷新。
    await refreshHostScope();
    const latestMessage = readLastAssistantMessageText();
    const nextTime = latestMessage ? parseWlogTime(latestMessage) : null;
    if (!nextTime) {
      showMissingTimeNotice();
      return;
    }
    const before = chatTimelineState.value?.currentTime;
    await applyStoryTimeCandidate(nextTime);
    const after = chatTimelineState.value?.currentTime;
    if (
      before &&
      after &&
      before.year === nextTime.year &&
      before.month === nextTime.month &&
      before.day === nextTime.day &&
      before.hour === nextTime.hour &&
      before.minute === nextTime.minute &&
      after.year === nextTime.year &&
      after.month === nextTime.month &&
      after.day === nextTime.day &&
      after.hour === nextTime.hour &&
      after.minute === nextTime.minute
    ) {
      runtimeNotice.value = `已重新读取当前故事时间：${formatStoryTime(nextTime)}。`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取当前时间失败。';
    runtimeNotice.value = `获取当前时间失败：${message}`;
    appendSystemLog('error', '获取当前时间失败', message, 'time');
  } finally {
    timeActionBusy.value = false;
  }
}

async function confirmRollback(): Promise<void> {
  const state = chatTimelineState.value;
  if (!state?.pendingRollback) return;
  const nextState = confirmStoryTimeRollback(state);
  if (persistChatState(nextState)) {
    runtimeNotice.value = '已确认应用时间倒退，正在同步世界书条目…';
    await syncCurrentTimeline('确认时间倒退');
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
      { id: `manual-group-${Date.now()}`, name, nameLocked: true, orderLocked: true, entries: [] },
    ],
  };
}

function renameAnalysisGroup(groupId: string, name: string): void {
  if (!analysisDraft.value) return;
  analysisDraft.value = renameAnalysisGroupDraft(analysisDraft.value, groupId, name);
}

function reorderAnalysisGroups(orderedGroupIds: readonly string[]): void {
  if (!analysisDraft.value) return;
  analysisDraft.value = reorderAnalysisGroupsDraft(analysisDraft.value, orderedGroupIds);
}

function reorderAnalysisEntries(groupId: string, orderedEntryIds: readonly EntryId[]): void {
  if (!analysisDraft.value) return;
  analysisDraft.value = reorderAnalysisEntriesDraft(analysisDraft.value, groupId, orderedEntryIds);
}

function moveAnalysisEntry(
  sourceGroupId: string,
  targetGroupId: string,
  entryId: EntryId,
  targetEntryId?: EntryId,
): void {
  if (!analysisDraft.value) return;
  analysisDraft.value = moveAnalysisEntryDraft(
    analysisDraft.value,
    sourceGroupId,
    targetGroupId,
    entryId,
    targetEntryId,
  );
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
  const hadExistingConfig = worldbookConfig.value !== null;
  try {
    let confirmedReconciliationKeys: readonly string[] = [];
    if (hadExistingConfig && worldbookConfig.value) {
      const suggestions = await findWorldbookReconciliationSuggestions(worldbookConfig.value, draft, worldbook);
      if (suggestions.length > 0) {
        const details = suggestions.slice(0, 5).map(suggestion => (
          `分组「${suggestion.groupName}」：${String(suggestion.previousEntryId)}「${suggestion.previousComment}」→ ${String(suggestion.currentEntryId)}「${suggestion.currentComment}」（相似度 ${suggestion.score}%）`
        ));
        const more = suggestions.length > details.length ? `\n另有 ${suggestions.length - details.length} 项候选未展开。` : '';
        const message = [
          '检测到疑似由重新导入或重排产生的旧条目映射。',
          ...details,
          more,
          '确认后仅继承旧配置的人工字段；未确认则保留旧映射并停止自动切换。是否继承这些候选？',
        ].filter(Boolean).join('\n');
        if (typeof globalThis.confirm !== 'function' || !globalThis.confirm(message)) {
          analysisNotice.value = '已取消疑似条目继承；旧配置保持不变。';
          return;
        }
        confirmedReconciliationKeys = suggestions.map(suggestion => suggestion.previousKey);
        appendSystemLog(
          'warning',
          '确认疑似条目继承',
          `已确认 ${suggestions.length} 项世界书条目重匹配候选。`,
          'config',
        );
      }
    }
    const config = hadExistingConfig
      && worldbookConfig.value
      ? await mergeWorldbookTimelineConfig(worldbookConfig.value, draft, worldbook, Date.now(), confirmedReconciliationKeys)
      : await buildWorldbookTimelineConfig(draft, worldbook);
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
    analysisNotice.value = hadExistingConfig
      ? '重新分析结果已与旧配置合并；旧映射未被直接删除，需人工处理的条目已停止自动切换。'
      : '时间线配置已保存；当前聊天尚无有效时间时，不会修改世界书条目开关。';
    await syncCurrentTimeline('配置保存', scopeKey);
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

async function resyncTimeline(): Promise<void> {
  if (!chatTimelineState.value?.currentTime) {
    showMissingTimeNotice();
    return;
  }
  runtimeNotice.value = '正在重新同步当前故事时间线…';
  await syncCurrentTimeline('手动重新同步');
}

async function changeGroupMode(groupId: string, mode: 'auto' | 'manual'): Promise<void> {
  const state = chatTimelineState.value;
  if (!state || !worldbookConfig.value) return;
  const group = worldbookConfig.value.groups.find(item => item.id === groupId);
  if (!group || group.blocked) {
    runtimeNotice.value = group?.blockReason || '当前分组存在异常，暂不能切换运行模式。';
    return;
  }
  const nextState = setChatGroupMode(state, groupId, mode);
  if (!persistChatState(nextState)) return;
  runtimeNotice.value = mode === 'manual'
    ? '已切换为手动模式；插件不会再自动改动该组开关。'
    : '已切换为自动模式，正在按当前故事时间校准…';
  if (mode === 'auto' && nextState.currentTime) await syncCurrentTimeline('切换为自动模式');
}

async function toggleEntry(groupId: string, entryId: EntryId, enabled: boolean): Promise<void> {
  const state = chatTimelineState.value;
  const config = worldbookConfig.value;
  const worldbook = hostScope.value.worldbook;
  if (!state || !config || !worldbook) return;
  if (state.groups[groupId]?.mode !== 'manual') {
    runtimeNotice.value = '自动模式下不能手动改动条目开关，请先切换为手动模式。';
    return;
  }
  const hasControl = await ensureWorldbookControl(worldbook.key);
  if (!hasControl) {
    runtimeNotice.value = '当前标签页没有世界书控制权，已阻止手动写入。';
    return;
  }
  try {
    const result = await toggleManualTimelineEntry({
      adapter: worldbookAdapter,
      config,
      entryId,
      enabled,
      groupId,
      hasControl: () => controlLock.hasControl(worldbook.key),
    });
    let nextState = state;
    if (result.status === 'synced' || result.status === 'unchanged') {
      nextState = setChatManualEntryEnabled(nextState, groupId, entryId, enabled);
      nextState = setChatGroupActiveEntry(nextState, groupId, enabled ? entryId : undefined);
    }
    nextState = appendRuntimeLog(nextState, {
      category: 'worldbook',
      description: result.message,
      level: result.status === 'error' ? 'error' : result.status === 'blocked' ? 'warning' : 'success',
      title: result.status === 'blocked' || result.status === 'error' ? '手动开关未完成' : '手动开关已更新',
    });
    persistChatState(nextState);
    runtimeNotice.value = result.message;
  } catch (error) {
    runtimeNotice.value = error instanceof Error ? error.message : '手动世界书写入失败。';
  }
}

function deferConflict(groupId: string, entryId: EntryId): void {
  runtimeNotice.value = `已暂不处理分组 ${groupId} 的条目 ${String(entryId)}；该组仍保持安全阻断。`;
}

function resolveConflict(groupId: string, entryId: EntryId): void {
  selectPage('groups');
  runtimeNotice.value = `已打开分组管理；请修正分组 ${groupId} 中的条目 ${String(entryId)} 后再重新同步。`;
  appendSystemLog('warning', '配置冲突待处理', `分组 ${groupId} 的条目 ${String(entryId)} 仍保持阻断。`, 'config');
}

async function takeWorldbookControl(): Promise<void> {
  if (!controlWorldbookKey.value) return;
  if (!await ensureWorldbookControl(controlWorldbookKey.value, true)) return;
  runtimeNotice.value = '已接管当前世界书控制权，正在重新校准自动时间线。';
  appendSystemLog('info', '接管世界书控制权', `已接管 ${controlWorldbookKey.value}。`, 'control');
  await syncCurrentTimeline('接管控制权');
}

async function saveTimelineConfig(nextConfig: WorldbookTimelineConfig, notice: string): Promise<void> {
  const safeConfig = sanitizeWorldbookTimelineConfig(nextConfig);
  const worldbook = hostScope.value.worldbook;
  if (!worldbook || safeConfig.worldbookKey !== worldbook.key) {
    runtimeNotice.value = '当前角色或世界书已变化，配置未保存。';
    return;
  }
  if (!saveWorldbookTimelineConfig(safeConfig)) {
    runtimeNotice.value = '配置保存失败：无法写入 SillyTavern 扩展设置。';
    return;
  }
  worldbookConfig.value = safeConfig;
  if (chatTimelineState.value) {
    persistChatState(bindChatTimelineState(
      chatTimelineState.value,
      worldbook.key,
      safeConfig.groups.map(group => group.id),
    ));
  }
  runtimeNotice.value = notice;
  appendSystemLog('success', '时间线配置已保存', notice, 'config');
  await syncCurrentTimeline('分组配置变更');
}

function configWithGroups(): WorldbookTimelineConfig | null {
  const current = worldbookConfig.value;
  const worldbook = hostScope.value.worldbook;
  if (current) return current;
  if (!worldbook) return null;
  return { groups: [], updatedAt: Date.now(), worldbookKey: worldbook.key, worldbookName: worldbook.name };
}

async function createGroup(name: string): Promise<void> {
  const config = configWithGroups();
  if (!config) return;
  await saveTimelineConfig(createTimelineGroup(config, name), `已创建分组「${name.trim()}」。`);
}

async function renameGroup(groupId: string, name: string): Promise<void> {
  const config = worldbookConfig.value;
  if (!config) return;
  await saveTimelineConfig(renameTimelineGroup(config, groupId, name), '分组名称已保存。');
}

async function mergeGroup(sourceGroupId: string, targetGroupId: string): Promise<void> {
  const config = worldbookConfig.value;
  if (!config) return;
  await saveTimelineConfig(mergeTimelineGroups(config, sourceGroupId, targetGroupId), '分组已合并；世界书正文未被修改。');
}

async function splitGroup(sourceGroupId: string, name: string, movedEntryIds: readonly EntryId[]): Promise<void> {
  const config = worldbookConfig.value;
  if (!config) return;
  await saveTimelineConfig(splitTimelineGroup(config, sourceGroupId, name, movedEntryIds), '分组已拆分；世界书正文未被修改。');
}

async function deleteGroup(groupId: string): Promise<void> {
  const config = worldbookConfig.value;
  if (!config) return;
  await saveTimelineConfig(deleteTimelineGroup(config, groupId), '分组及其时间线映射已删除；世界书正文未被修改。');
}

async function reorderGroups(orderedGroupIds: readonly string[]): Promise<void> {
  const config = worldbookConfig.value;
  if (!config) return;
  await saveTimelineConfig(reorderTimelineGroups(config, orderedGroupIds), '分组顺序已保存。');
}

async function reorderEntries(groupId: string, orderedEntryIds: readonly EntryId[]): Promise<void> {
  const config = worldbookConfig.value;
  if (!config) return;
  await saveTimelineConfig(reorderTimelineEntries(config, groupId, orderedEntryIds), '条目顺序已保存。');
}

async function moveEntries(sourceGroupId: string, targetGroupId: string, entryIds: readonly EntryId[]): Promise<void> {
  const config = worldbookConfig.value;
  if (!config) return;
  await saveTimelineConfig(moveTimelineEntries(config, sourceGroupId, targetGroupId, entryIds), '条目已跨组移动；已保留为人工配置。');
}

function clearLogs(view: 'runtime' | 'system'): void {
  if (view === 'system') {
    systemLogs.value = [];
    return;
  }
  if (chatTimelineState.value) persistChatState(clearChatRuntimeLogs(chatTimelineState.value));
}

function exportConfig(): void {
  const config = worldbookConfig.value;
  if (!config) {
    runtimeNotice.value = '当前世界书尚未建立可导出的时间线配置。';
    return;
  }
  const payload = JSON.stringify({ version: 1, config }, null, 2);
  const url = globalThis.URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${TECHNICAL_NAME}-${config.worldbookKey}.json`;
  anchor.click();
  globalThis.URL.revokeObjectURL(url);
  appendSystemLog('info', '配置已导出', '导出文件仅包含当前世界书时间线配置，不包含 API Key。', 'config');
  runtimeNotice.value = '时间线配置已导出。';
}

async function importConfig(file: File): Promise<void> {
  const worldbook = hostScope.value.worldbook;
  if (!worldbook) {
    runtimeNotice.value = '当前世界书不可读取，无法导入配置。';
    return;
  }
  try {
    const raw: unknown = JSON.parse(await file.text());
    const payload = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { config?: unknown }).config ?? raw
      : raw;
    if (!isWorldbookTimelineConfig(payload)) {
      runtimeNotice.value = '导入失败：文件不是有效的时间线配置。';
      return;
    }
    if (payload.worldbookKey !== worldbook.key) {
      runtimeNotice.value = '导入失败：配置所属世界书与当前角色绑定世界书不一致。';
      return;
    }
    const safePayload = sanitizeWorldbookTimelineConfig(payload);
    const invalidGroup = safePayload.groups
      .map(group => ({ group, reason: validateTimelineGroup(group) }))
      .find(item => item.reason);
    if (invalidGroup?.reason) {
      runtimeNotice.value = `导入失败：分组「${invalidGroup.group.name}」配置无效：${invalidGroup.reason}`;
      return;
    }
    const importedEntryIds = safePayload.groups.flatMap(group => group.entries.map(entry => String(entry.entryId)));
    if (new Set(importedEntryIds).size !== importedEntryIds.length) {
      runtimeNotice.value = '导入失败：同一世界书条目被多个分组重复纳管。';
      return;
    }
    const reconciledPayload = await migrateWorldbookTimelineConfig(safePayload, worldbook);
    const freshness = await detectWorldbookConfigStale(reconciledPayload, worldbook);
    const checkedPayload = freshness.config;
    const sourceIds = new Set(worldbook.entries.map(entry => String(entry.id)));
    const importedIds = new Set(safePayload.groups.flatMap(group => group.entries).map(entry => String(entry.entryId)));
    const checkedEntries = checkedPayload.groups.flatMap(group => group.entries);
    const missing = checkedEntries
      .filter(entry => !sourceIds.has(String(entry.entryId)));
    const rematched = checkedEntries.filter(entry => !importedIds.has(String(entry.entryId)));
    const hashChanged = checkedEntries.filter(entry => (
      entry.stale && sourceIds.has(String(entry.entryId))
    ));
    const currentEntries = worldbookConfig.value?.groups.flatMap(group => group.entries) ?? [];
    const currentById = new Map(currentEntries.map(entry => [String(entry.entryId), entry]));
    const checkedById = new Map(checkedEntries.map(entry => [String(entry.entryId), entry]));
    const added = checkedEntries.filter(entry => !currentById.has(String(entry.entryId)));
    const removed = currentEntries.filter(entry => !checkedById.has(String(entry.entryId)));
    const changed = checkedEntries.filter(entry => {
      const previous = currentById.get(String(entry.entryId));
      return Boolean(previous && (
        previous.displayTitle !== entry.displayTitle
        || previous.effectiveStartDate !== entry.effectiveStartDate
        || previous.effectiveEndDate !== entry.effectiveEndDate
        || previous.contentHash !== entry.contentHash
      ));
    });
    const confirmation = [
      `已校验当前世界书：${checkedPayload.groups.length} 个时间线组。`,
      `差异：新增 ${added.length}、变化 ${changed.length}、旧映射待处理 ${removed.length}。`,
      rematched.length > 0 ? `已按正文 Hash 重新匹配 ${rematched.length} 个条目。` : '',
      hashChanged.length > 0 ? `${hashChanged.length} 个条目正文 Hash 已变化，旧映射会标记为 stale 并暂停自动切换。` : '',
      missing.length > 0 ? `${missing.length} 个原条目当前不存在，将保留为 stale 并停止自动切换。` : '',
      '确认后会更新插件配置；不会直接修改世界书正文或未受管条目。',
    ].filter(Boolean).join('\n');
    if (!globalThis.confirm(confirmation)) return;
    await saveTimelineConfig({ ...checkedPayload, worldbookName: worldbook.name }, '配置已导入；当前聊天自动组正在重新校准。');
    appendSystemLog('info', '配置已导入', `已校验并导入 ${checkedPayload.groups.length} 个时间线组。`, 'config');
  } catch (error) {
    runtimeNotice.value = error instanceof Error ? `导入失败：${error.message}` : '导入失败：JSON 文件无法读取。';
  }
}

function saveGeneral(nextSettings: GeneralSettings): void {
  settings.general = { ...nextSettings };
  saveGeneralSettings(nextSettings);
}

function applySharedSecondaryConnection(connection: SharedSecondaryConnection): void {
  settings.ai = {
    ...settings.ai,
    apiKey: '',
    apiKeyConfigured: Boolean(connection.secretId),
    apiUrl: connection.apiUrl,
    model: connection.model,
    secondaryConnectionId: connection.id,
    secondaryConnectionName: connection.name,
    secretId: connection.secretId,
  };
}

async function initializeSharedSecondarySettings(): Promise<void> {
  try {
    const currentSettings = { ...settings.ai };
    const migratedSettings = await migrateLegacyIndependentApiSettings(currentSettings);
    if (migratedSettings !== currentSettings) {
      settings.ai = migratedSettings;
      appendSystemLog('success', '副 API 已安全迁移', '旧理脉副 API 已迁入 YaKit 家族共享连接与 SillyTavern Secrets。', 'api');
    }
  } catch (error) {
    appendSystemLog(
      'warning',
      '旧副 API 迁移待重试',
      error instanceof Error ? error.message : '无法将旧副 API 安全迁入共享连接。',
      'api',
    );
  }
  refreshSharedSecondaryConnections();
}

function refreshSharedSecondaryConnections(): void {
  try {
    sharedSecondaryConnections.value = listSharedSecondaryConnections();
    const selected = getSharedSecondaryConnection(settings.ai.secondaryConnectionId)
      ?? getSharedSecondaryConnection();
    if (selected) {
      const sharedConfigured = Boolean(selected.apiUrl || selected.model || selected.secretId);
      const hasLegacyDraft = Boolean(settings.ai.apiUrl || settings.ai.model || settings.ai.apiKey);
      if (sharedConfigured || !hasLegacyDraft) applySharedSecondaryConnection(selected);
      else {
        settings.ai.secondaryConnectionId = selected.id;
        settings.ai.secondaryConnectionName = selected.name;
      }
    }
  } catch (error) {
    sharedSecondaryConnections.value = [];
    appendSystemLog(
      'warning',
      '共享副 API 读取失败',
      error instanceof Error ? error.message : '无法读取 YaKit 家族共享副 API 配置。',
      'api',
    );
  }
}

function selectSharedSecondaryConnection(connectionId: string): void {
  try {
    const connection = setActiveSharedSecondaryConnection(connectionId);
    applySharedSecondaryConnection(connection);
    sharedSecondaryConnections.value = listSharedSecondaryConnections();
  } catch (error) {
    aiSaveStatus.value = 'error';
    aiSaveMessage.value = error instanceof Error ? error.message : '切换共享副 API 失败';
  }
}

async function persistSharedSecondarySettings(nextSettings: AiSettings): Promise<AiSettings> {
  const shouldPersist = nextSettings.provider === 'independent'
    || Boolean(nextSettings.apiUrl || nextSettings.apiKey || nextSettings.secretId);
  if (!shouldPersist) return nextSettings;
  const connection = await saveSharedSecondaryConnection({
    id: nextSettings.secondaryConnectionId || undefined,
    name: nextSettings.secondaryConnectionName,
    apiUrl: nextSettings.apiUrl,
    apiKey: nextSettings.apiKey,
    model: nextSettings.model,
    secretId: nextSettings.secretId,
  });
  sharedSecondaryConnections.value = listSharedSecondaryConnections();
  return {
    ...nextSettings,
    apiKey: '',
    apiKeyConfigured: Boolean(connection.secretId),
    apiUrl: connection.apiUrl,
    model: connection.model,
    secondaryConnectionId: connection.id,
    secondaryConnectionName: connection.name,
    secretId: connection.secretId,
  };
}

async function saveAi(nextSettings: AiSettings): Promise<void> {
  if (aiSaveStatus.value === 'saving') return;
  aiSaveStatus.value = 'saving';
  aiSaveMessage.value = '正在安全保存 AI 设置…';
  try {
    const persistedSettings = await persistSharedSecondarySettings(nextSettings);
    const saved = saveAiSettings(persistedSettings);
    aiSaveStatus.value = saved ? 'saved' : 'error';
    aiSaveMessage.value = saved ? 'AI 设置已保存' : '保存失败：无法写入 SillyTavern 扩展设置';
    appendSystemLog(saved ? 'success' : 'error', saved ? 'AI 设置已保存' : 'AI 设置保存失败', aiSaveMessage.value, 'settings');
    if (saved) settings.ai = { ...persistedSettings };
  } catch (error) {
    aiSaveStatus.value = 'error';
    aiSaveMessage.value = error instanceof Error ? error.message : '保存共享副 API 失败';
    appendSystemLog('error', 'AI 设置保存失败', aiSaveMessage.value, 'settings');
  }

  if (aiSaveResetTimer !== undefined) globalThis.clearTimeout(aiSaveResetTimer);
  aiSaveResetTimer = globalThis.setTimeout(() => {
    aiSaveStatus.value = 'idle';
    aiSaveMessage.value = '';
  }, 3000);
}

async function checkForUpdate(force = false): Promise<void> {
  if (extensionUpdateState.status === 'checking' || extensionUpdateState.status === 'updating') return;
  if (!force && extensionUpdateState.status === 'available') return;

  extensionUpdateController?.abort();
  const controller = new AbortController();
  extensionUpdateController = controller;
  extensionUpdateState.status = 'checking';
  extensionUpdateState.message = '正在检查新版本…';

  try {
    const result = await checkExtensionUpdate(controller.signal);
    if (controller.signal.aborted) return;
    extensionUpdateName.value = result.extensionName;
    extensionUpdateState.status = result.isUpToDate ? 'up-to-date' : 'available';
    extensionUpdateState.message = result.isUpToDate
      ? '当前已是最新版本。'
      : '发现可用更新，是否更新由你决定。';
  } catch (error) {
    if (controller.signal.aborted) return;
    extensionUpdateState.status = 'error';
    extensionUpdateState.message = `检查更新失败：${error instanceof Error ? error.message : '无法连接到更新服务'}`;
  } finally {
    if (extensionUpdateController === controller) extensionUpdateController = undefined;
  }
}

async function updateInstalledExtension(): Promise<void> {
  if (extensionUpdateState.status !== 'available' || !extensionUpdateName.value) return;
  extensionUpdateState.status = 'updating';
  extensionUpdateState.message = '正在更新扩展…';

  try {
    const result = await updateExtension(extensionUpdateName.value);
    if (result.isUpToDate) {
      extensionUpdateState.status = 'up-to-date';
      extensionUpdateState.message = '当前已是最新版本。';
    } else {
      extensionUpdateState.status = 'updated';
      extensionUpdateState.message = `更新完成${result.shortCommitHash ? `（${result.shortCommitHash}）` : ''}，正在刷新页面…`;
      globalThis.location.reload();
    }
  } catch (error) {
    extensionUpdateState.status = 'error';
    extensionUpdateState.message = `更新失败：${error instanceof Error ? error.message : '宿主拒绝了更新请求'}`;
  }
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
    const requestSettings = provider === 'independent'
      ? await persistSharedSecondarySettings(nextSettings)
      : nextSettings;
    if (provider === 'independent') settings.ai = { ...requestSettings };
    const models = await fetchAvailableModels(requestSettings);
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
  const connection = connectionStates[provider];
  connection.status = 'testing';
  connection.message = '正在测试连接…';

  try {
    const requestSettings = provider === 'independent'
      ? await persistSharedSecondarySettings(nextSettings)
      : nextSettings;
    if (provider === 'independent') settings.ai = { ...requestSettings };
    const result = await testAiConnection(requestSettings, new AbortController().signal);
    if (connectionVersion !== connectionRequestVersions[provider]) return;
    connection.status = 'connected';
    connection.message = `连接成功，${result}`;
    appendSystemLog('success', 'API 连接测试成功', connection.message, 'api');
  } catch (error) {
    if (connectionVersion !== connectionRequestVersions[provider]) return;
    const message = error instanceof Error ? error.message : '连接测试失败';
    connection.status = 'error';
    connection.message = message;
    appendSystemLog('error', 'API 连接测试失败', message, 'api');
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
        :control-status="controlStatus"
        :runtime-notice="runtimeNotice"
        :rollback-prompt="rollbackPrompt"
        :story-time="storyTimeLabel"
        :time-action-busy="timeActionBusy"
        :worldbook-name="worldbookName"
        @close="closeTimeline"
        @confirm-rollback="confirmRollback"
        @get-current-time="getCurrentTime"
        @reject-rollback="rejectRollback"
        @take-control="takeWorldbookControl"
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
            @change-mode="changeGroupMode"
            @defer-conflict="deferConflict"
            @resolve-conflict="resolveConflict"
            @resync="resyncTimeline"
            @start-analysis="openAnalysis"
            @toggle-entry="toggleEntry"
          />

          <GroupPage
            v-else-if="uiState.activePage === 'groups'"
            key="groups"
            :groups="managementGroups"
            @create-group="createGroup"
            @delete-group="deleteGroup"
            @merge-group="mergeGroup"
            @move-entries="moveEntries"
            @rename-group="renameGroup"
            @reorder-entries="reorderEntries"
            @reorder-groups="reorderGroups"
            @split-group="splitGroup"
            @start-analysis="openAnalysis"
          />

          <AnalysisPage
            v-else-if="uiState.activePage === 'analysis'"
            key="analysis"
            :draft="analysisDraft"
            :diff="analysisDiff"
            :scan-mode="analysisScanMode"
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
            @move-entry="moveAnalysisEntry"
            @rename-group="renameAnalysisGroup"
            @reorder-entries="reorderAnalysisEntries"
            @reorder-groups="reorderAnalysisGroups"
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
            @clear-logs="clearLogs"
          />

          <SettingsPage
            v-else-if="uiState.activePage === 'settings'"
            key="settings"
            :ai-save-message="aiSaveMessage"
            :ai-save-status="aiSaveStatus"
            :connection-states="connectionStates"
            :model-catalogs="modelCatalogs"
            :secondary-connections="sharedSecondaryConnections"
            :settings="settings"
            :update-message="extensionUpdateState.message"
            :update-status="extensionUpdateState.status"
            :version="VERSION"
            @request-models="requestModels"
            @refresh-secondary-connections="refreshSharedSecondaryConnections"
            @export-config="exportConfig"
            @import-config="importConfig"
            @save-ai="saveAi"
            @save-automation="saveAutomation"
            @save-general="saveGeneral"
            @test-connection="testConnection"
            @select-secondary-connection="selectSharedSecondaryConnection"
            @theme-change="changeTheme"
            @check-update="checkForUpdate"
            @update-extension="updateInstalledExtension"
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
