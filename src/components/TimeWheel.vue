<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps({ modelValue: Number, count: Number, label: String })
const emit = defineEmits(['update:modelValue'])
const wheel = ref(null)
const rowHeight = 40
const format = value => String(value).padStart(2, '0')

function select(value) {
  const next = Math.max(0, Math.min(props.count - 1, value))
  wheel.value.scrollTop = next * rowHeight
  emit('update:modelValue', next)
}

function onScroll() {
  const value = Math.round(wheel.value.scrollTop / rowHeight)
  emit('update:modelValue', Math.max(0, Math.min(props.count - 1, value)))
}

onMounted(() => select(props.modelValue))
</script>

<template>
  <div class="wheel-column">
    <span aria-hidden="true">{{ label }}</span>
    <div class="wheel-window">
      <div
        ref="wheel" class="wheel" role="spinbutton" tabindex="0"
        :aria-label="label" :aria-valuenow="modelValue" :aria-valuetext="format(modelValue)"
        :aria-valuemin="0" :aria-valuemax="count - 1"
        @scroll.passive="onScroll"
        @keydown.up.prevent="select(modelValue + 1)" @keydown.down.prevent="select(modelValue - 1)"
        @keydown.home.prevent="select(0)" @keydown.end.prevent="select(count - 1)"
        @keydown.page-up.prevent="select(modelValue + 5)" @keydown.page-down.prevent="select(modelValue - 5)"
      >
        <div v-for="index in count" :key="index" class="wheel-row" :class="{ active: index - 1 === modelValue }"
          aria-hidden="true" @click="select(index - 1)">{{ format(index - 1) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wheel-column { min-width: 0; text-align: center; color: var(--ink-soft); font-size: 12px; }
.wheel-window { position: relative; margin-top: 6px; }
.wheel-window::before {
  content: '';
  position: absolute;
  inset: 60px 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--accent-soft);
  pointer-events: none;
}
.wheel {
  position: relative;
  height: 160px;
  padding-block: 60px;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: none;
  scroll-snap-type: y mandatory;
  border-radius: 10px;
  touch-action: pan-y;
  user-select: none;
}
.wheel::-webkit-scrollbar { display: none; }
.wheel:focus-visible { outline: 2px solid var(--accent-deep); outline-offset: 3px; }
.wheel-row {
  height: 40px;
  display: grid;
  place-items: center;
  scroll-snap-align: center;
  cursor: pointer;
  font-size: 19px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}
.wheel-row.active { color: var(--accent-deep); font-weight: 650; }
</style>
