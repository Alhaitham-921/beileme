<script setup>
defineProps({ usage: Object, label: { type: String, default: '本次 AI 消耗' } })
</script>

<template>
  <p v-if="usage" class="ai-usage" aria-live="polite">
    <strong>{{ label }}</strong> · 输入 {{ usage.promptTokens ?? 0 }} + 输出 {{ usage.completionTokens ?? 0 }} = {{ (usage.promptTokens || 0) + (usage.completionTokens || 0) }} token
    <span v-if="usage.calls"> · {{ usage.calls }} 次调用（含重试）</span>
    <span v-if="usage.estimatedCostText"> · 参考费用 {{ usage.estimatedCostText }}（以服务商账单为准）</span>
    <span v-if="usage.unknownCalls"> · 部分调用未返回用量，消耗待服务商确认</span>
  </p>
</template>

<style scoped>
.ai-usage { margin: 12px 0; padding: 12px 16px; border: 1px solid var(--line, #506078); border-radius: 12px; color: var(--ink-soft, #bcc8df); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
</style>
