<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { EntryId } from '@/timeline/types';
import DeepListbox from '@/ui/components/DeepListbox.vue';
import type { DeepListboxOption } from '@/ui/components/deep-listbox';
import type {
  TimelineEntryState,
  TimelineEntrySummary,
  TimelineGroupDetail,
  TimelineStatusFilter,
} from '@/ui/pages/timeline';

const props = withDefaults(
  defineProps<{
    groups?: readonly TimelineGroupDetail[];
  }>(),
  {
    groups: () => [],
  },
);

const emit = defineEmits<{
  changeMode: [groupId: string, mode: 'auto' | 'manual'];
  deferConflict: [groupId: string, entryId: EntryId];
  resolveConflict: [groupId: string, entryId: EntryId];
  resync: [];
  startAnalysis: [];
  toggleEntry: [groupId: string, entryId: EntryId, enabled: boolean];
}>();

const searchQuery = ref('');
const selectedGroupId = ref('');
const statusFilter = ref<TimelineStatusFilter>('all');
const selectedSource = ref<TimelineEntrySummary | null>(null);
const sourceExpanded = ref(false);
const copyNotice = ref('');

const groupOptions = computed<readonly DeepListboxOption[]>(() => {
  if (props.groups.length === 0) return [{ value: '', label: '时间线分组：无', disabled: true }];
  return props.groups.map(group => ({ value: group.id, label: `时间线分组：${group.name}` }));
});

const statusOptions: readonly DeepListboxOption[] = [
  { value: 'all', label: '状态：全部' },
  { value: 'active', label: '只看当前生效' },
  { value: 'attention', label: '只看异常 / 待确认' },
  { value: 'manual', label: '只看人工修改' },
  { value: 'inactive', label: '状态：未生效' },
];

const currentGroup = computed(() => {
  return props.groups.find(group => group.id === selectedGroupId.value) ?? props.groups[0] ?? null;
});

const filteredEntries = computed(() => {
  const group = currentGroup.value;
  if (!group) return [];

  const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN');
  return group.entries.filter(entry => {
    const matchesQuery =
      query.length === 0 || `${entry.title} ${entry.originalComment}`.toLocaleLowerCase('zh-CN').includes(query);
    const matchesStatus = statusFilter.value === 'all'
      || (statusFilter.value === 'attention' && (entry.pending || entry.state === 'warning'))
      || (statusFilter.value === 'manual' && entry.manuallyModified)
      || (statusFilter.value === 'active' && entry.state === 'active')
      || (statusFilter.value === 'inactive' && entry.state === 'inactive');
    return matchesQuery && matchesStatus;
  });
});

