<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { PRODUCT_NAME } from '@/branding';
import ContextBar from '@/ui/components/ContextBar.vue';
import TopNav from '@/ui/components/TopNav.vue';
import type { TimelinePage } from '@/ui/state';
import type { ControlStatus } from '@/timeline/control-lock';

defineProps<{
  activePage: TimelinePage;
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
}>();

const emit = defineEmits<{
  close: [];
  confirmRollback: [];
  getCurrentTime: [];
  rejectRollback: [];
  takeControl: [];
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

    <section class="timeline-window" role="dialog" aria-modal="true" :aria-label="PRODUCT_NAME">
      <TopNav
        :active-page="activePage"
        :time-action-busy="timeActionBusy"
        @close="$emit('close')"
        @get-current-time="$emit('getCurrentTime')"
        @select-page="$emit('selectPage', $event)"
      />
      <ContextBar
        :character-name="characterName"
        :control-status="controlStatus"
        :runtime-notice="runtimeNotice"
        :rollback-prompt="rollbackPrompt"
        :story-time="storyTime"
        :time-action-busy="timeActionBusy"
        :worldbook-name="worldbookName"
        @confirm-rollback="$emit('confirmRollback')"
        @get-current-time="$emit('getCurrentTime')"
        @reject-rollback="$emit('rejectRollback')"
        @take-control="$emit('takeControl')"
      />

      <main class="timeline-content">
        <slot />
      </main>
    </section>
  </div>
</template>
