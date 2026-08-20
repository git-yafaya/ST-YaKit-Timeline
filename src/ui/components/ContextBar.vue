<script setup lang="ts">
withDefaults(
  defineProps<{
    characterName?: string;
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
  getCurrentTime: [];
  rejectRollback: [];
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
      @click="$emit('getCurrentTime')"
    >
      <span aria-hidden="true">◷</span>
      获取当前时间
    </button>

    <div v-if="runtimeNotice" class="context-notice" role="status" aria-live="polite">
      <span aria-hidden="true">!</span>
      <p>{{ runtimeNotice }}</p>
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
