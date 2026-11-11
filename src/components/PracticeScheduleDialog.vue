<script setup>
import { computed, nextTick, onMounted, ref, useId } from 'vue'
import { http } from '../api/client.js'
import TimeWheel from './TimeWheel.vue'

const props = defineProps({ task: { type: Object, required: true } })
const emit = defineEmits(['close', 'scheduled'])
const dialog = ref(null)
const dateInput = ref(null)
const choosingTime = ref(false)
const busy = ref(false)
const error = ref('')
const titleId = useId()

const minute = 60_000
const firstFutureMinute = () => (Math.floor(Date.now() / minute) + 1) * minute
const suggested = new Date(props.task.nextCheckAt).getTime() + 180 * minute
const savedTime = props.task.scheduleMode === 'time' ? new Date(props.task.scheduledAt).getTime() : NaN
const preferred = savedTime > Date.now() ? savedTime : suggested
const initial = new Date(Math.max(firstFutureMinute(), Math.floor(preferred / minute) * minute))
const pad = value => String(value).padStart(2, '0')
const dateKey = value => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
const day = ref(dateKey(initial))
const hour = ref(initial.getHours())
const minutes = ref(initial.getMinutes())
const earliestDay = dateKey(new Date())
const selectedTime = computed(() => new Date(`${day.value}T${pad(hour.value)}:${pad(minutes.value)}:00`))

onMounted(() => dialog.value.showModal())

async function showTime() {
  error.value = ''
  choosingTime.value = true
  await nextTick()
  dateInput.value.focus()
}

async function schedule(mode) {
  if (busy.value) return
  error.value = ''
  let body = { mode }
  if (mode === 'time') {
    const time = selectedTime.value
    if (!(time.getTime() > Date.now()) || time.getHours() !== hour.value || time.getMinutes() !== minutes.value) {
      error.value = '请选择一个有效且晚于现在的时间。'
      return
    }
    body = { mode, scheduledAt: time.toISOString() }
  }

  busy.value = true
  try {
    const result = await http.post(`/practice/followups/${props.task.id}/schedule`, { body })
    emit('scheduled', result)
    dialog.value?.close()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <dialog ref="dialog" class="schedule-dialog" :aria-labelledby="titleId"
    @close="emit('close')" @cancel="busy && $event.preventDefault()">
    <header>
      <h3 :id="titleId">提前练习</h3>
      <p>{{ task.word }}<span v-if="task.sense"> · {{ task.sense }}</span></p>
    </header>

    <div v-if="!choosingTime" class="schedule-options">
      <button type="button" class="btn btn-primary" :disabled="busy || !task.wordId" @click="schedule('next')">
        安排在下一轮单词学习
      </button>
      <button type="button" class="btn btn-ghost" :disabled="busy" @click="showTime">自选时间</button>
      <p v-if="!task.wordId" class="muted">这个词尚未收录到词库，可以自选时间做短句练习。</p>
    </div>
    <form v-else class="time-form" @submit.prevent="schedule('time')">
      <label class="date-field">练习日期
        <input ref="dateInput" v-model="day" type="date" :min="earliestDay" max="9999-12-31" required>
      </label>
      <div class="time-wheels" aria-label="练习时间">
        <TimeWheel v-model="hour" :count="24" label="小时" />
        <TimeWheel v-model="minutes" :count="60" label="分钟" />
      </div>
      <p class="muted time-hint">{{ task.wordId ? '到时间后，新开的单词学习组会优先带上这个词。' : '到时间后，可在这里完成短句练习。' }}</p>
      <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '正在保存…' : '确认安排' }}</button>
    </form>

    <p v-if="error" class="schedule-error" role="alert">{{ error }}</p>
    <button class="btn btn-quiet close-button" type="button" :disabled="busy" @click="dialog.close()">取消</button>
  </dialog>
</template>

<style scoped>
.schedule-dialog {
  width: min(380px, calc(100% - 32px));
  max-height: calc(100dvh - 32px);
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--ink);
  box-shadow: var(--shadow);
}
.schedule-dialog::backdrop { background: rgba(4, 10, 18, .7); }
header { margin-bottom: 20px; }
h3 { margin: 0; font-size: 20px; }
header p { margin: 4px 0 0; color: var(--accent-deep); }
.schedule-options, .time-form { display: grid; gap: 12px; }
.schedule-options p, .time-hint { margin: 0; font-size: 12px; }
.date-field { display: grid; gap: 6px; font-size: 13px; color: var(--ink-soft); }
.date-field input { width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
.time-wheels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.schedule-error { color: var(--bad); margin-bottom: 0; }
.close-button { display: flex; width: 100%; margin-top: 10px; }
</style>
