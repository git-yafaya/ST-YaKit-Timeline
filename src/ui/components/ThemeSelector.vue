<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { ThemeMode } from '@/ui/pages/settings';

const props = defineProps<{
  modelValue: ThemeMode;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ThemeMode];
}>();

const root = ref<HTMLElement | null>(null);

const themeOptions = [
  {
    value: 'follow',
    title: '跟随',
    subtitle: 'SillyTavern',
    icon: 'fa-solid fa-circle-half-stroke',
  },
  {
    value: 'light',
    title: '浅色',
    subtitle: '明亮阅读',
    icon: 'fa-solid fa-sun',
  },
  {
    value: 'dark',
    title: '深色',
    subtitle: '低亮度',
    icon: 'fa-solid fa-moon',
  },
] as const satisfies ReadonlyArray<{
  icon: string;
  subtitle: string;
  title: string;
  value: ThemeMode;
}>;

const selectedIndex = computed(() => {
  const index = themeOptions.findIndex(option => option.value === props.modelValue);
  return index >= 0 ? index : 0;
});

function selectTheme(value: ThemeMode): void {
  emit('update:modelValue', value);
}

function focusTheme(value: ThemeMode): void {
  void nextTick(() => {
    root.value
      ?.querySelector<HTMLButtonElement>(`[data-theme-mode="${value}"]`)
      ?.focus();
  });
}

function moveTheme(current: ThemeMode, step: 1 | -1): void {
  const currentIndex = themeOptions.findIndex(option => option.value === current);
  const startIndex = currentIndex >= 0 ? currentIndex : selectedIndex.value;
  const nextIndex = (startIndex + step + themeOptions.length) % themeOptions.length;
  const nextTheme = themeOptions[nextIndex];
  if (!nextTheme) return;

  selectTheme(nextTheme.value);
  focusTheme(nextTheme.value);
}

function jumpTheme(edge: 'first' | 'last'): void {
  const nextTheme = themeOptions[edge === 'first' ? 0 : themeOptions.length - 1];
  if (!nextTheme) return;

  selectTheme(nextTheme.value);
  focusTheme(nextTheme.value);
}

function onThemeKeydown(event: KeyboardEvent, current: ThemeMode): void {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveTheme(current, 1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveTheme(current, -1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    jumpTheme('first');
  } else if (event.key === 'End') {
    event.preventDefault();
    jumpTheme('last');
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectTheme(current);
  }
}
</script>

<template>
  <div
    ref="root"
    class="theme-selector"
    role="radiogroup"
    aria-label="主题"
    aria-orientation="horizontal"
  >
    <button
      v-for="(option, index) in themeOptions"
      :key="option.value"
      class="theme-selector-card"
      :class="{ 'is-active': props.modelValue === option.value }"
      type="button"
      role="radio"
      :aria-checked="props.modelValue === option.value"
      :tabindex="index === selectedIndex ? 0 : -1"
      :data-theme-mode="option.value"
      @click="selectTheme(option.value)"
      @keydown="onThemeKeydown($event, option.value)"
    >
      <i class="theme-selector-icon" :class="option.icon" aria-hidden="true"></i>
      <span class="theme-selector-title">{{ option.title }}</span>
      <small class="theme-selector-subtitle">{{ option.subtitle }}</small>
    </button>
  </div>
</template>

<style scoped>
.theme-selector {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(104px, 1fr));
  gap: 8px;
  flex: 0 1 390px;
}

.theme-selector-card {
  min-width: 0;
  min-height: 76px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 8px;
  padding: 10px 11px;
  border: 1px solid var(--tl-border-subtle);
  border-radius: 14px;
  color: var(--tl-text-muted);
  background: var(--tl-panel-solid);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    color 180ms ease-out,
    background-color 180ms ease-out,
    border-color 180ms ease-out,
    box-shadow 180ms ease-out,
    transform 180ms ease-out;
}

.theme-selector-card:hover {
  border-color: var(--tl-border-soft);
  color: var(--tl-text);
  background: var(--tl-surface-hover);
  box-shadow: var(--tl-shadow-elevated);
}

.theme-selector-card:active {
  transform: translateY(1px) scale(0.985);
}

.theme-selector-card.is-active {
  border-color: var(--tl-primary);
  color: var(--tl-primary);
  background: var(--tl-primary-surface-soft);
  box-shadow: var(--tl-shadow-card);
}

.theme-selector-card:focus-visible {
  outline: none;
  border-color: var(--tl-border-soft);
  box-shadow: var(--tl-shadow-card), var(--tl-focus-ring-strong);
}

.theme-selector-icon {
  grid-row: 1 / -1;
  font-size: 15px;
}

.theme-selector-title,
.theme-selector-subtitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-selector-title {
  color: inherit;
  font-size: 13px;
  font-weight: 650;
  line-height: 18px;
}

.theme-selector-subtitle {
  color: var(--tl-text-muted);
  font-size: 10px;
  line-height: 15px;
}

</style>
