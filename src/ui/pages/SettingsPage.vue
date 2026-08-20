<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { PRODUCT_NAME } from '@/branding';
import { DEFAULT_FIXED_PROMPT, DEFAULT_JAILBREAK_PROMPT } from '@/st/ai-prompts';
import DeepListbox from '@/ui/components/DeepListbox.vue';
import ThemeSelector from '@/ui/components/ThemeSelector.vue';
import type { DeepListboxOption } from '@/ui/components/deep-listbox';
import { getPromptStatus } from '@/ui/prompt-status';
import type { SharedSecondaryConnection } from '@/ui/shared-secondary-api';
import type {
  AiSettings,
  AiSaveStatus,
  ApiProvider,
  AutomationSettings,
  ConnectionStates,
  GeneralSettings,
  ModelCatalogs,
  SettingsCategory,
  SettingsSnapshot,
  ThemeMode,
  UpdateStatus,
} from '@/ui/pages/settings';

const props = withDefaults(
  defineProps<{
    aiSaveMessage?: string;
    aiSaveStatus?: AiSaveStatus;
    connectionStates?: ConnectionStates;
    modelCatalogs?: ModelCatalogs;
    secondaryConnections?: readonly SharedSecondaryConnection[];
    settings: SettingsSnapshot;
    updateMessage?: string;
    updateStatus?: UpdateStatus;
    version: string;
  }>(),
  {
    aiSaveMessage: '',
    aiSaveStatus: 'idle',
    connectionStates: () => ({
      sillytavern: { status: 'idle', message: '' },
      independent: { status: 'idle', message: '' },
    }),
    modelCatalogs: () => ({
      sillytavern: { status: 'idle', models: [], message: '' },
      independent: { status: 'idle', models: [], message: '' },
    }),
    secondaryConnections: () => [],
    updateMessage: '打开设置时自动检查更新。',
    updateStatus: 'idle',
  },
);

const emit = defineEmits<{
  exportConfig: [];
  importConfig: [file: File];
  requestModels: [settings: AiSettings];
  refreshSecondaryConnections: [];
  saveAi: [settings: AiSettings];
  saveAutomation: [settings: AutomationSettings];
  saveGeneral: [settings: GeneralSettings];
  testConnection: [settings: AiSettings];
  selectSecondaryConnection: [connectionId: string];
  themeChange: [theme: ThemeMode];
  checkUpdate: [force?: boolean];
  updateExtension: [];
}>();

onMounted(() => {
  emit('checkUpdate');
  emit('refreshSecondaryConnections');
});

const expandedCategory = ref<SettingsCategory | null>(null);
const themeDraft = ref<ThemeMode>('follow');
const notificationDraft = ref(true);
const providerDraft = ref<ApiProvider>('sillytavern');
const apiUrlDraft = ref('');
const apiKeyDraft = ref('');
const apiKeyConfiguredDraft = ref(false);
const secondaryConnectionIdDraft = ref('');
const secondaryConnectionNameDraft = ref('副 API 1');
const secretIdDraft = ref('');
const jailbreakPromptDraft = ref('');
const fixedPromptDraft = ref('');
const jailbreakPromptDialogOpen = ref(false);
const jailbreakPromptModalDraft = ref('');
const fixedPromptDialogOpen = ref(false);
const fixedPromptModalDraft = ref('');
const modelDraft = ref('');
const primaryModelDraft = ref('');
const temperatureDraft = ref(0.9);
const maxTokensDraft = ref(23333);
const timeoutDraft = ref(180);
const jumpDaysDraft = ref('5');
const showApiKey = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const jailbreakPromptDialogInput = ref<HTMLTextAreaElement | null>(null);
const fixedPromptDialogInput = ref<HTMLTextAreaElement | null>(null);

