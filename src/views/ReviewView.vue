<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import { useAiStore } from '../stores/ai'

const app = useAppStore()
const ai = useAiStore()
const router = useRouter()

/** 'wrong' | 'articles' */
const tab = ref('wrong')
const selected = ref([])
const starting = ref(false)
const message = ref('')

const review = computed(() => app.todayReview)
const wrongWords = computed(() => review.value?.wrongWords || [])
const articles = computed(() => review.value?.articles || [])
const allSelected = computed(
  () => wrongWords.value.length > 0 && selected.value.length === wrongWords.value.length
)

onMounted(async () => {
  try {
    await app.loadTodayReview()
    // 默认全选，用户如果想少练几个再取消
    selected.value = wrongWords.value.map((item) => item.wordId)
  } catch {
    // 错误信息已在 store 里
  }
})

function toggle(wordId) {
  selected.value = selected.value.includes(wordId)
    ? selected.value.filter((id) => id !== wordId)
    : [...selected.value, wordId]
}

function toggleAll() {
  selected.value = allSelected.value ? [] : wrongWords.value.map((item) => item.wordId)
}

/** 用选中的错词开一轮重练 */
async function practiceWrongWords() {
  if (!selected.value.length || starting.value) return
  starting.value = true
  message.value = ''
  try {
    await app.startReviewSession(selected.value)
    router.push('/study')
  } catch (error) {
    message.value = error.message
  } finally {
    starting.value = false
  }
}

function openArticle(id) {
  router.push({ name: 'article', query: { id: String(id) } })
}

function generateArticleForToday() {
  const ids = wrongWords.value.map((item) => item.wordId)
  router.push({ name: 'article', query: ids.length ? { words: ids.join(',') } : {} })
}

function errorTagClass() {
  return 'err-tag'
}
</script>

<template>
  <div class="review-page">
    <h1 class="section-title">今日回顾</h1>
    <p class="section-sub">
      <template v-if="review">
        {{ review.date }} · 今天答了 {{ review.answered }} 题，错 {{ review.wrongCount }} 题
      </template>
      <template v-else>正在加载…</template>
    </p>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'wrong' }" @click="tab = 'wrong'">
        今日错词
        <span v-if="wrongWords.length" class="tab-count">{{ wrongWords.length }}</span>
      </button>
      <button class="tab" :class="{ active: tab === 'articles' }" @click="tab = 'articles'">
        短文回顾
        <span v-if="articles.length" class="tab-count">{{ articles.length }}</span>
      </button>
    </div>

    <!-- 今日错词 -->
    <template v-if="tab === 'wrong'">
      <div v-if="app.loading.review && !review" class="card"><p class="muted">正在加载…</p></div>

      <div v-else-if="!wrongWords.length" class="card empty-card">
        <p class="empty-title">今天还没有错词 🎉</p>
        <p class="empty-sub">答错的单词会自动出现在这里，方便你集中回顾。</p>
        <button class="btn btn-primary" @click="router.push('/study')">去背单词</button>
      </div>

      <template v-else>
        <div class="card actions-card">
          <div class="actions-row">
            <label class="check-all">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" />
              全选（{{ selected.length }} / {{ wrongWords.length }}）
            </label>
            <button
              class="btn btn-primary"
              :disabled="!selected.length || starting"
              @click="practiceWrongWords"
            >
              {{ starting ? '准备中…' : `再练一遍（${selected.length}）` }}
            </button>
          </div>
          <p class="actions-hint">
            重练只做选中的词，不占用今日新词额度；结果照样会更新复习计划。
          </p>
          <p v-if="message" class="msg error">{{ message }}</p>
        </div>

        <div class="card list-card">
          <div
            v-for="item in wrongWords"
            :key="item.wordId"
            class="wrong-item"
            :class="{ picked: selected.includes(item.wordId) }"
            @click="toggle(item.wordId)"
          >
            <input
              type="checkbox"
              class="item-check"
              :checked="selected.includes(item.wordId)"
              @click.stop="toggle(item.wordId)"
            />

            <div class="item-body">
              <div class="item-head">
                <span class="item-word">{{ item.spelling }}</span>
                <span v-if="item.phonetic" class="item-phonetic">{{ item.phonetic }}</span>
                <span v-if="item.pos" class="item-pos">{{ item.pos }}</span>
                <span class="item-wrong">错 {{ item.wrongTimes }} 次</span>
              </div>

              <!-- 完整释义，第一条加粗（词表排序里的主释义） -->
              <p class="item-def">
                <b>{{ item.definitions[0] }}</b>
                <template v-if="item.definitions.length > 1">
                  ；{{ item.definitions.slice(1).join('；') }}
                </template>
              </p>

              <p v-if="item.example" class="item-example">{{ item.example }}</p>

              <div v-if="item.errorTypes.length" class="item-tags">
                <span v-for="type in item.errorTypes" :key="type" :class="errorTagClass()">
                  {{ type }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="card actions-card">
          <button class="btn btn-ghost" @click="generateArticleForToday">
            📖 用这些错词生成巩固短文
          </button>
        </div>
      </template>
    </template>

    <!-- 短文回顾 -->
    <template v-else>
      <div v-if="app.loading.review && !review" class="card"><p class="muted">正在加载…</p></div>

      <div v-else-if="!articles.length" class="card empty-card">
        <p class="empty-title">今天还没有生成短文</p>
        <p class="empty-sub">背完一组词后可以生成一篇含目标词的短文，方便重复阅读。</p>
        <button class="btn btn-primary" @click="router.push('/article')">去生成一篇</button>
      </div>

      <div v-else class="card list-card">
        <div
          v-for="item in articles"
          :key="item.id"
          class="article-item"
          @click="openArticle(item.id)"
        >
          <div class="article-main">
            <span class="article-title">{{ item.title || '（无标题）' }}</span>
            <span class="article-meta">
              {{ item.topic || '未指定话题' }} · 难度 {{ item.difficulty }}
              <template v-if="item.targetWords.length">· {{ item.targetWords.length }} 个目标词</template>
            </span>
          </div>
          <span class="article-arrow">→</span>
        </div>
      </div>

      <p v-if="articles.length" class="foot-hint">
        点开任何一篇都能重读原文，并再出一套理解题。
      </p>
    </template>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  background: var(--bg);
  border-radius: 999px;
  padding: 4px;
  margin-bottom: 16px;
}

