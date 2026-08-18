<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { EntryId } from '@/timeline/types';
import type {
  AnalysisDraft,
  AnalysisDraftEntry,
  AnalysisDraftGroup,
  AnalysisEntryPatch,
  AnalysisProgress,
  AnalysisScanMode,
  AnalysisStage,
} from '@/ui/pages/analysis';

const props = withDefaults(
  defineProps<{
    draft?: AnalysisDraft | null;
    progress?: AnalysisProgress | null;
  }>(),
  {
    draft: null,
    progress: null,
  },
);

const emit = defineEmits<{
  applyDraft: [];
  cancelAnalysis: [];
  createGroup: [name: string];
  discardDraft: [];
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

const selectedCount = computed(() => {
  return props.draft?.groups.reduce((total, group) => total + group.entries.filter(entry => entry.selected).length, 0) ?? 0;
});

const pendingCount = computed(() => {
  return (
    props.draft?.groups.reduce(
      (total, group) =>
        total + group.entries.filter(entry => entry.confidence === 'medium' || (entry.warnings?.length ?? 0) > 0).length,
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
        <button class="secondary-action" type="button" :disabled="Boolean(progress)" @click="$emit('startAnalysis', 'quick')">
          重新分析
        </button>
        <button class="analysis-apply" type="button" :disabled="pendingCount > 0" @click="$emit('applyDraft')">
          确认并应用
        </button>
      </div>
    </div>

    <section v-if="!draft" class="analysis-empty" aria-labelledby="analysis-empty-title">
      <span class="analysis-empty-icon" aria-hidden="true">✦</span>
      <h2 id="analysis-empty-title">尚未生成时间线分析草稿</h2>
      <p>快速扫描会先在本地筛选候选；深度扫描会分析全部条目。两种方式都不会直接修改世界书。</p>
      <div class="analysis-scan-actions">
        <button class="analysis-scan-card" type="button" :disabled="Boolean(progress)" @click="$emit('startAnalysis', 'quick')">
          <span aria-hidden="true">⌁</span>
          <strong>快速扫描</strong>
          <small>先筛选明显候选，减少发送内容</small>
        </button>
        <button class="analysis-scan-card" type="button" :disabled="Boolean(progress)" @click="$emit('startAnalysis', 'deep')">
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
        <span>{{ selectedCount }} 个条目将被纳入时间线配置</span>
        <div>
          <button class="secondary-action" type="button" @click="$emit('discardDraft')">放弃草稿</button>
          <button class="analysis-apply" type="button" :disabled="pendingCount > 0" @click="$emit('applyDraft')">确认并应用</button>
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
