<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { EntryId } from '@/timeline/types';
import type { GroupManagementEntry, GroupManagementSummary } from '@/ui/pages/groups';

type OperationMode = 'create' | 'delete' | 'merge' | 'split' | null;

const props = withDefaults(
  defineProps<{
    groups?: readonly GroupManagementSummary[];
  }>(),
  {
    groups: () => [],
  },
);

const emit = defineEmits<{
  createGroup: [name: string];
  deleteGroup: [groupId: string];
  mergeGroup: [sourceGroupId: string, targetGroupId: string];
  moveEntries: [sourceGroupId: string, targetGroupId: string, entryIds: readonly EntryId[]];
  renameGroup: [groupId: string, name: string];
  reorderEntries: [groupId: string, orderedEntryIds: readonly EntryId[]];
  reorderGroups: [orderedGroupIds: readonly string[]];
  splitGroup: [sourceGroupId: string, name: string, movedEntryIds: readonly EntryId[]];
  startAnalysis: [];
}>();

const selectedGroupId = ref('');
const groupOrder = ref<string[]>([]);
const entryOrder = ref<EntryId[]>([]);
const operationMode = ref<OperationMode>(null);
const moreOpen = ref(false);
const renaming = ref(false);
const nameDraft = ref('');
const mergeTargetId = ref('');
const draggedGroupId = ref<string | null>(null);
const draggedEntryId = ref<EntryId | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);

const orderedGroups = computed(() => {
  const lookup = new Map(props.groups.map(group => [group.id, group]));
  return groupOrder.value.map(id => lookup.get(id)).filter((group): group is GroupManagementSummary => Boolean(group));
});

const currentGroup = computed(() => {
  return props.groups.find(group => group.id === selectedGroupId.value) ?? props.groups[0] ?? null;
});

const orderedEntries = computed(() => {
  const group = currentGroup.value;
  if (!group) return [];
  const lookup = new Map(group.entries.map(entry => [entry.entryId, entry]));
  return entryOrder.value.map(id => lookup.get(id)).filter((entry): entry is GroupManagementEntry => Boolean(entry));
});

const mergeTargets = computed(() => {
  return orderedGroups.value.filter(group => group.id !== currentGroup.value?.id);
});

const formalGroupCount = computed(() => props.groups.length);

