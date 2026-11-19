<script setup>
defineProps({ skeleton: Boolean })
</script>

<template>
  <span class="loading-state" :class="{ 'loading-state-panel': skeleton }" role="status">
    <span class="loading-state-caption"><span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span><span><slot>正在加载…</slot></span></span>
    <span v-if="skeleton" class="loading-skeleton" aria-hidden="true"><i></i><i></i><i></i></span>
  </span>
</template>