const categories: ReadonlyArray<{ description: string; id: SettingsCategory; label: string }> = [
  { id: 'general', label: '常规', description: '基础行为与显示偏好' },
  { id: 'analysis', label: 'AI 分析', description: '模型、接口与连接' },
  { id: 'prompts', label: '自定义提示词', description: '破限、固定与后续扩展提示' },
  { id: 'automation', label: '自动切换', description: '时间变化与提醒' },
  { id: 'data', label: '数据管理', description: '导入、导出与安全' },
];

const jumpDayOptions: readonly DeepListboxOption[] = [5, 10, 15, 20, 25, 30].map(days => ({
  value: String(days),
  label: `${days} 天`,
}));
const secondaryConnectionOptions = computed<readonly DeepListboxOption[]>(() => props.secondaryConnections.map(connection => ({
  value: connection.id,
  label: connection.model ? `${connection.name} · ${connection.model}` : connection.name,
})));

function normalizeJumpDays(days: number): string {
  const value = String(Math.round(Number(days)));
  return jumpDayOptions.some(option => option.value === value) ? value : '5';
}

const currentConnectionState = computed(() => props.connectionStates[providerDraft.value]);
const connectionLabel = computed(() => {
  if (currentConnectionState.value.message) return currentConnectionState.value.message;
  if (currentConnectionState.value.status === 'testing') return '正在测试连接…';
  if (currentConnectionState.value.status === 'connected') return '连接成功';
  if (currentConnectionState.value.status === 'error') return '连接失败';
  return '尚未测试';
});

const currentModelCatalog = computed(() => props.modelCatalogs[providerDraft.value]);
const fetchedModelOptions = computed<readonly DeepListboxOption[]>(() => {
  const models = [...currentModelCatalog.value.models];
  const currentModel = (providerDraft.value === 'sillytavern' ? primaryModelDraft.value : modelDraft.value).trim();
  if (currentModel && !models.includes(currentModel)) models.unshift(currentModel);
  return models.map(model => ({ value: model, label: model }));
});
const modelStatusLabel = computed(() => {
  if (currentModelCatalog.value.status === 'loading') return '正在获取模型…';
  if (currentModelCatalog.value.status === 'idle') return '点击“获取模型”加载可用模型列表。';
  return currentModelCatalog.value.message;
});
const jailbreakPromptStatus = computed(() => getPromptStatus(
  jailbreakPromptDraft.value,
  DEFAULT_JAILBREAK_PROMPT,
));
const fixedPromptStatus = computed(() => getPromptStatus(
  fixedPromptDraft.value,
  DEFAULT_FIXED_PROMPT,
));
const jailbreakPromptModalStatus = computed(() => getPromptStatus(
  jailbreakPromptModalDraft.value,
  DEFAULT_JAILBREAK_PROMPT,
));
const fixedPromptModalStatus = computed(() => getPromptStatus(
  fixedPromptModalDraft.value,
  DEFAULT_FIXED_PROMPT,
));
const hasCustomizedPrompts = computed(() => (
  jailbreakPromptStatus.value.isCustomized || fixedPromptStatus.value.isCustomized
));

function promptSummary(prompt: string, isCustomized: boolean): string {
  const length = prompt.trim().length;
  if (isCustomized) return length > 0 ? `自定义内容 · ${length} 字` : '自定义内容 · 当前为空';
  return `预设内容 · ${length} 字`;
}

const jailbreakPromptSummary = computed(() => {
  return promptSummary(jailbreakPromptDraft.value, jailbreakPromptStatus.value.isCustomized);
});
const fixedPromptSummary = computed(() => {
  return promptSummary(fixedPromptDraft.value, fixedPromptStatus.value.isCustomized);
});

watch(
  () => props.settings.general,
  general => {
    themeDraft.value = general.theme;
    notificationDraft.value = general.showSwitchNotifications;
  },
  { immediate: true, deep: true },
);

