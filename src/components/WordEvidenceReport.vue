<script setup>
defineProps({ history: Object, reliability: Object })
const resultLabel = { correct: '答出', independent: '独立答出', incorrect: '答错', unknown: '想不起来', hinted: '提示后答出',
  'needs-practice': '未答出', skipped: '跳过', assisted: '借助帮助完成', weak: '仍待练习' }
const date = value => new Date(value).toLocaleString('zh-CN')
</script>
<template>
  <section v-if="reliability" class="evidence-section" aria-label="学习改善依据">
    <h3>成绩变化能说明什么</h3>
    <p>{{ reliability.text }}</p>
    <p class="muted">本次可核对的计分题 {{ reliability.identifiable }} 道，其中 {{ reliability.repeated }} 道在最近二十次可比较测试中出现过（答出 {{ reliability.repeatedCorrect }} 道）；其余 {{ reliability.fresh }} 道答出 {{ reliability.freshCorrect }} 道。</p>
    <details><summary>查看试卷与证据限制</summary>
      <p v-for="form in reliability.forms" :key="form.form">{{ form.form }} 卷：{{ form.tests }} 次，累计 {{ form.correct }}/{{ form.tested }}；{{ form.percent === null ? '暂无成绩' : `${form.percent}%` }}</p>
      <p v-for="warning in reliability.warnings" :key="warning" class="muted">{{ warning }}</p>
    </details>
  </section>
  <section v-if="history?.words.length" class="evidence-section" aria-label="同词跨练习记录">
    <h3>这些词在哪一步还需要练</h3>
    <p class="muted">{{ history.scope }}</p>
    <details v-for="word in history.words" :key="word.wordId" class="evidence-word">
      <summary><strong>{{ word.spelling }}</strong> · {{ word.senses[0]?.label }}</summary>
      <section v-for="sense in word.senses" :key="sense.sense">
        <h4>{{ sense.sense }}</h4><p>{{ sense.label }}</p>
        <ul><li v-for="channel in sense.channels" :key="channel.source">{{ channel.label }}：{{ channel.correct }}/{{ channel.total }} 次答出<span v-if="channel.hinted">，{{ channel.hinted }} 次提示后答出</span>；最近一次{{ resultLabel[channel.latest] || '已记录' }}</li></ul>
        <details><summary>最近的学习过程</summary><ol><li v-for="(event,i) in sense.timeline" :key="i">{{ date(event.at) }} · {{ event.label }} · {{ resultLabel[event.result] || '已记录' }}</li></ol></details>
      </section>
      <div v-if="word.unscoped.length"><h4>该词另有记录，义项尚未确认</h4>
        <p v-for="channel in word.unscoped" :key="channel.source">{{ channel.label }}：{{ channel.correct }}/{{ channel.total }} 次答出。单独保留，不算到上面的具体义项。</p>
      </div>
      <p v-if="word.otherSenses.length" class="muted">其他义项另记：{{ word.otherSenses.join('、') }}。</p>
      <router-link :to="{ path: '/notebooks/collocations', query: { wordId: word.wordId } }">练这个词的搭配</router-link>
    </details>
  </section>
</template>
<style scoped>.evidence-section{margin-top:24px}.evidence-word{border-top:1px solid var(--line);padding:12px 0}summary{cursor:pointer}h4{margin-bottom:6px}.muted{color:var(--ink-soft);font-size:13px}li,p{overflow-wrap:anywhere}</style>
