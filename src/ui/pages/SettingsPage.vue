<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PRODUCT_NAME } from '@/branding';
import DeepListbox from '@/ui/components/DeepListbox.vue';
import type { DeepListboxOption } from '@/ui/components/deep-listbox';
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
} from '@/ui/pages/settings';

const props = withDefaults(
  defineProps<{
    aiSaveMessage?: string;
    aiSaveStatus?: AiSaveStatus;
    connectionStates?: ConnectionStates;
    modelCatalogs?: ModelCatalogs;
    settings: SettingsSnapshot;
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
  },
);

const emit = defineEmits<{
  exportConfig: [];
  importConfig: [file: File];
  requestModels: [settings: AiSettings];
  saveAi: [settings: AiSettings];
  saveAutomation: [settings: AutomationSettings];
  saveGeneral: [settings: GeneralSettings];
  testConnection: [settings: AiSettings];
  themeChange: [theme: ThemeMode];
}>();

const expandedCategory = ref<SettingsCategory | null>(null);
const themeDraft = ref<ThemeMode>('follow');
const notificationDraft = ref(true);
const providerDraft = ref<ApiProvider>('sillytavern');
const apiUrlDraft = ref('');
const apiKeyDraft = ref('');
const jailbreakPromptDraft = ref('');
const modelDraft = ref('');
const temperatureDraft = ref(0.9);
const maxTokensDraft = ref(23333);
const timeoutDraft = ref(180);
const jumpDaysDraft = ref('5');
const showApiKey = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const categories: ReadonlyArray<{ description: string; id: SettingsCategory; label: string }> = [
  { id: 'general', label: '常规', description: '基础行为与显示偏好' },
  { id: 'analysis', label: 'AI 分析', description: '模型、接口与连接' },
  { id: 'prompts', label: '自定义提示词', description: '破限指令与后续扩展提示' },
  { id: 'automation', label: '自动切换', description: '时间变化与提醒' },
  { id: 'data', label: '数据管理', description: '导入、导出与安全' },
];

const themeOptions: readonly DeepListboxOption[] = [
  { value: 'follow', label: '跟随 SillyTavern' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const jumpDayOptions: readonly DeepListboxOption[] = [5, 10, 15, 20, 25, 30].map(days => ({
  value: String(days),
  label: `${days} 天`,
}));

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
  const currentModel = modelDraft.value.trim();
  if (currentModel && !models.includes(currentModel)) models.unshift(currentModel);
  return models.map(model => ({ value: model, label: model }));
});
const modelStatusLabel = computed(() => {
  if (currentModelCatalog.value.status === 'loading') return '正在获取模型…';
  if (currentModelCatalog.value.status === 'idle') return '点击“获取模型”加载可用模型列表。';
  return currentModelCatalog.value.message;
});

watch(
  () => props.settings,
  settings => {
    themeDraft.value = settings.general.theme;
    notificationDraft.value = settings.general.showSwitchNotifications;
    providerDraft.value = settings.ai.provider;
    apiUrlDraft.value = settings.ai.apiUrl;
    apiKeyDraft.value = settings.ai.apiKey;
    jailbreakPromptDraft.value = settings.ai.jailbreakPrompt;
    modelDraft.value = settings.ai.model;
    temperatureDraft.value = settings.ai.temperature;
    maxTokensDraft.value = settings.ai.maxOutputTokens;
    timeoutDraft.value = settings.ai.timeoutSeconds;
    jumpDaysDraft.value = normalizeJumpDays(settings.automation.largeJumpNoticeDays);
    showApiKey.value = false;
  },
  { immediate: true },
);

function currentAiSettings(): AiSettings {
  return {
    provider: providerDraft.value,
    apiUrl: apiUrlDraft.value.trim(),
    apiKey: apiKeyDraft.value,
    jailbreakPrompt: jailbreakPromptDraft.value,
    model: modelDraft.value.trim(),
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
  modelDraft.value = model;
}

function requestModels(): void {
  emit('requestModels', currentAiSettings());
}

function saveAi(): void {
  emit('saveAi', currentAiSettings());
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
            <span><strong>{{ category.label }}</strong><small>{{ category.description }}</small></span>
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
                <div class="settings-section">
                  <div class="settings-field">
                    <span>主题</span>
                    <DeepListbox
                      label="主题"
                      :model-value="themeDraft"
                      :options="themeOptions"
                      @update:model-value="selectTheme"
                    />
                  </div>
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
                  <div class="provider-options">
                    <button type="button" :class="{ 'is-active': providerDraft === 'sillytavern' }" @click="providerDraft = 'sillytavern'">
                      <span aria-hidden="true">⌁</span>
                      <div><strong>跟随主 API</strong><small>使用 SillyTavern 当前主 API / 当前模型</small></div>
                      <i v-if="providerDraft === 'sillytavern'">✓</i>
                    </button>
                    <button type="button" :class="{ 'is-active': providerDraft === 'independent' }" @click="providerDraft = 'independent'">
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
                        :model-value="modelDraft"
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
                  <label class="settings-field"><span>API URL</span><input v-model="apiUrlDraft" type="url" autocomplete="url" placeholder="https://…/v1" /></label>
                  <label class="settings-field">
                    <span>API Key</span>
                    <div class="secret-field">
                      <input v-model="apiKeyDraft" :type="showApiKey ? 'text' : 'password'" autocomplete="off" spellcheck="false" />
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
                  <button class="settings-primary" type="button" @click="saveAi">保存 AI 设置</button>
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
                  <label class="settings-field settings-textarea-field">
                    <span>破限提示词</span>
                    <textarea
                      v-model="jailbreakPromptDraft"
                      rows="5"
                      maxlength="6000"
                      placeholder="仅在模型经常拒答或返回空内容时填写。"
                    ></textarea>
                    <small>发送顺序为：破限提示词 → 固定系统提示词 → 当前分析请求。请只填写你明确理解且愿意承担风险的内容。</small>
                  </label>
                </div>
                <p class="settings-help settings-help--section">当前一级容器只提供破限提示词；后续提示项会继续放在这里，不再增加二级“自定义提示词”。</p>
                <div class="settings-actions">
                  <button class="settings-primary" type="button" @click="saveAi">保存 AI 设置</button>
                </div>
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
  </div>
</template>
