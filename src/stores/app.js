import { defineStore } from 'pinia'
import { WORDS } from '../data/words'
import { grade, reviewItem } from '../utils/srs'
import { todayKey } from '../utils/dates'
import { shuffle } from '../utils/shuffle'

export const STORAGE_KEY = 'beileme:v1'

const DAY_MS = 24 * 60 * 60 * 1000

// 词频优先级：高频词优先进入新词学习，组内乱序，避免按字母顺序背词
const FREQ_ORDER = { high: 0, med: 1, low: 2 }

function sortNewWords(words) {
  const buckets = { high: [], med: [], low: [] }
  for (const w of words) {
    const key = FREQ_ORDER[w.freq] != null ? w.freq : 'med'
    buckets[key].push(w)
  }
  return ['high', 'med', 'low'].flatMap((k) => shuffle(buckets[k]))
}

function defaultState() {
  return {
    profile: {
      goal: '',
      dailyTime: '',
      level: '',
      newPerDay: 15,
      onboarded: false,
      onboardedAt: null,
    },
    progress: {},
    stats: { daily: {} },
  }
}

export const useAppStore = defineStore('app', {
  state: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        const def = defaultState()
        return {
          ...def,
          ...saved,
          profile: { ...def.profile, ...(saved.profile || {}) },
          stats: { ...def.stats, ...(saved.stats || {}) },
        }
      }
    } catch (e) {
      /* 忽略损坏数据，回退到默认状态 */
    }
    return defaultState()
  },

  getters: {
    isOnboarded: (s) => s.profile.onboarded === true,

    allWords: () => WORDS,

    learnedWords: (s) => WORDS.filter((w) => s.progress[w.id]?.learned),

    totalLearned: (s) => WORDS.filter((w) => s.progress[w.id]?.learned).length,

    totalSeen: (s) => Object.values(s.progress).reduce((n, p) => n + (p.timesSeen || 0), 0),

    totalCorrect: (s) => Object.values(s.progress).reduce((n, p) => n + (p.timesCorrect || 0), 0),

    totalWrong: (s) => Object.values(s.progress).reduce((n, p) => n + (p.timesWrong || 0), 0),

    accuracy() {
      const t = this.totalSeen
      return t ? Math.round((this.totalCorrect / t) * 100) : 0
    },

    todayStats: (s) => s.stats.daily[todayKey()] || { new: 0, review: 0, correct: 0, wrong: 0 },

    newPerDay: (s) => s.profile.newPerDay || 15,

    dueWords: (s) => {
      const now = Date.now()
      return WORDS.filter((w) => {
        const p = s.progress[w.id]
        return p && p.learned && p.nextReviewAt <= now
      })
    },

    dueCount() {
      return this.dueWords.length
    },

    streak() {
      const daily = this.stats.daily
      const keys = Object.keys(daily)
      if (!keys.length) return 0
      let count = 0
      let d = new Date()
      // 今天还没学则从昨天开始算
      if (!daily[todayKey(d)]) d = new Date(d.getTime() - DAY_MS)
      while (daily[todayKey(d)]) {
        count += 1
        d = new Date(d.getTime() - DAY_MS)
      }
      return count
    },

    last7Days() {
      const daily = this.stats.daily
      const out = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * DAY_MS)
        const key = todayKey(d)
        const rec = daily[key]
        const correct = rec?.correct || 0
        const wrong = rec?.wrong || 0
        const total = correct + wrong
        out.push({
          key,
          label: `${d.getMonth() + 1}/${d.getDate()}`,
          correct,
          wrong,
          total,
          accuracy: total ? Math.round((correct / total) * 100) : null,
        })
      }
      return out
    },

    strengthDistribution() {
      const buckets = { 新学: 0, 巩固中: 0, 较熟: 0, 已掌握: 0 }
      for (const w of WORDS) {
        const p = this.progress[w.id]
        if (!p || !p.learned) continue
        const r = p.repetitions || 0
        if (r === 0) buckets['新学'] += 1
        else if (r === 1) buckets['巩固中'] += 1
        else if (r <= 3) buckets['较熟'] += 1
        else buckets['已掌握'] += 1
      }
      return buckets
    },
  },

  actions: {
    completeOnboarding({ goal, dailyTime, level }) {
      const map = { '5-10': 10, '15-20': 20, '30+': 30 }
      this.profile = {
        ...this.profile,
        goal,
        dailyTime,
        level,
        newPerDay: map[dailyTime] || 15,
        onboarded: true,
        onboardedAt: new Date().toISOString(),
      }
    },

    // 首次进入首页时固化「今日待复习」目标数，避免背完后数字跳变
    ensureTodayPlan() {
      const key = todayKey()
      if (!this.stats.daily[key]) {
        this.stats.daily[key] = { new: 0, review: 0, correct: 0, wrong: 0 }
      }
      const day = this.stats.daily[key]
      if (day.reviewTarget == null) {
        day.reviewTarget = this.dueCount
      }
    },

    buildSessionQueue() {
      const day = this.todayStats
      const now = Date.now()
      const due = this.dueWords.map((w) => ({ word: w, kind: 'review' }))
      due.sort((a, b) => this.progress[a.word.id].nextReviewAt - this.progress[b.word.id].nextReviewAt)

      const quota = Math.max(0, this.newPerDay - day.new)
      const fresh = sortNewWords(WORDS.filter((w) => !this.progress[w.id]?.learned))
        .slice(0, quota)
        .map((w) => ({ word: w, kind: 'new' }))

      return [...due, ...fresh]
    },

    // 「再学一组」：不受每日计划限制，提前复习 + 补充新词
    buildExtraSession() {
      const fresh = sortNewWords(WORDS.filter((w) => !this.progress[w.id]?.learned))
        .slice(0, 10)
        .map((w) => ({ word: w, kind: 'new' }))
      const reviewSoon = WORDS.filter((w) => this.progress[w.id]?.learned)
        .sort((a, b) => this.progress[a.id].nextReviewAt - this.progress[b.id].nextReviewAt)
        .slice(0, 10)
        .map((w) => ({ word: w, kind: 'review' }))
      return shuffle([...fresh, ...reviewSoon]).slice(0, 10)
    },

    submitAnswer(wordId, isCorrect, hesitationMs) {
      const now = Date.now()
      const key = todayKey()
      if (!this.stats.daily[key]) {
        this.stats.daily[key] = { new: 0, review: 0, correct: 0, wrong: 0 }
      }
      const day = this.stats.daily[key]

      const existing = this.progress[wordId]
      const isNew = !existing || !existing.learned
      const q = grade(hesitationMs, isCorrect)

      const base =
        existing && existing.learned
          ? existing
          : {
              ef: 2.5,
              intervalDays: 0,
              repetitions: 0,
              nextReviewAt: 0,
              learned: true,
              timesSeen: 0,
              timesCorrect: 0,
              timesWrong: 0,
              firstLearnedAt: now,
              history: [],
            }

      const upd = reviewItem(base, q, now)

      this.progress[wordId] = {
        ...base,
        ...upd,
        learned: true,
        timesSeen: (base.timesSeen || 0) + 1,
        timesCorrect: (base.timesCorrect || 0) + (isCorrect ? 1 : 0),
        timesWrong: (base.timesWrong || 0) + (isCorrect ? 0 : 1),
        lastResult: isCorrect,
        lastHesitationMs: hesitationMs,
        history: [
          ...(base.history || []),
          { ts: now, result: isCorrect, hesitationMs, quality: q },
        ],
      }

      if (isNew) day.new += 1
      else day.review += 1
      if (isCorrect) day.correct += 1
      else day.wrong += 1
    },

    resetAll() {
      localStorage.removeItem(STORAGE_KEY)
      this.$reset()
    },
  },
})