watch(
  () => props.groups,
  groups => {
    if (groups.length === 0) {
      selectedGroupId.value = '';
      return;
    }
    if (!groups.some(group => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups[0].id;
    }
  },
  { immediate: true },
);

function statusLabel(state: TimelineEntryState): string {
  if (state === 'active') return '生效中';
  if (state === 'warning') return '异常';
  return '未生效';
}

function selectGroupFilter(groupId: string): void {
  if (props.groups.some(group => group.id === groupId)) selectedGroupId.value = groupId;
}

function selectStatusFilter(status: string): void {
  if (status === 'all' || status === 'active' || status === 'inactive' || status === 'attention' || status === 'manual') {
    statusFilter.value = status;
  }
}

function setMode(mode: 'auto' | 'manual'): void {
  if (!currentGroup.value || currentGroup.value.mode === mode) return;
  emit('changeMode', currentGroup.value.id, mode);
}

function toggleEntry(entry: TimelineEntrySummary): void {
  const group = currentGroup.value;
  if (!group || group.mode === 'auto') return;
  emit('toggleEntry', group.id, entry.entryId, !entry.enabled);
}

function closeSource(): void {
  selectedSource.value = null;
  sourceExpanded.value = false;
  copyNotice.value = '';
}

async function copySource(): Promise<void> {
  const content = selectedSource.value?.contentPreview;
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
    copyNotice.value = '已复制正文';
  } catch {
    copyNotice.value = '复制失败，请手动选择正文';
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !selectedSource.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeSource();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="timeline-page">
    <div class="timeline-toolbar">
      <label class="timeline-search">
        <span aria-hidden="true">⌕</span>
        <span class="sr-only">搜索时间线条目</span>
        <input v-model="searchQuery" type="search" placeholder="搜索AI标题或原条目名称..." />
      </label>

      <div class="timeline-filters">
        <DeepListbox
          :disabled="groups.length === 0"
          label="时间线分组"
          :model-value="selectedGroupId"
          :options="groupOptions"
          @update:model-value="selectGroupFilter"
        />
        <DeepListbox
          label="条目状态"
          :model-value="statusFilter"
          :options="statusOptions"
          @update:model-value="selectStatusFilter"
        />
      </div>
    </div>

    <template v-if="currentGroup">
      <div class="timeline-group-heading">
        <div class="timeline-group-summary">
          <h1>{{ currentGroup.name }}</h1>
          <span class="timeline-count">{{ currentGroup.entries.length }} 条目</span>
          <span class="timeline-current-node">
            <span aria-hidden="true">⌁</span>
            当前节点：{{ currentGroup.activeEntryTitle ?? '尚未匹配' }}
          </span>
        </div>

        <div class="mode-switch" aria-label="时间线组运行模式">
          <button
            type="button"
            :class="{ 'is-active': currentGroup.mode === 'auto' }"
            @click="setMode('auto')"
          >
            自动
          </button>
          <button
            type="button"
            :class="{ 'is-active': currentGroup.mode === 'manual' }"
            @click="setMode('manual')"
          >
            手动
          </button>
        </div>
      </div>

      <div v-if="filteredEntries.length > 0" class="timeline-track">
        <div class="timeline-axis" aria-hidden="true"></div>

        <article
          v-for="entry in filteredEntries"
          :key="entry.entryId"
          :class="['timeline-entry', `is-${entry.state}`]"
        >
          <span class="timeline-node" aria-hidden="true"></span>

          <div v-if="entry.state !== 'warning'" class="timeline-entry-card">
            <div class="timeline-entry-copy">
              <div class="timeline-entry-title-row">
                <h2>{{ entry.title }}</h2>
                <span>{{ entry.rangeLabel }}</span>
              </div>
              <div class="timeline-entry-meta">
                <span>原条目：<b>{{ entry.originalComment }}</b></span>
                <span :class="['entry-status', `is-${entry.state}`]">
                  <i aria-hidden="true"></i>{{ statusLabel(entry.state) }}
                </span>
                <span v-if="entry.pending" class="entry-flag is-pending">待确认</span>
                <span v-if="entry.manuallyModified" class="entry-flag is-manual">人工修改</span>
              </div>
            </div>

            <div class="timeline-entry-actions">
              <button class="source-button" type="button" @click="selectedSource = entry">查看正文</button>
              <button
                type="button"
                role="switch"
                :aria-checked="entry.enabled"
                :aria-label="`${entry.title}启用状态`"
                :class="['entry-toggle', { 'is-enabled': entry.enabled }]"
                :disabled="currentGroup.mode === 'auto'"
                @click="toggleEntry(entry)"
              >
                <span></span>
              </button>
            </div>
          </div>

          <div v-else class="timeline-conflict-card">
            <div class="timeline-conflict-heading">
              <div>
                <div class="timeline-entry-title-row">
                  <h2>{{ entry.title }}</h2>
                  <span>{{ entry.rangeLabel }}</span>
                </div>
                <div class="entry-status is-warning"><i aria-hidden="true"></i>状态：异常</div>
              </div>
              <div class="conflict-actions">
                <button type="button" @click="emit('deferConflict', currentGroup.id, entry.entryId)">暂不处理</button>
                <button type="button" @click="$emit('resync')">重新同步</button>
                <button
                  class="resolve-button"
                  type="button"
                  @click="emit('resolveConflict', currentGroup.id, entry.entryId)"
                >
                  前往分组管理
                </button>
              </div>
            </div>
            <p class="conflict-message">{{ entry.warning ?? '该条目存在尚未处理的时间线配置异常。' }}</p>
          </div>
        </article>
      </div>

      <section v-else class="timeline-filter-empty">
        <span aria-hidden="true">⌕</span>
        <h2>没有符合当前筛选条件的条目</h2>
        <p>请调整搜索关键词、分组或状态筛选。</p>
      </section>
    </template>

    <section v-else class="timeline-filter-empty">
      <span aria-hidden="true">◇</span>
      <h2>当前世界书尚未建立时间线配置</h2>
      <p>完成 AI 扫描并确认草稿后，时间线条目会显示在这里。</p>
      <button class="primary-action" type="button" @click="$emit('startAnalysis')">开始扫描</button>
    </section>

    <div v-if="selectedSource" class="source-dialog-overlay" @click.self="closeSource">
      <section class="source-dialog" role="dialog" aria-modal="true" aria-label="世界书原条目只读预览">
        <header>
          <div>
            <h2>{{ selectedSource.title }}</h2>
            <p>只读预览</p>
          </div>
          <div class="source-dialog-actions">
            <button type="button" @click="sourceExpanded = !sourceExpanded">{{ sourceExpanded ? '收起' : '展开全文' }}</button>
            <button type="button" :disabled="!selectedSource.contentPreview" @click="copySource">复制</button>
            <small v-if="copyNotice">{{ copyNotice }}</small>
          </div>
          <button type="button" aria-label="关闭正文预览" @click="closeSource">×</button>
        </header>
        <div class="source-dialog-body">
          <div class="source-dialog-meta">原条目：{{ selectedSource.originalComment }}</div>
          <div class="source-dialog-content">
            {{ selectedSource.contentPreview ? (sourceExpanded ? selectedSource.contentPreview : selectedSource.contentPreview.slice(0, 1000) + (selectedSource.contentPreview.length > 1000 ? '…' : '')) : '正文尚未读取。' }}
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