watch(
  () => props.groups,
  groups => {
    const ids = groups.map(group => group.id);
    const retained = groupOrder.value.filter(id => ids.includes(id));
    const appended = ids.filter(id => !retained.includes(id));
    groupOrder.value = [...retained, ...appended];

    if (groups.length === 0) {
      selectedGroupId.value = '';
    } else if (!groups.some(group => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups[0].id;
    }
  },
  { immediate: true },
);

watch(
  currentGroup,
  group => {
    if (!group) {
      entryOrder.value = [];
      return;
    }
    const ids = group.entries.map(entry => entry.entryId);
    const retained = entryOrder.value.filter(id => ids.includes(id));
    entryOrder.value = [...retained, ...ids.filter(id => !retained.includes(id))];
    renaming.value = false;
    moreOpen.value = false;
  },
  { immediate: true },
);

function selectGroup(groupId: string): void {
  selectedGroupId.value = groupId;
}

function beginRename(): void {
  const group = currentGroup.value;
  if (!group) return;
  nameDraft.value = group.name;
  renaming.value = true;
  moreOpen.value = false;
  void nextTick(() => nameInput.value?.focus());
}

function saveRename(): void {
  const group = currentGroup.value;
  const name = nameDraft.value.trim();
  if (!group || !name) {
    nameInput.value?.focus();
    return;
  }
  emit('renameGroup', group.id, name);
  renaming.value = false;
}

function openOperation(mode: Exclude<OperationMode, null>): void {
  const group = currentGroup.value;
  if (mode !== 'create' && !group) return;

  operationMode.value = mode;
  moreOpen.value = false;
  nameDraft.value = mode === 'split' && group ? `${group.name} - 拆分` : '';
  mergeTargetId.value = mergeTargets.value[0]?.id ?? '';
  void nextTick(() => nameInput.value?.focus());
}

function closeOperation(): void {
  operationMode.value = null;
  nameDraft.value = '';
  mergeTargetId.value = '';
}

function confirmOperation(): void {
  const group = currentGroup.value;

  if (operationMode.value === 'create') {
    const name = nameDraft.value.trim();
    if (!name) return nameInput.value?.focus();
    emit('createGroup', name);
  } else if (operationMode.value === 'merge' && group && mergeTargetId.value) {
    emit('mergeGroup', group.id, mergeTargetId.value);
  } else if (operationMode.value === 'split' && group) {
    const name = nameDraft.value.trim();
    if (!name) return nameInput.value?.focus();
    const splitAt = Math.ceil(orderedEntries.value.length / 2);
    emit(
      'splitGroup',
      group.id,
      name,
      orderedEntries.value.slice(splitAt).map(entry => entry.entryId),
    );
  } else if (operationMode.value === 'delete' && group) {
    emit('deleteGroup', group.id);
  } else {
    return;
  }

  closeOperation();
}

function reorder<T>(values: readonly T[], source: T, target: T): T[] {
  const next = values.filter(value => value !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
  return next;
}

function dropGroup(targetGroupId: string): void {
  const sourceEntryId = draggedEntryId.value;
  draggedEntryId.value = null;
  if (sourceEntryId !== null) {
    const sourceGroupId = currentGroup.value?.id;
    if (sourceGroupId && sourceGroupId !== targetGroupId) {
      emit('moveEntries', sourceGroupId, targetGroupId, [sourceEntryId]);
    }
    return;
  }
  const sourceGroupId = draggedGroupId.value;
  draggedGroupId.value = null;
  if (!sourceGroupId || sourceGroupId === targetGroupId) return;

  const next = reorder(groupOrder.value, sourceGroupId, targetGroupId);
  groupOrder.value = next;
  emit('reorderGroups', groupOrder.value);
}

function dropEntry(targetEntryId: EntryId): void {
  const group = currentGroup.value;
  const sourceEntryId = draggedEntryId.value;
  draggedEntryId.value = null;
  if (!group || sourceEntryId === null || sourceEntryId === targetEntryId) return;

  entryOrder.value = reorder(entryOrder.value, sourceEntryId, targetEntryId);
  emit('reorderEntries', group.id, entryOrder.value);
}

function beginTouchGroupDrag(event: PointerEvent, groupId: string): void {
  if (event.pointerType === 'mouse') return;
  event.preventDefault();
  draggedGroupId.value = groupId;
  draggedEntryId.value = null;
}

function beginTouchEntryDrag(event: PointerEvent, entryId: EntryId): void {
  if (event.pointerType === 'mouse') return;
  event.preventDefault();
  draggedEntryId.value = entryId;
  draggedGroupId.value = null;
}

function clearTouchDrag(event?: PointerEvent): void {
  if (event?.pointerType === 'mouse') return;
  draggedGroupId.value = null;
  draggedEntryId.value = null;
}

function finishTouchGroupDrop(event: PointerEvent, groupId: string): void {
  if (event.pointerType === 'mouse' || (draggedGroupId.value === null && draggedEntryId.value === null)) return;
  event.preventDefault();
  dropGroup(groupId);
}

function finishTouchEntryDrop(event: PointerEvent, entryId: EntryId): void {
  if (event.pointerType === 'mouse' || draggedEntryId.value === null) return;
  event.preventDefault();
  dropEntry(entryId);
}

function onPointerUp(event: PointerEvent): void {
  clearTouchDrag(event);
}

function onPointerCancel(event: PointerEvent): void {
  clearTouchDrag(event);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (!operationMode.value && !renaming.value && !moreOpen.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeOperation();
  renaming.value = false;
  moreOpen.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
});
</script>

<template>
  <div class="groups-page" @click="moreOpen = false">
    <div class="page-heading groups-heading">
      <div>
        <h1>分组管理</h1>
        <p>整理时间线条目的归属与顺序。</p>
      </div>
      <button class="page-action" type="button" @click.stop="openOperation('create')">
        <span aria-hidden="true">＋</span>
        新建分组
      </button>
    </div>

    <section v-if="groups.length === 0" class="groups-empty" aria-labelledby="groups-empty-title">
      <span aria-hidden="true">◇</span>
      <h2 id="groups-empty-title">当前没有可管理的时间线分组</h2>
      <p>先完成 AI 扫描并确认草稿，或手动新建一个空分组。</p>
      <div class="groups-empty-actions">
        <button class="secondary-action" type="button" @click="openOperation('create')">新建空分组</button>
        <button class="primary-action" type="button" @click="$emit('startAnalysis')">开始扫描</button>
      </div>
    </section>

    <div v-else class="groups-workspace">
      <section class="groups-sidebar" aria-label="时间线组列表">
        <header>
          <h2>时间线组</h2>
          <p>{{ formalGroupCount }} 个分组</p>
        </header>

        <div class="groups-list">
          <button
            v-for="group in orderedGroups"
            :key="group.id"
            type="button"
            draggable="true"
            :class="['group-list-item', { 'is-selected': currentGroup?.id === group.id }]"
            @click="selectGroup(group.id)"
            @dragstart="draggedGroupId = group.id"
            @dragend="draggedGroupId = null"
            @dragover.prevent
            @drop.prevent="dropGroup(group.id)"
            @pointerup.stop="finishTouchGroupDrop($event, group.id)"
            @pointercancel.stop="clearTouchDrag"
          >
            <span class="drag-mark" aria-hidden="true" @pointerdown.stop="beginTouchGroupDrag($event, group.id)">⠿</span>
            <span class="group-list-name">{{ group.name }}</span>
            <span class="group-list-count">{{ group.entries.length }}</span>
          </button>
        </div>
      </section>

      <section v-if="currentGroup" class="group-detail">
        <header class="group-detail-heading">
          <div>
            <div class="group-title-row">
              <h2>{{ currentGroup.name }}</h2>
              <span>{{ currentGroup.entries.length }} 条目</span>
            </div>
            <p>当前分组中的时间线条目</p>
          </div>

          <div class="group-detail-actions">
            <button type="button" @click="beginRename">重命名</button>
            <div class="group-more" @click.stop>
              <button
                class="group-more-trigger"
                type="button"
                aria-label="更多分组操作"
                :aria-expanded="moreOpen"
                @click="moreOpen = !moreOpen"
              >
                ⋯
              </button>
              <div v-if="moreOpen" class="group-more-menu">
                <button type="button" :disabled="mergeTargets.length === 0" @click="openOperation('merge')">
                  合并到其他组
                </button>
                <button type="button" :disabled="orderedEntries.length < 2" @click="openOperation('split')">
                  拆分分组
                </button>
                <button class="danger-action" type="button" @click="openOperation('delete')">删除分组</button>
              </div>
            </div>
          </div>
        </header>

        <form v-if="renaming" class="rename-editor" @submit.prevent="saveRename">
          <div class="field-label-row">
            <label for="rename-group-input">分组名称</label>
            <span>人工</span>
          </div>
          <input id="rename-group-input" ref="nameInput" v-model="nameDraft" type="text" maxlength="80" />
          <p>修改后的分组名称将作为人工设定保留。</p>
          <div class="editor-actions">
            <button type="button" @click="renaming = false">取消</button>
            <button class="confirm-action" type="submit">保存</button>
          </div>
        </form>

        <div v-if="orderedEntries.length > 0" class="group-entry-list">
          <article
            v-for="entry in orderedEntries"
            :key="entry.entryId"
            :class="['group-entry-card', { 'has-warning': entry.warning }]"
            draggable="true"
            @dragstart="draggedEntryId = entry.entryId"
            @dragend="draggedEntryId = null"
            @dragover.prevent
            @drop.prevent="dropEntry(entry.entryId)"
            @pointerup.stop="finishTouchEntryDrop($event, entry.entryId)"
            @pointercancel.stop="clearTouchDrag"
          >
            <span
              class="entry-drag-mark"
              aria-hidden="true"
              @pointerdown.stop="beginTouchEntryDrag($event, entry.entryId)"
            >⠿</span>
            <div class="group-entry-copy">
              <div class="group-entry-title-row">
                <h3>{{ entry.title }}</h3>
                <span :class="['origin-badge', { 'is-manual': entry.origin === 'manual' }]">
                  {{ entry.origin === 'manual' ? '人工修改' : 'AI识别' }}
                </span>
                <span v-if="entry.warning" class="entry-warning"><b aria-hidden="true">!</b>{{ entry.warning }}</span>
              </div>
              <div class="group-entry-meta">
                <span>{{ entry.rangeLabel }}</span>
                <span>原条目：{{ entry.originalComment }}</span>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="group-detail-empty">
          <span aria-hidden="true">◇</span>
          <h3>此分组还没有条目</h3>
          <p>可拖拽条目到左侧其他分组完成跨组移动。</p>
        </div>
      </section>
    </div>

    <div v-if="operationMode" class="group-dialog-overlay" @click.self="closeOperation">
      <section class="group-dialog" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title">
        <header>
          <div>
            <h2 id="group-dialog-title">
              {{
                operationMode === 'create'
                  ? '新建时间线组'
                  : operationMode === 'merge'
                    ? '合并分组'
                    : operationMode === 'split'
                      ? '拆分分组'
                      : '删除分组'
              }}
            </h2>
            <p v-if="operationMode === 'create'">创建一个新的时间线分组</p>
            <p v-else-if="currentGroup">当前分组：{{ currentGroup.name }}</p>
          </div>
          <button type="button" aria-label="关闭分组操作" @click="closeOperation">×</button>
        </header>

        <div class="group-dialog-body">
          <label v-if="operationMode === 'create' || operationMode === 'split'" class="group-dialog-field">
            <span>分组名称</span>
            <input ref="nameInput" v-model="nameDraft" type="text" maxlength="80" placeholder="例如：主线剧情" />
          </label>

          <label v-else-if="operationMode === 'merge'" class="group-dialog-field">
            <span>目标分组</span>
            <select v-model="mergeTargetId">
              <option v-for="group in mergeTargets" :key="group.id" :value="group.id">{{ group.name }}</option>
            </select>
          </label>

          <div v-else class="delete-notice">
            <p>删除后将移除该分组及其时间线映射。</p>
            <span>不会修改世界书正文；如需恢复，请重新分析并确认配置。</span>
          </div>

          <p v-if="operationMode === 'split'" class="dialog-hint">
            将按当前顺序把后半部分条目移动到新分组；应用前由配置层再次校验。
          </p>
        </div>

        <footer>
          <button type="button" @click="closeOperation">取消</button>
          <button
            :class="['confirm-action', { 'is-danger': operationMode === 'delete' }]"
            type="button"
            @click="confirmOperation"
          >
            {{ operationMode === 'create' ? '创建' : operationMode === 'delete' ? '删除' : '确认' }}
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>
