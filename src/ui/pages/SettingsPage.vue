<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DeepListbox from '@/ui/components/DeepListbox.vue';
import type { DeepListboxOption } from '@/ui/components/deep-listbox';
import type {
  AiSettings,
  ApiProvider,
  AutomationSettings,
  ConnectionStatus,
  GeneralSettings,
  SettingsCategory,
  SettingsSnapshot,
  ThemeMode,
} from '@/ui/pages/settings';
import type { TimelinePage } from '@/ui/state';

const props = withDefaults(
  defineProps<{
    connectionStatus?: ConnectionStatus;
    settings: SettingsSnapshot;
    version?: string;
  }>(),
  {
    connectionStatus: 'idle',
    version: 'v0.1.0',
  },
);

const emit = defineEmits<{
  close: [];
  exportConfig: [];
  importConfig: [file: File];
  saveAi: [settings: AiSettings];
  saveAutomation: [settings: AutomationSettings];
  saveGeneral: [settings: GeneralSettings];
  selectPage: [page: TimelinePage];
  testConnection: [settings: AiSettings];
  themeChange: [theme: ThemeMode];
}>();

const expandedCategory = ref<SettingsCategory | null>(null);
const themeDraft = ref<ThemeMode>('follow');
const notificationDraft = ref(true);
const providerDraft = ref<ApiProvider>('sillytavern');
const apiUrlDraft = ref('');
const apiKeyDraft = ref('');
const modelDraft = ref('');
const temperatureDraft = ref(0.2);
const maxTokensDraft = ref(4096);
const timeoutDraft = ref(60);
const jumpDaysDraft = ref(365);
const showApiKey = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const categories: ReadonlyArray<{ description: string; id: SettingsCategory; label: string }> = [
  { id: 'general', label: '常规', description: '基础行为与显示偏好' },
  { id: 'analysis', label: 'AI 分析', description: '模型、接口与连接' },
  { id: 'automation', label: '自动切换', description: '时间变化与提醒' },
  { id: 'data', label: '数据管理', description: '导入、导出与安全' },
];

const settingsNavItems: ReadonlyArray<{ icon: string; id: TimelinePage; label: string }> = [
  { id: 'overview', label: '总览', icon: '⌂' },
  { id: 'timeline', label: '时间线', icon: '⌁' },
  { id: 'groups', label: '分组', icon: '◇' },
  { id: 'analysis', label: 'AI分析', icon: '✦' },
  { id: 'settings', label: '设置', icon: '⚙' },
];

