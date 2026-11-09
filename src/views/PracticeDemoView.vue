<script setup>
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const scenes = [
  {
    title: '酒店入住', role: '酒店前台', task: '告诉前台你有预订，并报出姓名。',
    line: 'Welcome! How can I help you?',
    example: 'I have a reservation under Chen.',
    translation: '我有预订，登记的姓是陈。',
    withoutWord: 'I booked a room under Chen.',
    feedback: '这句话能让前台明白你的意思。这轮目标词还没练到。',
  },
  {
    title: '餐厅用餐', role: '餐厅接待', task: '告诉接待员你订了两人桌。',
    line: 'Good evening. Are you joining us for dinner?',
    example: 'I have a reservation for two.',
    translation: '我预订了两位。',
    withoutWord: 'I booked a table for two.',
    feedback: '这句话能说明你订了两人桌。这轮目标词还没练到。',
  },
]
const scene = ref(scenes[0])
const answer = ref('')
const hinted = ref(false)
const feedback = computed(() => {
  if (!answer.value) return ''
  if (answer.value === scene.value.withoutWord) return scene.value.feedback
  return hinted.value ? '提示后用出 · 你借助参考完成了目标表达。' : '目标词用法正确 · 你选出了适合这个场景的表达。'
})

function choose(nextScene) {
  scene.value = nextScene
  answer.value = ''
  hinted.value = false
}
</script>

<template>
  <section class="practice-demo">
    <h1 class="section-title">情境练习示范</h1>
    <p class="section-sub">用一轮预设对话，看看怎样把背过的词用进生活。免费体验，无需配置 AI，示范成绩不计入学习记录。</p>
    <div class="card demo-card">
      <div class="demo-actions" role="group" aria-label="选择示范情境">
        <button v-for="item in scenes" :key="item.title" type="button"
          :class="['btn', item === scene ? 'btn-primary' : 'btn-secondary']"
          :aria-pressed="item === scene" @click="choose(item)">{{ item.title }}</button>
      </div>
      <h2>{{ scene.title }}</h2>
      <p>{{ scene.task }}</p>
      <p>目标词 · <strong lang="en">reservation</strong> · 预订</p>
      <p><strong>{{ scene.role }}</strong> · <span lang="en">{{ scene.line }}</span></p>
      <template v-if="!answer">
        <p>选一句回应</p>
        <div class="demo-actions">
          <button type="button" class="btn btn-secondary" lang="en" @click="answer = scene.withoutWord">{{ scene.withoutWord }}</button>
          <button type="button" class="btn btn-secondary" lang="en" @click="answer = scene.example">{{ scene.example }}</button>
        </div>
        <button type="button" class="text-button" :disabled="hinted" @click="hinted = true">看一句提示</button>
        <p v-if="hinted">可以用 <strong lang="en">I have a reservation…</strong> 开头。</p>
      </template>
      <div v-else aria-live="polite">
        <p>你选择了 <strong lang="en">{{ answer }}</strong></p>
        <p>{{ feedback }}</p>
        <p>参考表达 · <span lang="en">{{ scene.example }}</span> · {{ scene.translation }}</p>
        <p>下一步可以换个地点，自己写一句含有 <span lang="en">reservation</span> 的回应。</p>
        <button type="button" class="btn btn-secondary" @click="choose(scene)">再试一次</button>
      </div>
    </div>
    <div class="demo-actions">
      <router-link v-if="auth.isOnboarded" class="btn btn-primary" to="/practice">去情境练习</router-link>
      <router-link v-if="auth.isOnboarded" class="btn btn-secondary" to="/study">去背单词</router-link>
      <router-link v-else class="btn btn-primary" to="/onboarding">返回学习设置</router-link>
    </div>
  </section>
</template>

<style scoped>
.practice-demo { max-width: 720px; margin: 0 auto; }
.demo-card { margin: 20px 0; }
.demo-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.demo-card p { line-height: 1.65; }
</style>