watch(
  () => props.settings.ai,
  ai => {
    providerDraft.value = ai.provider;
    apiUrlDraft.value = ai.apiUrl;
    apiKeyDraft.value = ai.apiKey;
    apiKeyConfiguredDraft.value = ai.apiKeyConfigured;
    secondaryConnectionIdDraft.value = ai.secondaryConnectionId;
    secondaryConnectionNameDraft.value = ai.secondaryConnectionName;
    secretIdDraft.value = ai.secretId;
    jailbreakPromptDraft.value = ai.jailbreakPrompt;
    fixedPromptDraft.value = ai.fixedPrompt;
    modelDraft.value = ai.model;
    primaryModelDraft.value = ai.primaryModel;
    temperatureDraft.value = ai.temperature;
    maxTokensDraft.value = ai.maxOutputTokens;
    timeoutDraft.value = ai.timeoutSeconds;
    showApiKey.value = false;
  },
  { immediate: true, deep: true },
);

watch(
  () => props.settings.automation,
  automation => {
    jumpDaysDraft.value = normalizeJumpDays(automation.largeJumpNoticeDays);
  },
  { immediate: true, deep: true },
);

function currentAiSettings(): AiSettings {
  return {
    provider: providerDraft.value,
    apiUrl: apiUrlDraft.value.trim(),
    apiKey: apiKeyDraft.value,
    apiKeyConfigured: apiKeyConfiguredDraft.value,
    jailbreakPrompt: jailbreakPromptDraft.value,
    fixedPrompt: fixedPromptDraft.value.trim() ? fixedPromptDraft.value : DEFAULT_FIXED_PROMPT,
    model: modelDraft.value.trim(),
    primaryModel: primaryModelDraft.value.trim(),
    secondaryConnectionId: secondaryConnectionIdDraft.value,
    secondaryConnectionName: secondaryConnectionNameDraft.value.trim(),
    secretId: secretIdDraft.value,
    temperature: Math.max(0, Math.min(2, Number(temperatureDraft.value) || 0)),
    maxOutputTokens: Math.max(1, Math.round(Number(maxTokensDraft.value) || 1)),
    timeoutSeconds: Math.max(1, Math.round(Number(timeoutDraft.value) || 1)),
  };
}

function toggleCategory(category: SettingsCategory): void {
  expandedCategory.value = expandedCategory.value === category ? null : category;
}

function toggleNotifications(): void {
  notificationDraft.value = !notificationDraft.value;
  emit('saveGeneral', {
    theme: themeDraft.value,
    showSwitchNotifications: notificationDraft.value,
  });
}

function selectTheme(theme: string): void {
  if (theme !== 'follow' && theme !== 'light' && theme !== 'dark') return;
  themeDraft.value = theme;
  emit('themeChange', theme);
}

function selectJumpDays(days: string): void {
  if (!jumpDayOptions.some(option => option.value === days)) return;
  jumpDaysDraft.value = days;
}

function selectModel(model: string): void {
  if (!fetchedModelOptions.value.some(option => option.value === model)) return;
  if (providerDraft.value === 'sillytavern') primaryModelDraft.value = model;
  else modelDraft.value = model;
}

function selectSecondaryConnection(connectionId: string): void {
  const connection = props.secondaryConnections.find(item => item.id === connectionId);
  if (!connection) return;
  secondaryConnectionIdDraft.value = connection.id;
  secondaryConnectionNameDraft.value = connection.name;
  apiUrlDraft.value = connection.apiUrl;
  apiKeyDraft.value = '';
  apiKeyConfiguredDraft.value = Boolean(connection.secretId);
  secretIdDraft.value = connection.secretId;
  modelDraft.value = connection.model;
  emit('selectSecondaryConnection', connection.id);
}

function createSecondaryConnectionDraft(): void {
  secondaryConnectionIdDraft.value = '';
  secondaryConnectionNameDraft.value = '';
  apiUrlDraft.value = '';
  apiKeyDraft.value = '';
  apiKeyConfiguredDraft.value = false;
  secretIdDraft.value = '';
  modelDraft.value = '';
  showApiKey.value = false;
}