.tab {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 999px;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.tab.active {
  background: var(--bg-card);
  color: var(--accent-deep);
  box-shadow: 0 1px 3px rgba(60, 45, 30, 0.08);
}

.tab-count {
  font-size: 12px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  border-radius: 999px;
  padding: 0 8px;
}

.empty-card {
  text-align: center;
  padding: 40px 24px;
}

.empty-title {
  font-family: var(--serif);
  font-size: 20px;
  margin: 0 0 6px;
}

.empty-sub {
  color: var(--ink-soft);
  font-size: 14px;
  margin: 0 0 22px;
}

.actions-card {
  padding: 18px 20px;
  margin-bottom: 16px;
}

.actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.check-all {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--ink-soft);
  cursor: pointer;
}

.actions-hint {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.list-card {
  padding: 8px 20px;
  margin-bottom: 16px;
}

/* 错词条目 */
.wrong-item {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  cursor: pointer;
  border-bottom: 1px dashed var(--line);
}

.wrong-item:last-child {
  border-bottom: none;
}

.wrong-item.picked {
  background: linear-gradient(90deg, rgba(243, 226, 216, 0.5), transparent);
}

.item-check {
  flex: none;
  margin-top: 4px;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

.item-body {
  flex: 1;
  min-width: 0;
}

.item-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.item-word {
  font-family: var(--serif);
  font-size: 19px;
  font-weight: 600;
}

.item-phonetic,
.item-pos {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.item-wrong {
  margin-left: auto;
  font-size: 12px;
  color: var(--bad);
  background: var(--bad-soft);
  border-radius: 999px;
  padding: 1px 10px;
}

.item-def {
  margin: 6px 0 0;
  font-size: 14.5px;
  line-height: 1.6;
}

.item-def b {
  color: var(--accent-deep);
}

.item-example {
  margin: 6px 0 0;
  font-family: var(--serif);
  font-size: 13.5px;
  color: var(--ink-soft);
}

.item-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.err-tag {
  font-size: 11.5px;
  color: #6a6485;
  background: #e8e6f0;
  border-radius: 999px;
  padding: 1px 10px;
}

/* 短文列表 */
.article-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
  cursor: pointer;
  border-bottom: 1px dashed var(--line);
}

.article-item:last-child {
  border-bottom: none;
}

.article-item:hover .article-arrow {
  color: var(--accent);
  transform: translateX(2px);
}

.article-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.article-title {
  font-family: var(--serif);
  font-size: 16px;
  font-weight: 600;
}

.article-meta {
  font-size: 12.5px;
  color: var(--ink-soft);
}

.article-arrow {
  color: var(--ink-soft);
  transition: color 0.15s, transform 0.15s;
}

.foot-hint {
  text-align: center;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.msg.error {
  margin: 12px 0 0;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--bad);
  background: var(--bad-soft);
  border-radius: var(--radius-sm);
}
</style>
