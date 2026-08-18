<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { closeTimeline, type TimelinePage, uiState } from '@/ui/state';

const pages: Array<{ id: TimelinePage; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'timeline', label: '时间线' },
  { id: 'groups', label: '分组' },
  { id: 'analysis', label: 'AI分析' },
  { id: 'logs', label: '日志' },
  { id: 'settings', label: '设置' },
];

const pageTitle = computed(() => pages.find(page => page.id === uiState.activePage)?.label ?? '总览');
const narrowQuery = window.matchMedia('(max-width: 720px)');
const isNarrow = ref(narrowQuery.matches);
const updateNarrow = (event: MediaQueryListEvent) => (isNarrow.value = event.matches);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && uiState.open) closeTimeline();
}

onMounted(() => {
  narrowQuery.addEventListener('change', updateNarrow);
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  narrowQuery.removeEventListener('change', updateNarrow);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="timeline-root">
    <Transition name="timeline-fade">
      <div v-if="uiState.open" class="timeline-overlay" @click.self="closeTimeline">
        <section class="timeline-window" role="dialog" aria-modal="true" aria-label="时间线管理">
          <nav class="timeline-nav">
            <div class="timeline-brand">
              <i class="fa-solid fa-timeline" aria-hidden="true"></i>
              <span>时间线管理</span>
            </div>

            <div v-if="!isNarrow" class="timeline-tabs" aria-label="主导航">
              <button
                v-for="page in pages"
                :key="page.id"
                type="button"
                :class="['timeline-tab', { 'is-active': uiState.activePage === page.id }]"
                @click="uiState.activePage = page.id"
              >
                {{ page.label }}
              </button>
            </div>

            <div class="timeline-actions">
              <button class="button button-secondary get-time" type="button" disabled>获取当前时间</button>
              <button class="icon-button" type="button" aria-label="关闭" @click="closeTimeline">×</button>
            </div>
          </nav>

          <header class="timeline-context">
            <span><b>当前角色：</b>尚未读取</span>
            <span><b>当前世界书：</b>尚未读取</span>
            <span><b>当前故事时间：</b>等待有效 &lt;wlog&gt;</span>
          </header>

          <div v-if="isNarrow" class="timeline-mobile-tabs" aria-label="主导航">
            <button
              v-for="page in pages"
              :key="page.id"
              type="button"
              :class="['timeline-tab', { 'is-active': uiState.activePage === page.id }]"
              @click="uiState.activePage = page.id"
            >
              {{ page.label }}
            </button>
          </div>

          <main class="timeline-content">
            <template v-if="uiState.activePage === 'overview'">
              <div class="page-heading">
                <div>
                  <h1>时间线分组</h1>
                  <p>当前项目骨架已就绪，宿主数据接入将在后续模块中实现。</p>
                </div>
              </div>

              <div class="overview-grid">
                <article v-for="name in ['主线剧情', '角色个人线', '世界局势']" :key="name" class="status-card">
                  <div class="status-card-heading">
                    <h2>{{ name }}</h2>
                    <span class="badge">未配置</span>
                  </div>
                  <div class="status-card-body">
                    <span class="eyebrow">当前状态</span>
                    <p>扫描并确认世界书时间线后显示。</p>
                  </div>
                </article>
              </div>
            </template>

            <template v-else>
              <div class="empty-state">
                <span class="empty-icon" aria-hidden="true">◇</span>
                <h1>{{ pageTitle }}</h1>
                <p>页面入口已建立，功能将在对应领域模块接入后启用。</p>
              </div>
            </template>
          </main>
        </section>
      </div>
    </Transition>
  </div>
</template>
