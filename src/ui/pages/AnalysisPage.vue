<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { EntryId } from '@/timeline/types';
import type {
  AnalysisDraft,
  AnalysisDraftEntry,
  AnalysisDraftGroup,
  AnalysisDiffItem,
  AnalysisEntryPatch,
  AnalysisErrorState,
  AnalysisProgress,
  AnalysisScanMode,
  AnalysisStage,
} from '@/ui/pages/analysis';

const props = withDefaults(
  defineProps<{
    allowApply?: boolean;
    applyBlockedMessage?: string;
    applying?: boolean;
    canStart?: boolean;
    draft?: AnalysisDraft | null;
    diff?: readonly AnalysisDiffItem[];
    error?: AnalysisErrorState | null;
    notice?: string;
    progress?: AnalysisProgress | null;
    sourceMessage?: string;
  }>(),
  {
    allowApply: false,
    applyBlockedMessage: '',
    applying: false,
    canStart: false,
    draft: null,
    diff: () => [],
    error: null,
    notice: '',
    progress: null,
    sourceMessage: '',
  },
);

const emit = defineEmits<{
  applyDraft: [];
  cancelAnalysis: [];
  createGroup: [name: string];
  discardDraft: [];
  reorderEntries: [groupId: string, orderedEntryIds: readonly EntryId[]];
  startAnalysis: [mode: AnalysisScanMode];
  toggleEntry: [groupId: string, entryId: EntryId, selected: boolean];
  updateEntry: [groupId: string, entryId: EntryId, patch: AnalysisEntryPatch];
}>();

const editingGroupId = ref('');
const editingEntryId = ref<EntryId | null>(null);
const titleDraft = ref('');
const startDateDraft = ref('');
const boundaryDateDraft = ref('');
const createDialogOpen = ref(false);
const groupNameDraft = ref('');
const dialogInput = ref<HTMLInputElement | null>(null);
const draggedEntry = ref<{ entryId: EntryId; groupId: string } | null>(null);

const selectedCount = computed(() => {
  return props.draft?.groups.reduce((total, group) => total + group.entries.filter(entry => entry.selected).length, 0) ?? 0;
});

const pendingCount = computed(() => {
  return (
    props.draft?.groups.reduce(
      (total, group) =>
        total + group.entries.filter(
          entry => entry.selected && (entry.confidence === 'medium' || (entry.warnings?.length ?? 0) > 0),
        ).length,
      0,
    ) ?? 0
  );
});

const excludedCount = computed(() => {
  return props.draft?.groups.reduce((total, group) => total + group.entries.filter(entry => !entry.selected).length, 0) ?? 0;
});

const stageOrder: readonly AnalysisStage[] = ['filtering', 'batches', 'summary', 'validation'];
const stageLabels: Record<AnalysisStage, string> = {
  filtering: '候选筛选',
  batches: 'AI批次',
  summary: '汇总',
  validation: '校验',
};

function confidenceLabel(entry: AnalysisDraftEntry): string {
  if (entry.confidence === 'high') return '高置信度';
  if (entry.confidence === 'medium') return '需确认';
  return '低置信度';
}

function rangeLabel(entry: AnalysisDraftEntry): string {
  if (!entry.contentStartDate && !entry.boundaryDate) return '时间边界不明确';
  return `${entry.contentStartDate ?? '起点待确认'} ～ ${entry.boundaryDate ?? '∞'}`;
}

function isEditing(group: AnalysisDraftGroup, entry: AnalysisDraftEntry): boolean {
  return editingGroupId.value === group.id && editingEntryId.value === entry.entryId;
}

function beginEdit(group: AnalysisDraftGroup, entry: AnalysisDraftEntry): void {
  editingGroupId.value = group.id;
  editingEntryId.value = entry.entryId;
  titleDraft.value = entry.title;
  startDateDraft.value = entry.contentStartDate ?? '';
  boundaryDateDraft.value = entry.boundaryDate ?? '';
}

