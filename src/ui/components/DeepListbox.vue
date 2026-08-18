<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import type { DeepListboxOption } from '@/ui/components/deep-listbox';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    label: string;
    modelValue: string;
    options: readonly DeepListboxOption[];
    placeholder?: string;
  }>(),
  {
    disabled: false,
    placeholder: '请选择',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const instanceId = useId();
const listboxId = `${instanceId}-listbox`;

const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));
const selectedOption = computed(() => props.options[selectedIndex.value] ?? null);
const activeOptionId = computed(() => {
  return open.value && activeIndex.value >= 0 ? `${instanceId}-option-${activeIndex.value}` : undefined;
});

watch(
  () => props.disabled,
  disabled => {
    if (disabled) closeListbox(false);
  },
);

function firstEnabledIndex(): number {
  return props.options.findIndex(option => !option.disabled);
}

function lastEnabledIndex(): number {
  for (let index = props.options.length - 1; index >= 0; index -= 1) {
    if (!props.options[index]?.disabled) return index;
  }
  return -1;
}

function openListbox(): void {
  if (props.disabled || props.options.length === 0) return;
  activeIndex.value = selectedIndex.value >= 0 && !props.options[selectedIndex.value]?.disabled
    ? selectedIndex.value
    : firstEnabledIndex();
  open.value = activeIndex.value >= 0;
  void nextTick(scrollActiveOptionIntoView);
}

function closeListbox(restoreFocus = true): void {
  open.value = false;
  activeIndex.value = -1;
  if (restoreFocus) void nextTick(() => trigger.value?.focus());
}

function toggleListbox(): void {
  if (open.value) closeListbox();
  else openListbox();
}

function moveActive(step: 1 | -1): void {
  if (!open.value) openListbox();
  if (!open.value || props.options.length === 0) return;

  let next = activeIndex.value;
  for (let attempt = 0; attempt < props.options.length; attempt += 1) {
    next = (next + step + props.options.length) % props.options.length;
    if (!props.options[next]?.disabled) {
      activeIndex.value = next;
      void nextTick(scrollActiveOptionIntoView);
      return;
    }
  }
}

function setBoundary(boundary: 'first' | 'last'): void {
  const next = boundary === 'first' ? firstEnabledIndex() : lastEnabledIndex();
  if (next < 0) return;
  activeIndex.value = next;
  void nextTick(scrollActiveOptionIntoView);
}

function selectOption(option: DeepListboxOption): void {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  closeListbox();
}

function selectActiveOption(): void {
  const option = props.options[activeIndex.value];
  if (option) selectOption(option);
}

function scrollActiveOptionIntoView(): void {
  const option = root.value?.querySelector<HTMLElement>(`#${CSS.escape(`${instanceId}-option-${activeIndex.value}`)}`);
  option?.scrollIntoView({ block: 'nearest' });
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActive(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActive(-1);
  } else if (event.key === 'Home' && open.value) {
    event.preventDefault();
    setBoundary('first');
  } else if (event.key === 'End' && open.value) {
    event.preventDefault();
    setBoundary('last');
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (open.value) selectActiveOption();
    else openListbox();
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    event.stopPropagation();
    closeListbox();
  } else if (event.key === 'Tab') {
    closeListbox(false);
  }
}

function onWindowPointerDown(event: PointerEvent): void {
  if (!open.value || !root.value) return;
  if (!event.composedPath().includes(root.value)) closeListbox(false);
}

onMounted(() => window.addEventListener('pointerdown', onWindowPointerDown));
onUnmounted(() => window.removeEventListener('pointerdown', onWindowPointerDown));
</script>

<template>
  <div ref="root" :class="['deep-listbox', { 'is-open': open, 'is-disabled': disabled }]">
    <button
      ref="trigger"
      class="deep-listbox-trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-activedescendant="activeOptionId"
      :disabled="disabled"
      @click="toggleListbox"
      @keydown="onTriggerKeydown"
    >
      <span>{{ selectedOption?.label ?? placeholder }}</span>
      <i aria-hidden="true"></i>
    </button>

    <Transition name="listbox-popover">
      <ul v-if="open" :id="listboxId" class="deep-listbox-options" role="listbox" :aria-label="label">
        <li
          v-for="(option, index) in options"
          :id="`${instanceId}-option-${index}`"
          :key="option.value"
          role="option"
          :aria-selected="option.value === modelValue"
          :aria-disabled="option.disabled || undefined"
          :class="[
            'deep-listbox-option',
            {
              'is-active': index === activeIndex,
              'is-selected': option.value === modelValue,
              'is-disabled': option.disabled,
            },
          ]"
          @pointermove="!option.disabled && (activeIndex = index)"
          @click="selectOption(option)"
        >
          <span>{{ option.label }}</span>
          <i v-if="option.value === modelValue" aria-hidden="true">✓</i>
        </li>
      </ul>
    </Transition>
  </div>
</template>
