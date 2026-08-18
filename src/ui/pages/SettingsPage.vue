<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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

const props = withDefaults(
  defineProps<{
    connectionStatus?: ConnectionStatus;
    settings: SettingsSnapshot;
  }>(),
  {
    connectionStatus: 'idle',
  },
);

const emit = defineEmits<{
  exportConfig: [];
  importConfig: [file: File];
  saveAi: [settings: AiSettings];
  saveAutomation: [settings: AutomationSettings];
  saveGeneral: [settings: GeneralSettings];
  testConnection: [settings: AiSettings];
}>();

const activeCategory = ref<SettingsCategory>('analysis');
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

const categories: ReadonlyArray<{ description: string; icon: string; id: SettingsCategory; label: string }> = [
  { id: 'general', label: '常规', description: '基础行为', icon: '≡' },
  { id: 'analysis', label: 'AI 分析', description: '模型与接口', icon: '✦' },
  { id: 'automation', label: '自动切换', description: '时间与通知', icon: '↝' },
  { id: 'data', label: '数据管理', description: '导入与导出', icon: '▣' },
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

function saveGeneral(): void {
  emit('saveGeneral', {
    theme: themeDraft.value,
    showSwitchNotifications: notificationDraft.value,
  });
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
        <p>配置时间线管理的分析、切换与数据选项。</p>
      </div>
    </div>

    <div class="settings-workspace">
      <nav class="settings-sidebar" aria-label="设置分类">
        <span>设置分类</span>
        <button
          v-for="category in categories"
          :key="category.id"
          type="button"
          :class="{ 'is-active': activeCategory === category.id }"
          @click="activeCategory = category.id"
        >
          <i aria-hidden="true">{{ category.icon }}</i>
          <span><strong>{{ category.label }}</strong><small>{{ category.description }}</small></span>
        </button>
      </nav>

      <section class="settings-detail">
        <template v-if="activeCategory === 'general'">
          <header><h2>常规</h2><p>配置插件的基础行为与显示主题。</p></header>

          <div class="settings-section">
            <label class="settings-field">
              <span>主题</span>
              <select v-model="themeDraft">
                <option value="follow">跟随 SillyTavern</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
          </div>

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

          <div class="settings-save-row"><button class="settings-primary" type="button" @click="saveGeneral">保存常规设置</button></div>
        </template>

        <template v-else-if="activeCategory === 'analysis'">
          <header><h2>AI 分析</h2><p>配置用于生成时间线草稿的模型与接口。</p></header>

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

          <div v-if="providerDraft === 'sillytavern'" class="settings-section">
            <div class="connection-row">
              <div><strong>当前状态</strong><p :class="`is-${connectionStatus}`">{{ connectionLabel }}</p></div>
              <button class="secondary-action" type="button" :disabled="connectionStatus === 'testing'" @click="testConnection">测试连接</button>
            </div>
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
            <div class="connection-row">
              <p :class="`is-${connectionStatus}`">{{ connectionLabel }}</p>
              <button class="secondary-action" type="button" :disabled="connectionStatus === 'testing'" @click="testConnection">测试连接</button>
            </div>
          </div>

          <div class="settings-save-row"><button class="settings-primary" type="button" @click="saveAi">保存 AI 设置</button></div>
        </template>

        <template v-else-if="activeCategory === 'automation'">
          <header><h2>自动切换</h2><p>配置时间变化提醒，不改变确定性匹配规则。</p></header>
          <div class="settings-section">
            <label class="settings-field settings-number-field"><span>大跨度时间跳跃提醒阈值</span><div><input v-model.number="jumpDaysDraft" type="number" min="1" step="1" /><b>天</b></div></label>
            <p class="settings-help">向前跳跃超过阈值时仍按新日期同步，只显示轻量提醒；时间倒退始终需要人工确认。</p>
          </div>
          <div class="settings-save-row"><button class="settings-primary" type="button" @click="saveAutomation">保存自动切换设置</button></div>
        </template>

        <template v-else>
          <header><h2>数据管理</h2><p>导入与导出当前世界书的时间线配置。</p></header>
          <div class="settings-section data-actions">
            <button class="secondary-action" type="button" @click="$emit('exportConfig')">导出 JSON</button>
            <button class="secondary-action" type="button" @click="chooseImportFile">导入 JSON</button>
            <input ref="fileInput" type="file" accept=".json,application/json" @change="onImportFile" />
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
      </section>
    </div>
  </div>
</template>