function cancelEdit(): void {
  editingGroupId.value = '';
  editingEntryId.value = null;
}

function saveEdit(): void {
  const title = titleDraft.value.trim();
  if (!editingGroupId.value || editingEntryId.value === null || !title) return;
  emit('updateEntry', editingGroupId.value, editingEntryId.value, {
    title,
    contentStartDate: startDateDraft.value.trim() || undefined,
    boundaryDate: boundaryDateDraft.value.trim() || undefined,
  });
  cancelEdit();
}

function openCreateDialog(): void {
  groupNameDraft.value = '';
  createDialogOpen.value = true;
  void nextTick(() => dialogInput.value?.focus());
}

function closeCreateDialog(): void {
  createDialogOpen.value = false;
  groupNameDraft.value = '';
}

function createGroup(): void {
  const name = groupNameDraft.value.trim();
  if (!name) return dialogInput.value?.focus();
  emit('createGroup', name);
  closeCreateDialog();
}

function dropAnalysisEntry(groupId: string, targetEntryId: EntryId): void {
  const source = draggedEntry.value;
  draggedEntry.value = null;
  if (!source || source.groupId !== groupId || source.entryId === targetEntryId || !props.draft) return;
  const group = props.draft.groups.find(item => item.id === groupId);
  if (!group) return;
  const ids = group.entries.map(entry => entry.entryId);
  const next = ids.filter(id => id !== source.entryId);
  const index = next.findIndex(id => id === targetEntryId);
  next.splice(index < 0 ? next.length : index, 0, source.entryId);
  emit('reorderEntries', groupId, next);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || (!createDialogOpen.value && editingEntryId.value === null)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeCreateDialog();
  cancelEdit();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="analysis-page">
    <div class="page-heading analysis-heading">
      <div>
        <h1>AI分析</h1>
        <p>{{ draft ? '分析完成，请确认时间线草稿。' : '识别世界书中的时间线候选并生成配置草稿。' }}</p>
      </div>
      <div v-if="draft" class="analysis-heading-actions">
        <button class="secondary-action" type="button" :disabled="Boolean(progress) || applying || !canStart" @click="$emit('startAnalysis', 'quick')">
          重新分析
        </button>
        <button
          class="analysis-apply"
          type="button"
          :disabled="pendingCount > 0 || !allowApply || applying"
          :title="allowApply ? '' : applyBlockedMessage"
          @click="$emit('applyDraft')"
        >
          {{ applying ? '正在保存…' : '确认并应用' }}
        </button>
      </div>
    </div>

    <section v-if="error" class="analysis-error" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <strong>分析未完成</strong>
        <p>{{ error.message }}</p>
        <details v-if="error.rawOutput">
          <summary>查看最后一次原始输出</summary>
          <pre>{{ error.rawOutput }}</pre>
        </details>
      </div>
    </section>

    <section v-if="notice" class="analysis-success" role="status">
      <span aria-hidden="true">✓</span>
      <p>{{ notice }}</p>
    </section>

    <section v-if="!draft" class="analysis-empty" aria-labelledby="analysis-empty-title">
      <span class="analysis-empty-icon" aria-hidden="true">✦</span>
      <h2 id="analysis-empty-title">尚未生成时间线分析草稿</h2>
      <p>{{ canStart ? '快速扫描会先在本地筛选候选；深度扫描会分析全部条目。两种方式都不会直接修改世界书。' : sourceMessage }}</p>
      <div class="analysis-scan-actions">
        <button class="analysis-scan-card" type="button" :disabled="Boolean(progress) || applying || !canStart" @click="$emit('startAnalysis', 'quick')">
          <span aria-hidden="true">⌁</span>
          <strong>快速扫描</strong>
          <small>先筛选明显候选，减少发送内容</small>
        </button>
        <button class="analysis-scan-card" type="button" :disabled="Boolean(progress) || applying || !canStart" @click="$emit('startAnalysis', 'deep')">
          <span aria-hidden="true">◎</span>
          <strong>深度扫描全部条目</strong>
          <small>适合格式特殊或可能被漏检的世界书</small>
        </button>
      </div>
    </section>

    <template v-else>
      <div class="analysis-draft-notice">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>AI 草稿尚未应用</strong>
          <p>请检查分组、条目顺序、时间边界和低置信度项目，确认后才会建立自动时间线。</p>
        </div>
      </div>

      <section v-if="diff.length > 0" class="analysis-diff" aria-labelledby="analysis-diff-title">
        <header>
          <div>
            <h2 id="analysis-diff-title">与现有配置的差异</h2>
            <p>旧配置在确认前继续运行；人工锁定字段不会被自动覆盖。</p>
          </div>
          <span>{{ diff.length }} 项</span>
        </header>
        <div class="analysis-diff-list">
          <article v-for="item in diff" :key="`${item.status}-${item.entryId}`" :class="['analysis-diff-item', `is-${item.status}`]">
            <div>
              <strong>{{ item.title }}</strong>
              <small>条目 {{ item.entryId }} · {{ item.status === 'added' ? '新增' : item.status === 'removed' ? '旧映射待处理' : item.status === 'changed' ? '建议变化' : '无变化' }}</small>
            </div>
            <p v-if="item.status === 'changed'">{{ item.oldRange }} → {{ item.newRange }}</p>
            <p v-else-if="item.status === 'removed'">原配置：{{ item.oldRange }}</p>
            <p v-else-if="item.status === 'added'">AI 建议：{{ item.newRange }}</p>
            <p v-else>{{ item.newRange ?? item.oldRange }}</p>
          </article>
        </div>
      </section>

      <div class="analysis-summary">
        <div><span>候选条目</span><strong>{{ draft.candidateCount }}</strong></div>
        <div><span>时间线组</span><strong>{{ draft.groups.length }}</strong></div>
        <div><span>待确认</span><strong class="is-warning">{{ pendingCount }}</strong></div>
        <div><span>未采用</span><strong>{{ excludedCount }}</strong></div>
      </div>

      <section class="analysis-workspace">
        <header>
          <div>
            <h2>AI 识别结果</h2>
            <p>可在应用前调整分组和条目。</p>
          </div>
          <button class="secondary-action" type="button" @click="openCreateDialog"><span aria-hidden="true">＋</span>新建分组</button>
        </header>

        <div v-if="draft.groups.length > 0" class="analysis-groups">
          <section v-for="group in draft.groups" :key="group.id" class="analysis-group">
            <header>
              <span class="drag-mark" aria-hidden="true">⠿</span>
              <h3>{{ group.name }}</h3>
              <span>{{ group.entries.length }} 条目</span>
            </header>

            <div class="analysis-entry-list">
              <article
                v-for="entry in group.entries"
                :key="entry.entryId"
                :class="['analysis-entry', { 'is-excluded': !entry.selected, 'is-editing': isEditing(group, entry) }]"
                draggable="true"
                @dragstart="draggedEntry = { entryId: entry.entryId, groupId: group.id }"
                @dragend="draggedEntry = null"
                @dragover.prevent
                @drop.prevent="dropAnalysisEntry(group.id, entry.entryId)"
              >
                <template v-if="!isEditing(group, entry)">
                  <span class="drag-mark" aria-hidden="true">⠿</span>
                  <input
                    type="checkbox"
                    :checked="entry.selected"
                    :aria-label="`${entry.title}纳入时间线配置`"
                    @change="$emit('toggleEntry', group.id, entry.entryId, ($event.target as HTMLInputElement).checked)"
                  />
                  <div class="analysis-entry-copy">
                    <div class="analysis-entry-title">
                      <h4>{{ entry.title }}</h4>
                      <span :class="`is-${entry.confidence}`">{{ confidenceLabel(entry) }}</span>
                      <span v-if="entry.manuallyLocked" class="is-locked">人工锁定</span>
                    </div>
                    <p>{{ rangeLabel(entry) }} · {{ entry.sourceComment }}</p>
                    <div v-if="entry.warnings?.length" class="analysis-entry-warning">
                      <span v-for="warning in entry.warnings" :key="warning">! {{ warning }}</span>
                    </div>
                  </div>
                  <button class="analysis-edit-button" type="button" @click="beginEdit(group, entry)">
                    {{ entry.confidence === 'low' ? '检查' : '编辑' }}
                  </button>
                </template>

                <form v-else class="analysis-entry-editor" @submit.prevent="saveEdit">
                  <div class="analysis-editor-heading">
                    <strong>编辑候选条目</strong>
                    <span>保存后字段将人工锁定</span>
                  </div>
                  <div class="analysis-editor-fields">
                    <label><span>时间线标题</span><input v-model="titleDraft" type="text" maxlength="120" /></label>
                    <label><span>开始日期</span><input v-model="startDateDraft" type="text" placeholder="YYYY-MM-DD" /></label>
                    <label><span>边界日期</span><input v-model="boundaryDateDraft" type="text" placeholder="YYYY-MM-DD" /></label>
                  </div>
                  <div class="analysis-editor-actions">
                    <button type="button" @click="cancelEdit">取消</button>
                    <button class="confirm-action" type="submit">保存修改</button>
                  </div>
                </form>
              </article>
            </div>
          </section>
        </div>

        <div v-else class="analysis-workspace-empty">草稿中尚无分组，可新建分组后继续整理。</div>
      </section>

      <div class="analysis-bottom-actions">
        <span>
          {{ selectedCount }} 个条目将被纳入时间线配置
          <small v-if="!allowApply && applyBlockedMessage" class="analysis-apply-hint">{{ applyBlockedMessage }}</small>
        </span>
        <div>
          <button class="secondary-action" type="button" :disabled="applying" @click="$emit('discardDraft')">放弃草稿</button>
          <button
            class="analysis-apply"
            type="button"
            :disabled="pendingCount > 0 || !allowApply || applying"
            :title="allowApply ? '' : applyBlockedMessage"
            @click="$emit('applyDraft')"
          >{{ applying ? '正在保存…' : '确认并应用' }}</button>
        </div>
      </div>
    </template>

    <div v-if="progress" class="analysis-progress-overlay">
      <section class="analysis-progress" role="status" aria-live="polite">
        <header>
          <div><h2>AI 分析进行中</h2><p>{{ progress.label }}</p></div>
          <strong>{{ Math.max(0, Math.min(100, progress.percent)) }}%</strong>
        </header>
        <div class="analysis-progress-track"><span :style="{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }"></span></div>
        <div class="analysis-stages">
          <span
            v-for="stage in stageOrder"
            :key="stage"
            :class="{ 'is-current': stage === progress.stage }"
          >{{ stageLabels[stage] }}</span>
        </div>
        <button class="secondary-action" type="button" @click="$emit('cancelAnalysis')">取消分析</button>
        <p>取消分析不会保存任何未完成结果。</p>
      </section>
    </div>

    <div v-if="createDialogOpen" class="group-dialog-overlay" @click.self="closeCreateDialog">
      <form class="group-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-group-dialog-title" @submit.prevent="createGroup">
        <header><h2 id="analysis-group-dialog-title">新建时间线组</h2><button type="button" aria-label="关闭" @click="closeCreateDialog">×</button></header>
        <div class="group-dialog-body">
          <label class="group-dialog-field"><span>分组名称</span><input ref="dialogInput" v-model="groupNameDraft" type="text" maxlength="80" /></label>
        </div>
        <footer><button type="button" @click="closeCreateDialog">取消</button><button class="confirm-action" type="submit">创建</button></footer>
      </form>
    </div>
  </div>
</template>
