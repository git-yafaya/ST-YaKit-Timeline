<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  LogLevel,
  LogView,
  RuntimeLogSummary,
  SystemLogSummary,
  TimelineLogEntry,
} from '@/ui/pages/logs';

const props = withDefaults(
  defineProps<{
    runtimeLogs?: readonly TimelineLogEntry[];
    runtimeSummary?: RuntimeLogSummary | null;
    systemLogs?: readonly TimelineLogEntry[];
    systemSummary?: SystemLogSummary | null;
  }>(),
  {
    runtimeLogs: () => [],
    runtimeSummary: null,
    systemLogs: () => [],
    systemSummary: null,
  },
);

const emit = defineEmits<{
  clearLogs: [view: LogView];
}>();

const activeView = ref<LogView>('runtime');
const confirmClearOpen = ref(false);

const activeLogs = computed(() => {
  const logs = activeView.value === 'runtime' ? props.runtimeLogs : props.systemLogs;
  return logs.slice(0, 100);
});

const summaryItems = computed(() => {
  if (activeView.value === 'runtime') {
    return [
      { label: '当前聊天', value: `${Math.min(props.runtimeLogs.length, 100)} 条记录` },
      { label: '最近切换', value: props.runtimeSummary?.recentSwitch ?? '暂无' },
      { label: '当前状态', value: props.runtimeSummary?.statusLabel ?? '等待运行数据' },
    ];
  }

  return [
    { label: '插件状态', value: props.systemSummary?.statusLabel ?? '等待系统数据' },
    { label: '控制权', value: props.systemSummary?.controlLabel ?? '尚未确认' },
    { label: '最近异常', value: props.systemSummary?.recentError ?? '无' },
  ];
});

const logIcons: Record<LogLevel, string> = {
  success: '↔',
  info: '◷',
  warning: '!',
  error: '×',
};

function selectView(view: LogView): void {
  activeView.value = view;
  confirmClearOpen.value = false;
}

function confirmClear(): void {
  emit('clearLogs', activeView.value);
  confirmClearOpen.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !confirmClearOpen.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  confirmClearOpen.value = false;
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="logs-page">
    <div class="page-heading logs-heading">
      <div>
        <h1>日志</h1>
        <p>查看当前聊天的时间线运行记录与插件系统状态。</p>
      </div>
      <button class="page-action" type="button" :disabled="activeLogs.length === 0" @click="confirmClearOpen = true">
        <span aria-hidden="true">⌫</span>
        {{ activeView === 'runtime' ? '清空当前日志' : '清空系统日志' }}
      </button>
    </div>

    <div class="log-tabs" role="tablist" aria-label="日志类型">
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'runtime'"
        :class="{ 'is-active': activeView === 'runtime' }"
        @click="selectView('runtime')"
      >
        运行日志
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'system'"
        :class="{ 'is-active': activeView === 'system' }"
        @click="selectView('system')"
      >
        系统日志
      </button>
    </div>

    <div class="log-summary">
      <div v-for="item in summaryItems" :key="item.label">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </div>

    <section class="log-list" :aria-label="activeView === 'runtime' ? '当前聊天运行日志' : '插件系统日志'">
      <header>
        <div>
          <h2>{{ activeView === 'runtime' ? '当前聊天运行日志' : '插件系统日志' }}</h2>
          <p>{{ activeView === 'runtime' ? '最多保留最近 100 条记录' : '仅记录必要的插件运行事件' }}</p>
        </div>
        <span>{{ activeLogs.length }}{{ activeView === 'runtime' ? ' / 100' : '' }}</span>
      </header>

      <div v-if="activeLogs.length > 0" class="log-items">
        <article v-for="entry in activeLogs" :key="entry.id" :class="['log-item', `is-${entry.level}`]">
          <span class="log-item-icon" aria-hidden="true">{{ logIcons[entry.level] }}</span>
          <div class="log-item-copy">
            <div>
              <h3>{{ entry.title }}</h3>
              <span>{{ entry.category }}</span>
            </div>
            <p>{{ entry.description }}</p>
          </div>
          <time>{{ entry.occurredAt }}</time>
        </article>
      </div>

      <div v-else class="log-empty">
        <span aria-hidden="true">≡</span>
        <h3>{{ activeView === 'runtime' ? '当前聊天暂无运行日志' : '暂无插件系统日志' }}</h3>
        <p>
          {{
            activeView === 'runtime'
              ? '解析故事时间、执行切换或遇到异常后，相关记录会显示在这里。'
              : 'AI 扫描、配置操作、API 测试与插件错误会记录在这里。'
          }}
        </p>
      </div>
    </section>

    <div v-if="confirmClearOpen" class="group-dialog-overlay" @click.self="confirmClearOpen = false">
      <section class="group-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-log-dialog-title">
        <header>
          <div>
            <h2 id="clear-log-dialog-title">确认清空{{ activeView === 'runtime' ? '运行' : '系统' }}日志</h2>
            <p>此操作只清除当前所选日志，不影响时间线配置。</p>
          </div>
          <button type="button" aria-label="关闭" @click="confirmClearOpen = false">×</button>
        </header>
        <div class="group-dialog-body delete-notice">
          <p>{{ activeLogs.length }} 条日志记录将被清除。</p>
          <span>日志清空后无法从插件内恢复。</span>
        </div>
        <footer>
          <button type="button" @click="confirmClearOpen = false">取消</button>
          <button class="confirm-action is-danger" type="button" @click="confirmClear">确认清空</button>
        </footer>
      </section>
    </div>
  </div>
</template>
