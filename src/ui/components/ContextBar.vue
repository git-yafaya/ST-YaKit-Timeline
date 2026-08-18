<script setup lang="ts">
withDefaults(
  defineProps<{
    characterName?: string;
    storyTime?: string;
    worldbookName?: string;
  }>(),
  {
    characterName: '尚未读取',
    storyTime: '等待有效 <wlog>',
    worldbookName: '尚未读取',
  },
);

defineEmits<{
  getCurrentTime: [];
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

    <button class="button context-get-time" type="button" disabled @click="$emit('getCurrentTime')">
      <span aria-hidden="true">◷</span>
      获取当前时间
    </button>
  </header>
</template>