function requestModels(): void {
  emit('requestModels', currentAiSettings());
}

function saveAi(): void {
  emit('saveAi', currentAiSettings());
}

async function openJailbreakPromptDialog(): Promise<void> {
  jailbreakPromptModalDraft.value = jailbreakPromptDraft.value;
  jailbreakPromptDialogOpen.value = true;
  await nextTick();
  jailbreakPromptDialogInput.value?.focus();
}

function closeJailbreakPromptDialog(): void {
  jailbreakPromptDialogOpen.value = false;
}

function saveJailbreakPromptDialog(): void {
  jailbreakPromptDraft.value = jailbreakPromptModalDraft.value;
  closeJailbreakPromptDialog();
  saveAi();
}

function resetJailbreakPromptDialog(): void {
  jailbreakPromptModalDraft.value = DEFAULT_JAILBREAK_PROMPT;
}

async function openFixedPromptDialog(): Promise<void> {
  fixedPromptModalDraft.value = fixedPromptDraft.value;
  fixedPromptDialogOpen.value = true;
  await nextTick();
  fixedPromptDialogInput.value?.focus();
}

function closeFixedPromptDialog(): void {
  fixedPromptDialogOpen.value = false;
}

function saveFixedPromptDialog(): void {
  fixedPromptDraft.value = fixedPromptModalDraft.value.trim() ? fixedPromptModalDraft.value : DEFAULT_FIXED_PROMPT;
  closeFixedPromptDialog();
  saveAi();
}

function resetFixedPromptDialog(): void {
  fixedPromptModalDraft.value = DEFAULT_FIXED_PROMPT;
}

function requestUpdateCheck(): void {
  emit('checkUpdate', true);
}

function testConnection(): void {
  emit('testConnection', currentAiSettings());
}

function saveAutomation(): void {
  emit('saveAutomation', {
    largeJumpNoticeDays: Number(jumpDaysDraft.value) || 5,
  });
}

function chooseImportFile(): void {
  fileInput.value?.click();
}

function captureFileInput(input: unknown): void {
  fileInput.value = input instanceof HTMLInputElement ? input : null;
}

function onImportFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) emit('importConfig', file);
  input.value = '';
}
</script>

