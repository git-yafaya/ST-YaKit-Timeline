<script setup lang="ts">
import type { ControlStatus } from '@/timeline/control-lock';

withDefaults(
  defineProps<{
    characterName?: string;
    controlStatus?: ControlStatus;
    runtimeNotice?: string;
    rollbackPrompt?: {
      from: string;
      to: string;
    };
    storyTime?: string;
    timeActionBusy?: boolean;
    worldbookName?: string;
  }>(),
  {
    characterName: '尚未读取',
    storyTime: '等待有效 <wlog>',
    worldbookName: '尚未读取',
  },
);

defineEmits<{
  confirmRollback: [];
  'get-current-time': [];
  rejectRollback: [];
  takeControl: [];
}>();
</script>

<template>
  <header class="timeline-context">
    <div class="context-items">
      <div class="context-item">
        <span class="context-icon context-icon--character" aria-hidden="true">●</span>
        <span class="context-label">当前角色：</span>
        <span class="context-value">{{ characterName }}</span>
      </div>

      <div class="context-item">
        <span class="context-icon context-icon--worldbook" aria-hidden="true">◎</span>
        <span class="context-label">当前世界书：</span>
        <span class="context-value">{{ worldbookName }}</span>
      </div>

      <div class="context-item">
        <span class="context-icon context-icon--time" aria-hidden="true">◷</span>
        <span class="context-label">当前故事时间：</span>
        <span class="context-value context-value--time">{{ storyTime }}</span>
      </div>
    </div>

    <button
      class="button context-get-time"
      type="button"
      :disabled="timeActionBusy"
      @click="$emit('get-current-time')"
    >
      <span aria-hidden="true">◷</span>
      {{ timeActionBusy ? '读取中…' : '获取当前时间' }}
    </button>

    <div v-if="runtimeNotice" class="context-notice" role="status" aria-live="polite">
      <span aria-hidden="true">!</span>
      <p>{{ runtimeNotice }}</p>
    </div>

    <div v-if="controlStatus === 'other'" class="context-notice context-notice--control" role="status">
      <span aria-hidden="true">◎</span>
      <p>其他标签页正在控制当前世界书。</p>
      <button type="button" @click="$emit('takeControl')">接管控制权</button>
    </div>

    <div v-if="rollbackPrompt" class="context-rollback" role="alert">
      <div>
        <strong>⚠ 检测到时间倒退</strong>
        <p>{{ rollbackPrompt.from }} → {{ rollbackPrompt.to }}。是否应用新时间？</p>
      </div>
      <div class="context-rollback-actions">
        <button type="button" @click="$emit('rejectRollback')">保留原时间</button>
        <button type="button" class="is-confirm" @click="$emit('confirmRollback')">应用新时间</button>
      </div>
    </div>
  </header>
</template>