const themeOptions: readonly DeepListboxOption[] = [
  { value: 'follow', label: '跟随 SillyTavern' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const connectionLabel = computed(() => {
  if (props.connectionStatus === 'testing') return '正在测试';
  if (props.connectionStatus === 'connected') return '已连接';
  if (props.connectionStatus === 'error') return '连接失败';
  return '尚未测试';
});

watch(
  () => props.settings,
  settings => {
    themeDraft.value = settings.general.theme;
    notificationDraft.value = settings.general.showSwitchNotifications;
    providerDraft.value = settings.ai.provider;
    apiUrlDraft.value = settings.ai.apiUrl;
    apiKeyDraft.value = settings.ai.apiKey;
    modelDraft.value = settings.ai.model;
    temperatureDraft.value = settings.ai.temperature;
    maxTokensDraft.value = settings.ai.maxOutputTokens;
    timeoutDraft.value = settings.ai.timeoutSeconds;
    jumpDaysDraft.value = settings.automation.largeJumpNoticeDays;
    showApiKey.value = false;
  },
  { immediate: true },
);

function currentAiSettings(): AiSettings {
  return {
    provider: providerDraft.value,
    apiUrl: apiUrlDraft.value.trim(),
    apiKey: apiKeyDraft.value,
    model: modelDraft.value.trim(),
    temperature: Math.max(0, Math.min(2, Number(temperatureDraft.value) || 0)),
    maxOutputTokens: Math.max(1, Math.round(Number(maxTokensDraft.value) || 1)),
    timeoutSeconds: Math.max(1, Math.round(Number(timeoutDraft.value) || 1)),
  };
}

function toggleCategory(category: SettingsCategory): void {
  expandedCategory.value = expandedCategory.value === category ? null : category;
}

function saveGeneral(): void {
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

function saveAi(): void {
  emit('saveAi', currentAiSettings());
}

function testConnection(): void {
  emit('testConnection', currentAiSettings());
}

function saveAutomation(): void {
  emit('saveAutomation', {
    largeJumpNoticeDays: Math.max(1, Math.round(Number(jumpDaysDraft.value) || 365)),
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
    <header class="settings-page-header">
      <h1>设置</h1>
      <div class="settings-header-actions">
        <div class="settings-theme-control">
          <DeepListbox
            label="主题"
            :model-value="themeDraft"
            :options="themeOptions"
            @update:model-value="selectTheme"
          />
        </div>
        <span class="settings-version">{{ version }}</span>
        <button class="settings-close" type="button" aria-label="关闭设置" @click="$emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
          </svg>
        </button>
      </div>
    </header>

    <div class="settings-scroll">
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
                <div class="settings-row">
                  <div><strong>切换成功通知</strong><p>时间线自动切换成功后显示提示消息。</p></div>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="notificationDraft"
                    :class="['settings-toggle', { 'is-enabled': notificationDraft }]"
                    @click="notificationDraft = !notificationDraft"
                  ><span></span></button>
                </div>
                <div class="settings-actions"><button class="settings-primary" type="button" @click="saveGeneral">保存常规设置</button></div>
              </template>

              <template v-else-if="category.id === 'analysis'">
                <div class="settings-section">
                  <span class="settings-section-label">接口提供商</span>
                  <div class="provider-options">
                    <button type="button" :class="{ 'is-active': providerDraft === 'sillytavern' }" @click="providerDraft = 'sillytavern'">
                      <span aria-hidden="true">⌁</span><strong>SillyTavern API</strong><i v-if="providerDraft === 'sillytavern'">✓</i>
                    </button>
                    <button type="button" :class="{ 'is-active': providerDraft === 'independent' }" @click="providerDraft = 'independent'">
                      <span aria-hidden="true">◎</span><strong>独立 API</strong><i v-if="providerDraft === 'independent'">✓</i>
                    </button>
                  </div>
                </div>

                <div v-if="providerDraft === 'sillytavern'" class="settings-section settings-ai-fields">
                  <label class="settings-field"><span>模型选择</span><input v-model="modelDraft" type="text" placeholder="留空则使用 SillyTavern 当前模型" /></label>
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
                  <label class="settings-field"><span>模型名称</span><input v-model="modelDraft" type="text" autocomplete="off" /></label>
                  <div class="settings-number-grid">
                    <label class="settings-field"><span>Temperature</span><input v-model.number="temperatureDraft" type="number" min="0" max="2" step="0.1" /></label>
                    <label class="settings-field"><span>最大输出 Token</span><input v-model.number="maxTokensDraft" type="number" min="1" step="1" /></label>
                    <label class="settings-field"><span>请求超时（秒）</span><input v-model.number="timeoutDraft" type="number" min="1" step="1" /></label>
                  </div>
                </div>

                <div class="settings-connection-status">
                  <span>连接状态</span>
                  <p :class="`is-${connectionStatus}`"><i aria-hidden="true"></i>{{ connectionLabel }}</p>
                </div>
                <div class="settings-actions">
                  <button class="secondary-action" type="button" :disabled="connectionStatus === 'testing'" @click="testConnection">测试连接</button>
                  <button class="settings-primary" type="button" @click="saveAi">保存 AI 设置</button>
                </div>
              </template>

              <template v-else-if="category.id === 'automation'">
                <div class="settings-section">
                  <label class="settings-field settings-number-field"><span>大跨度时间跳跃提醒阈值</span><div><input v-model.number="jumpDaysDraft" type="number" min="1" step="1" /><b>天</b></div></label>
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

    <nav class="settings-bottom-nav" aria-label="主要导航">
      <button
        v-for="item in settingsNavItems"
        :key="item.id"
        type="button"
        :class="{ 'is-active': item.id === 'settings' }"
        @click="$emit('selectPage', item.id)"
      >
        <i aria-hidden="true">{{ item.icon }}</i>
        <span>{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>
