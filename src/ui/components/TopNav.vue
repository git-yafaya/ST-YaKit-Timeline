<script setup lang="ts">
import { PRODUCT_NAME } from '@/branding';
import { TIMELINE_PAGES } from '@/ui/navigation';
import type { TimelinePage } from '@/ui/state';

defineProps<{
  activePage: TimelinePage;
  timeActionBusy?: boolean;
}>();

defineEmits<{
  close: [];
  'get-current-time': [];
  selectPage: [page: TimelinePage];
}>();
</script>

<template>
  <nav class="timeline-nav" :aria-label="`${PRODUCT_NAME}主导航`">
    <div class="timeline-nav-main">
      <div class="timeline-brand">
        <i class="fa-solid fa-timeline" aria-hidden="true"></i>
        <span>{{ PRODUCT_NAME }}</span>
      </div>

      <div class="timeline-tabs timeline-tabs--desktop">
        <button
          v-for="page in TIMELINE_PAGES"
          :key="page.id"
          type="button"
          :class="['timeline-tab', { 'is-active': activePage === page.id }]"
          @click="$emit('selectPage', page.id)"
        >
          {{ page.label }}
        </button>
      </div>

      <div class="timeline-actions">
        <button
          :class="['button', 'button-secondary', 'get-time', { 'is-loading': timeActionBusy }]"
          type="button"
          :disabled="timeActionBusy"
          :aria-busy="timeActionBusy"
          @click="$emit('get-current-time')"
        >
          <span class="action-icon" aria-hidden="true">◷</span>
          {{ timeActionBusy ? '读取中…' : '获取当前时间' }}
        </button>
        <button class="icon-button" type="button" aria-label="关闭" @click="$emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
          </svg>
        </button>
      </div>
    </div>

    <div class="timeline-tabs timeline-tabs--mobile">
      <button
        v-for="page in TIMELINE_PAGES"
        :key="page.id"
        type="button"
        :class="['timeline-tab', { 'is-active': activePage === page.id }]"
        @click="$emit('selectPage', page.id)"
      >
        {{ page.label }}
      </button>
    </div>
  </nav>
</template>
