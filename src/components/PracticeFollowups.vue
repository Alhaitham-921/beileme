<script setup>
import { computed, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import { http } from '../api/client.js'
import { useAppStore } from '../stores/app.js'
import PracticeScheduleDialog from './PracticeScheduleDialog.vue'

const props = defineProps({ sourceId: Number, compact: Boolean })
const emit = defineEmits(['transfer', 'scheduled'])
const router = useRouter()
const app = useAppStore()
const inputPrefix = useId()
const tasks = ref([])
const error = ref('')
const message = ref('')
const answers = ref({})
const shown = ref({})
const busy = ref(false)
const grading = ref({})
const grades = ref({})
const gradeErrors = ref({})
const scheduling = ref(null)
const visible = computed(() => tasks.value.filter(task => !props.sourceId || task.sourceSessionId === props.sourceId)
  .slice(0, props.compact ? 3 : 5))
const verdicts = { correct: '表达正确', needs_revision: '表达需要修改', off_task: '需要补全题目要求' }
let loadVersion = 0

async function load() {
  const version = ++loadVersion
  error.value = ''
  try {
    const data = await http.get('/practice/followups', { query: { sourceId: props.sourceId } })
    if (version !== loadVersion) return
    tasks.value = data.tasks
    for (const task of data.tasks) answers.value[task.id] ??= task.practiceAnswer || ''
  } catch (err) {
    if (version === loadVersion) error.value = err.message
  }
}

watch(() => props.sourceId, load, { immediate: true })

async function save(task) {
  busy.value = true
  error.value = ''
  try {
    const data = await http.post(`/practice/followups/${task.id}/short`, { body: { answer: answers.value[task.id] } })
    message.value = data.message
    shown.value[task.id] = true
    if (!task.wordId && task.scheduleMode) await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function grade(task) {
  const id = task.id
  const answer = answers.value[id]?.trim()
  if (!answer || grading.value[id]) return
  grading.value[id] = true
  delete gradeErrors.value[id]
  try {
    const data = await http.post(`/practice/followups/${id}/grade`, { body: { answer }, timeoutMs: 130_000 })
    grades.value[id] = { answer, ...data.feedback }
  } catch (err) {
    if (answers.value[id]?.trim() === answer) gradeErrors.value[id] = err.message
  } finally {
    grading.value[id] = false
  }
}

function feedbackFor(task) {
  const result = grades.value[task.id]
  return result?.answer === answers.value[task.id]?.trim() ? result : null
}

async function review(task) {
  busy.value = true
  error.value = ''
  try {
    await app.startReviewSession([task.wordId])
    await router.push('/study')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

async function scheduleRecall(task) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    task.recall = await http.post(`/practice/followups/${task.id}/recall`)
    message.value = task.recall.dueOn ? '已安排隔天复测。' : '场景复测已完成。'
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

function transfer(task) {
  if (props.compact) router.push({ path: '/practice', query: { followup: String(task.id) } })
  else emit('transfer', task)
}

function date(value) {
  const time = new Date(value)
  return time.toLocaleString('zh-CN', {
    ...(time.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
}

function checkText(task) {
  if (task.scheduleMode === 'next') return '已安排在下一轮单词学习'
  if (task.scheduleMode === 'time') return `已安排 ${date(task.scheduledAt)} 练习`
  return task.due ? '已到建议检查时间' : `建议下次检查 ${date(task.nextCheckAt)}`
}

function applySchedule({ scheduleMode, scheduledAt, due, remainingDueCount }) {
  const task = tasks.value.find(item => item.id === scheduling.value?.id)
  if (task) Object.assign(task, { scheduleMode, scheduledAt, due })
  message.value = scheduleMode === 'next' ? '已加入下一轮单词学习。' : `已安排 ${date(scheduledAt)} 练习。`
  emit('scheduled', remainingDueCount)
}
</script>

<template>
  <section v-if="visible.length || error" class="followups" aria-label="下一次练习">
    <h2>下一次练什么</h2>
    <p>根据之前的对话安排巩固，不把一次练习等同于长期掌握。</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" class="btn btn-quiet" @click="load">重试</button></p>
    <article v-for="task in visible" :key="task.id">
      <h3>{{ task.word }} <small>{{ task.sense }}</small></h3>
      <p>来自「{{ task.sourceTitle }}」· {{ task.reason }}</p>
      <p v-if="task.status === 'independent'">已在另一场景独立使用，继续按词汇复习计划巩固。</p>
      <div v-else class="check-row">
        <span>{{ checkText(task) }}</span>
        <button type="button" class="btn btn-quiet" @click="scheduling = task">
          {{ task.scheduleMode ? '调整练习时间' : '提前练习' }}
        </button>
      </div>
      <blockquote v-if="task.quote">你的原句：{{ task.quote }}</blockquote>
      <p v-else class="muted">本轮没有可引用的该词原句，不推断你已经使用过。</p>
      <p v-if="task.explanation">{{ task.explanation }}</p>
      <template v-if="!compact">
        <label :for="inputPrefix + task.id">{{ task.prompt }}</label>
        <textarea :id="inputPrefix + task.id" v-model="answers[task.id]" rows="2" maxlength="1000"
          placeholder="先独立写一句，再看参考" @input="delete gradeErrors[task.id]"></textarea>
        <div class="actions">
          <button type="button" class="btn btn-quiet" :disabled="busy || !answers[task.id]?.trim()" @click="save(task)">保存短句并对照参考</button>
          <div class="answer-actions">
            <button type="button" class="btn btn-quiet" :aria-expanded="!!shown[task.id]" @click="shown[task.id] = !shown[task.id]">
              {{ shown[task.id] ? '收起' : '查看' }}参考
            </button>
            <button type="button" class="btn btn-secondary" :disabled="grading[task.id] || !answers[task.id]?.trim()" @click="grade(task)">
              {{ grading[task.id] ? '正在批改…' : '批改短句' }}
            </button>
          </div>
        </div>
        <p v-if="shown[task.id]" class="reference">{{ task.reference || '尝试使用目标词表达，再在新情境中检验。' }}（表达可以有多种说法）</p>
        <p v-if="gradeErrors[task.id]" class="grade-error" role="alert">{{ gradeErrors[task.id] }}</p>
        <div v-if="feedbackFor(task)" class="feedback" :data-verdict="feedbackFor(task).verdict" role="status">
          <strong>{{ verdicts[feedbackFor(task).verdict] }}</strong>
          <p>{{ feedbackFor(task).explanation }}</p>
          <p v-if="feedbackFor(task).revision" class="revision" lang="en">{{ feedbackFor(task).revision }}</p>
        </div>
      </template>
      <p v-if="task.recall?.dueOn">隔天复测 · {{ task.recall.dueOn }} <router-link class="text-button" to="/recall">查看任务</router-link></p>
      <p v-else-if="task.recall">隔天复测已通过：更换情境后仍能独立用出。</p>
      <div class="actions">
        <button v-if="!compact && task.wordId && task.status === 'pending' && !task.recall" type="button"
          class="btn btn-secondary" :disabled="busy" @click="scheduleRecall(task)">安排隔天复测</button>
        <button v-if="task.wordId" type="button" class="btn btn-secondary" :disabled="busy" @click="review(task)">复习这个词</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="transfer(task)">换个情境再用一次</button>
      </div>
    </article>
    <p v-if="message" role="status">{{ message }}</p>
    <PracticeScheduleDialog v-if="scheduling" :task="scheduling" @close="scheduling = null" @scheduled="applySchedule" />
  </section>
</template>

<style scoped>
.followups { margin: 24px 0; text-align: left; }
.followups article { padding: 18px 0; border-bottom: 1px solid var(--line); }
small, .muted { color: var(--ink-soft); }
blockquote { margin: 12px 0; padding-left: 12px; border-left: 2px solid var(--line); }
textarea { display: block; width: 100%; margin: 10px 0; padding: 12px; background: var(--bg); color: inherit; border: 1px solid var(--line); border-radius: 8px; font: inherit; }
.check-row, .actions, .answer-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.check-row, .actions { margin-top: 12px; }
.check-row { color: var(--ink-soft); font-size: 13px; }
.feedback { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
.feedback strong { color: var(--warn-ink); }
.feedback[data-verdict='correct'] strong { color: var(--ok); }
.feedback p { margin: 6px 0 0; }
.revision, .reference { color: var(--accent-deep); }
.grade-error { color: var(--bad); }
</style>
