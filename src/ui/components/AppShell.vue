<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import ContextBar from '@/ui/components/ContextBar.vue';
import TopNav from '@/ui/components/TopNav.vue';
import type { TimelinePage } from '@/ui/state';

defineProps<{
  activePage: TimelinePage;
  characterName?: string;
  storyTime?: string;
  worldbookName?: string;
}>();

const emit = defineEmits<{
  close: [];
  getCurrentTime: [];
  selectPage: [page: TimelinePage];
}>();

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="timeline-overlay" @click.self="$emit('close')">
    <div class="ambient-glow ambient-glow--primary" aria-hidden="true"></div>
    <div class="ambient-glow ambient-glow--tertiary" aria-hidden="true"></div>

    <section
      :class="['timeline-window', { 'timeline-window--settings': activePage === 'settings' }]"
      role="dialog"
      aria-modal="true"
      aria-label="时间线管理"
    >
      <TopNav
        v-if="activePage !== 'settings'"
        :active-page="activePage"
        @close="$emit('close')"
        @get-current-time="$emit('getCurrentTime')"
        @select-page="$emit('selectPage', $event)"
      />
      <ContextBar
        v-if="activePage !== 'settings'"
        :character-name="characterName"
        :story-time="storyTime"
        :worldbook-name="worldbookName"
        @get-current-time="$emit('getCurrentTime')"
      />

      <main :class="['timeline-content', { 'timeline-content--settings': activePage === 'settings' }]">
        <slot />
      </main>
    </section>
  </div>
</template>