<template>
  <div class="settings-page">
    <div class="page-heading settings-heading">
      <div>
        <h1>设置</h1>
        <p>配置 {{ PRODUCT_NAME }} 的分析、切换与数据选项。</p>
      </div>
      <div class="settings-version-area">
        <button
          :class="['settings-version-button', `is-${updateStatus}`]"
          type="button"
          :disabled="updateStatus === 'checking' || updateStatus === 'updating'"
          :aria-busy="updateStatus === 'checking' || updateStatus === 'updating'"
          aria-label="检查 YaKit-理脉更新"
          @click="requestUpdateCheck"
        >
          <span>当前版本</span>
          <strong>v{{ version }}</strong>
          <i :class="{ 'is-spinning': updateStatus === 'checking' || updateStatus === 'updating' }" aria-hidden="true">↻</i>
        </button>
        <div v-if="updateStatus === 'available' || updateStatus === 'updating'" class="settings-update-row">
          <span>{{ updateStatus === 'updating' ? '正在更新…' : '发现新版本' }}</span>
          <button
            class="settings-update-action"
            type="button"
            :disabled="updateStatus === 'updating'"
            :aria-busy="updateStatus === 'updating'"
            @click="emit('updateExtension')"
          >
            {{ updateStatus === 'updating' ? '更新中…' : '更新' }}
          </button>
        </div>
        <small :class="['settings-version-message', `is-${updateStatus}`]" aria-live="polite">{{ updateMessage }}</small>
      </div>
    </div>

    <div class="settings-accordion-list">
        <article
          v-for="category in categories"
          :key="category.id"
          :class="['settings-accordion-card', { 'is-expanded': expandedCategory === category.id }]"
        >
          <button
            class="settings-accordion-trigger"
            type="button"
            :aria-expanded="expandedCategory === category.id"
            :aria-controls="`settings-panel-${category.id}`"
            @click="toggleCategory(category.id)"
          >
            <span>
              <strong>
                {{ category.label }}
                <span
                  v-if="category.id === 'prompts' && hasCustomizedPrompts"
                  class="settings-category-status"
                >含已修改项</span>
              </strong>
              <small>{{ category.description }}</small>
            </span>
            <i aria-hidden="true"></i>
          </button>

          <Transition name="settings-accordion">
            <div
              v-if="expandedCategory === category.id"
              :id="`settings-panel-${category.id}`"
              class="settings-accordion-content"
              role="region"
              :aria-label="category.label"
            >
              <div class="settings-accordion-inner">
              <template v-if="category.id === 'general'">
                <div class="settings-section settings-theme-section">
                  <div class="settings-theme-row">
                    <div class="settings-theme-copy">
                      <strong>主题</strong>
                      <span>选择 {{ PRODUCT_NAME }} 的颜色主题，不会修改 SillyTavern 全局主题。</span>
                    </div>
                    <ThemeSelector
                      :model-value="themeDraft"
                      @update:model-value="selectTheme"
                    />
                  </div>
                  <p class="settings-theme-help">跟随模式直接继承 SillyTavern 用户设置的主题变量，不额外判断系统主题。</p>
                </div>
                <div class="settings-row">
                  <div><strong>切换成功通知</strong><p>时间线自动切换成功后显示提示消息。</p></div>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="notificationDraft"
                    :class="['settings-toggle', { 'is-enabled': notificationDraft }]"
                    @click="toggleNotifications"
                  ><span></span></button>
                </div>
                <p class="settings-help settings-help--section">主题与通知设置会立即保存。</p>
              </template>

              <template v-else-if="category.id === 'analysis'">
                <div class="settings-section">
                  <span class="settings-section-label">接口提供商</span>
                  <div class="provider-options" role="radiogroup" aria-label="接口提供商">
                    <button type="button" role="radio" :aria-checked="providerDraft === 'sillytavern'" :class="{ 'is-active': providerDraft === 'sillytavern' }" @click="providerDraft = 'sillytavern'">
                      <span aria-hidden="true">⌁</span>
                      <div><strong>跟随主 API</strong><small>使用 SillyTavern 当前主 API / 当前模型</small></div>
                      <i v-if="providerDraft === 'sillytavern'">✓</i>
                    </button>
                    <button type="button" role="radio" :aria-checked="providerDraft === 'independent'" :class="{ 'is-active': providerDraft === 'independent' }" @click="providerDraft = 'independent'">
                      <span aria-hidden="true">◎</span>
                      <div><strong>副 API</strong><small>使用单独配置的备用接口</small></div>
                      <i v-if="providerDraft === 'independent'">✓</i>
                    </button>
                  </div>
                </div>

                <div v-if="providerDraft === 'sillytavern'" class="settings-section settings-ai-fields">
                  <div class="settings-field settings-model-field">
                    <span>模型选择</span>
                    <div class="settings-model-control">
                      <DeepListbox
                        :disabled="currentModelCatalog.status !== 'loaded' || fetchedModelOptions.length === 0"
                        label="主 API 模型选择"
                        :model-value="primaryModelDraft"
                        :options="fetchedModelOptions"
                        placeholder="留空则跟随主 API 当前模型"
                        @update:model-value="selectModel"
                      />
                      <button class="secondary-action" type="button" :disabled="currentModelCatalog.status === 'loading'" @click="requestModels">
                        {{ currentModelCatalog.status === 'loading' ? '获取中…' : '获取模型' }}
                      </button>
                    </div>
                    <small :class="['settings-model-status', { 'is-error': currentModelCatalog.status === 'error' }]" aria-live="polite">{{ modelStatusLabel }}</small>
                  </div>
                </div>

                <div v-else class="settings-section settings-ai-fields">
                  <div class="settings-field settings-model-field">
                    <span>YaKit 共享副 API</span>
                    <div class="settings-model-control">
                      <DeepListbox
                        :disabled="secondaryConnectionOptions.length === 0"
                        label="YaKit 共享副 API"
                        :model-value="secondaryConnectionIdDraft"
                        :options="secondaryConnectionOptions"
                        placeholder="选择共享连接"
                        @update:model-value="selectSecondaryConnection"
                      />
                      <button class="secondary-action" type="button" @click="createSecondaryConnectionDraft">新建副 API</button>
                    </div>
                    <small class="settings-model-status">与 YaKit-纪实共用；任一插件保存后，另一插件可直接选择并使用。</small>
                  </div>
                  <label class="settings-field"><span>连接名称</span><input v-model="secondaryConnectionNameDraft" type="text" autocomplete="off" placeholder="副 API 1" /></label>
                  <label class="settings-field"><span>API URL</span><input v-model="apiUrlDraft" type="url" autocomplete="url" placeholder="https://…/v1" /></label>
                  <label class="settings-field">
                    <span>API Key</span>
                    <div class="secret-field">
                      <input
                        v-model="apiKeyDraft"
                        :type="showApiKey ? 'text' : 'password'"
                        autocomplete="off"
                        spellcheck="false"
                        :placeholder="apiKeyConfiguredDraft ? '已安全保存；留空表示不修改' : '输入后保存到 SillyTavern Secrets'"
                      />
                      <button type="button" :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'" @click="showApiKey = !showApiKey">
                        {{ showApiKey ? '隐藏' : '显示' }}
                      </button>
                    </div>
                  </label>
                  <div class="settings-field settings-model-field">
                    <span>模型选择</span>
                    <div class="settings-model-control">
                      <DeepListbox
                        :disabled="currentModelCatalog.status !== 'loaded' || fetchedModelOptions.length === 0"
                        label="副 API 模型选择"
                        :model-value="modelDraft"
                        :options="fetchedModelOptions"
                        placeholder="获取模型后选择"
                        @update:model-value="selectModel"
                      />
                      <button class="secondary-action" type="button" :disabled="currentModelCatalog.status === 'loading'" @click="requestModels">
                        {{ currentModelCatalog.status === 'loading' ? '获取中…' : '获取模型' }}
                      </button>
                    </div>
                    <small :class="['settings-model-status', { 'is-error': currentModelCatalog.status === 'error' }]" aria-live="polite">{{ modelStatusLabel }}</small>
                  </div>
                  <label class="settings-field"><span>模型名称</span><input v-model="modelDraft" type="text" autocomplete="off" /></label>
                </div>

                <div class="settings-section settings-ai-fields">
                  <span class="settings-section-label">分析参数</span>
                  <div class="settings-number-grid">
                    <label class="settings-field"><span>Temperature</span><input v-model.number="temperatureDraft" type="number" min="0" max="2" step="0.1" /></label>
                    <label class="settings-field"><span>最大输出 Token</span><input v-model.number="maxTokensDraft" type="number" min="1" step="1" /></label>
                    <label class="settings-field"><span>请求超时（秒）</span><input v-model.number="timeoutDraft" type="number" min="1" step="1" /></label>
                  </div>
                </div>

                <div class="settings-connection-status">
                  <span>连接状态</span>
                  <p :class="`is-${currentConnectionState.status}`" aria-live="polite"><i aria-hidden="true"></i>{{ connectionLabel }}</p>
                </div>
                <div class="settings-actions">
                  <button class="secondary-action" type="button" :disabled="currentConnectionState.status === 'testing'" @click="testConnection">
                    {{ currentConnectionState.status === 'testing' ? '测试中…' : '测试连接' }}
                  </button>
                  <button class="settings-primary" type="button" :disabled="aiSaveStatus === 'saving'" @click="saveAi">
                    {{ aiSaveStatus === 'saving' ? '保存中…' : '保存 AI 设置' }}
                  </button>
                </div>
                <p
                  v-if="aiSaveStatus !== 'idle'"
                  :class="['settings-operation-status', `is-${aiSaveStatus}`]"
                  role="status"
                  aria-live="polite"
                >{{ aiSaveMessage }}</p>
              </template>

              <template v-else-if="category.id === 'prompts'">
                <div class="settings-section settings-ai-fields">
                  <span class="settings-section-label">提示词内容</span>
                  <button
                    id="jailbreak-prompt-trigger"
                    :class="['settings-prompt-card', { 'is-customized': jailbreakPromptStatus.isCustomized }]"
                    type="button"
                    aria-haspopup="dialog"
                    :aria-expanded="jailbreakPromptDialogOpen"
                    aria-controls="jailbreak-prompt-dialog"
                    @click="openJailbreakPromptDialog"
                  >
                    <span class="settings-prompt-card-copy">
                      <span class="settings-prompt-card-heading">
                        <strong>破限提示词</strong>
                        <span :class="['settings-prompt-status', { 'is-customized': jailbreakPromptStatus.isCustomized }]">{{ jailbreakPromptStatus.label }}</span>
                      </span>
                      <small>{{ jailbreakPromptSummary }}</small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                  <button
                    id="fixed-prompt-trigger"
                    :class="['settings-prompt-card', { 'is-customized': fixedPromptStatus.isCustomized }]"
                    type="button"
                    aria-haspopup="dialog"
                    :aria-expanded="fixedPromptDialogOpen"
                    aria-controls="fixed-prompt-dialog"
                    @click="openFixedPromptDialog"
                  >
                    <span class="settings-prompt-card-copy">
                      <span class="settings-prompt-card-heading">
                        <strong>固定提示词</strong>
                        <span :class="['settings-prompt-status', { 'is-customized': fixedPromptStatus.isCustomized }]">{{ fixedPromptStatus.label }}</span>
                      </span>
                      <small>{{ fixedPromptSummary }}</small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                </div>
                <p class="settings-help settings-help--section">点击二级容器编辑提示词。发送顺序为：破限提示词 → 固定提示词 → 当前分析请求；后续提示项继续放在当前一级容器内。</p>
                <p
                  v-if="aiSaveStatus !== 'idle'"
                  :class="['settings-operation-status', `is-${aiSaveStatus}`]"
                  role="status"
                  aria-live="polite"
                >{{ aiSaveMessage }}</p>
              </template>

              <template v-else-if="category.id === 'automation'">
                <div class="settings-section">
                  <div class="settings-field settings-number-field">
                    <span>大跨度时间跳跃提醒阈值</span>
                    <DeepListbox
                      label="大跨度时间跳跃提醒阈值"
                      :model-value="jumpDaysDraft"
                      :options="jumpDayOptions"
                      @update:model-value="selectJumpDays"
                    />
                  </div>
                  <p class="settings-help">向前跳跃超过阈值时仍按新日期同步，只显示轻量提醒；时间倒退始终需要人工确认。</p>
                </div>
                <div class="settings-actions"><button class="settings-primary" type="button" @click="saveAutomation">保存自动切换设置</button></div>
              </template>

              <template v-else>
                <div class="settings-section data-actions">
                  <button class="secondary-action" type="button" @click="$emit('exportConfig')">导出 JSON</button>
                  <button class="secondary-action" type="button" @click="chooseImportFile">导入 JSON</button>
                  <input :ref="captureFileInput" type="file" accept=".json,application/json" @change="onImportFile" />
                </div>
                <div class="data-safety">
                  <strong>安全规则</strong>
                  <ul>
                    <li>API Key 永不进入导出文件。</li>
                    <li>导入后必须校验世界书、条目 ID、Hash 和缺失项，并展示差异确认。</li>
                    <li>导入不会未经确认直接接管世界书。</li>
                  </ul>
                </div>
              </template>
              </div>
            </div>
          </Transition>
        </article>
    </div>

    <div v-if="jailbreakPromptDialogOpen" class="group-dialog-overlay" @click.self="closeJailbreakPromptDialog">
      <form
        id="jailbreak-prompt-dialog"
        class="group-dialog settings-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jailbreak-prompt-dialog-title"
        @submit.prevent="saveJailbreakPromptDialog"
      >
        <header>
          <div>
            <div class="settings-prompt-dialog-heading">
              <h2 id="jailbreak-prompt-dialog-title">破限提示词</h2>
              <span :class="['settings-prompt-status', { 'is-customized': jailbreakPromptModalStatus.isCustomized }]">{{ jailbreakPromptModalStatus.label }}</span>
            </div>
            <p>自定义提示词 / 破限提示词</p>
          </div>
          <button type="button" aria-label="关闭破限提示词弹窗" @click="closeJailbreakPromptDialog">×</button>
        </header>
        <div class="group-dialog-body">
          <label class="group-dialog-field">
            <span>提示词内容</span>
            <textarea
              ref="jailbreakPromptDialogInput"
              v-model="jailbreakPromptModalDraft"
              rows="8"
              maxlength="6000"
              placeholder="仅在模型经常拒答或返回空内容时填写。"
            ></textarea>
            <small>保存后按“破限提示词 → 固定提示词 → 当前分析请求”的顺序发送。请只填写你明确理解且愿意承担风险的内容。</small>
          </label>
        </div>
        <footer>
          <button class="prompt-reset-action" type="button" @click="resetJailbreakPromptDialog">重置</button>
          <div class="prompt-dialog-actions">
            <button type="button" @click="closeJailbreakPromptDialog">取消</button>
            <button class="confirm-action" type="submit">保存提示词</button>
          </div>
        </footer>
      </form>
    </div>

    <div v-if="fixedPromptDialogOpen" class="group-dialog-overlay" @click.self="closeFixedPromptDialog">
      <form
        id="fixed-prompt-dialog"
        class="group-dialog settings-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixed-prompt-dialog-title"
        @submit.prevent="saveFixedPromptDialog"
      >
        <header>
          <div>
            <div class="settings-prompt-dialog-heading">
              <h2 id="fixed-prompt-dialog-title">固定提示词</h2>
              <span :class="['settings-prompt-status', { 'is-customized': fixedPromptModalStatus.isCustomized }]">{{ fixedPromptModalStatus.label }}</span>
            </div>
            <p>自定义提示词 / 固定提示词</p>
          </div>
          <button type="button" aria-label="关闭固定提示词弹窗" @click="closeFixedPromptDialog">×</button>
        </header>
        <div class="group-dialog-body">
          <label class="group-dialog-field">
            <span>提示词内容</span>
            <textarea
              ref="fixedPromptDialogInput"
              v-model="fixedPromptModalDraft"
              rows="8"
              maxlength="12000"
              placeholder="用于约束每次时间线分析的固定要求。"
            ></textarea>
            <small>保存后作为固定提示词发送，位于破限提示词之后、当前分析请求之前。</small>
          </label>
        </div>
        <footer>
          <button class="prompt-reset-action" type="button" @click="resetFixedPromptDialog">重置</button>
          <div class="prompt-dialog-actions">
            <button type="button" @click="closeFixedPromptDialog">取消</button>
            <button class="confirm-action" type="submit">保存提示词</button>
          </div>
        </footer>
      </form>
    </div>

  </div>
</template>
