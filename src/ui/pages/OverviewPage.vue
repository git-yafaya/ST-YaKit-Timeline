<script setup lang="ts">
import { computed } from 'vue';
import type { HostScopeStatus } from '@/st/sillytavern-adapter';
import {
  getOverviewSourceState,
  type OverviewGroupKind,
  type OverviewGroupSummary,
} from '@/ui/pages/overview';

const props = withDefaults(
  defineProps<{
    groups?: readonly OverviewGroupSummary[];
    sourceEntryCount?: number;
    sourceMessage?: string;
    sourceStatus?: HostScopeStatus;
  }>(),
  {
    groups: () => [],
    sourceEntryCount: 0,
    sourceMessage: '',
    sourceStatus: 'unavailable',
  },
);

defineEmits<{
  inspect: [groupId: string];
  reanalyze: [];
}>();

const groupIcons: Record<OverviewGroupKind, string> = {
  route: '↝',
  character: '●',
  world: '◎',
};

const sourceState = computed(() => getOverviewSourceState(
  props.sourceStatus,
  props.sourceEntryCount,
  props.sourceMessage,
));
</script>

<template>
  <div class="overview-page">
    <div class="page-heading overview-heading">
      <div>
        <h1>时间线分组</h1>
        <p>查看各分组当前运行状态与生效条目。</p>
      </div>
      <button class="page-action" type="button" :disabled="!sourceState.canScan" @click="$emit('reanalyze')">
        <span aria-hidden="true">✦</span>
        {{ groups.length > 0 ? '重新分析' : '开始扫描' }}
      </button>
    </div>

    <div v-if="groups.length > 0" class="overview-grid">
      <article
        v-for="group in groups"
        :key="group.id"
        :class="['overview-card', { 'is-warning': group.warning }]"
      >
        <div class="overview-card-glow" aria-hidden="true"></div>
        <div class="overview-card-heading">
          <h2>
            <span class="overview-group-icon" aria-hidden="true">{{ groupIcons[group.kind] }}</span>
            {{ group.name }}
          </h2>

          <div class="overview-badges">
            <span :class="['badge', group.mode === 'auto' ? 'badge--auto' : 'badge--manual']">
              <span aria-hidden="true">{{ group.mode === 'auto' ? '✓' : '◌' }}</span>
              {{ group.mode === 'auto' ? '自动' : '手动' }}
            </span>
            <span v-if="group.warning" class="badge badge--warning">
              <span aria-hidden="true">!</span>
              异常
            </span>
          </div>
        </div>

        <div v-if="group.warning" class="overview-card-body">
          <div class="overview-warning">
            <span aria-hidden="true">!</span>
            <p>{{ group.warning }}</p>
          </div>
          <button class="inspect-button" type="button" @click="$emit('inspect', group.id)">前往检查</button>
        </div>

        <div v-else class="overview-card-body">
          <div class="eyebrow">当前生效</div>
          <div v-if="group.activeEntry" class="overview-current">
            <span class="overview-current-accent" aria-hidden="true"></span>
            <div>
              <p class="overview-current-title">{{ group.activeEntry.title }}</p>
              <p class="overview-current-range">{{ group.activeEntry.rangeLabel }}</p>
            </div>
          </div>
          <p v-else class="overview-no-entry">尚未获得有效故事时间。</p>
        </div>
      </article>
    </div>

    <section v-else class="overview-empty" aria-labelledby="overview-empty-title">
      <span class="overview-empty-icon" aria-hidden="true">{{ sourceState.icon }}</span>
      <h2 id="overview-empty-title">{{ sourceState.title }}</h2>
      <p>{{ sourceState.description }}</p>
      <button v-if="sourceState.canScan" class="primary-action" type="button" @click="$emit('reanalyze')">开始扫描</button>
    </section>
  </div>
</template>
