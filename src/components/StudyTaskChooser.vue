<script setup>
defineProps({ disabled: Boolean })
const emit = defineEmits(['start'])
</script>

<template>
  <section class="study-modes" aria-label="选择学习内容">
    <button class="btn btn-primary" :disabled="disabled" @click="emit('start', 'review-only')">复习旧词</button>
    <button class="btn btn-ghost" :disabled="disabled" @click="emit('start', 'new-only')">选择新词</button>
  </section>
</template>

<style scoped>
.study-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; width: 100%; max-width: 440px; margin: 0 auto; }
.study-modes .btn { width: 100%; min-height: 52px; padding: 14px 18px; }
@media (max-width: 480px) { .study-modes { gap: 12px; } .study-modes .btn { padding: 14px 10px; } }
</style>
