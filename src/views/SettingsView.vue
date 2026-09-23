<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAiStore } from '../stores/ai'

const ai = useAiStore()

const form = ref({ provider: 'deepseek', apiKey: '', model: '', baseUrl: '', label: '' })
const formError = ref('')
const formOk = ref('')
/** 保存通过但需要用户知晓的提醒（例如推理型模型会额外消耗额度） */
const formWarnings = ref([])
const saving = ref(false)

/** token 额度相关的可编辑项 */
const limitFields = [
  { key: 'articleTokens', label: '巩固短文' },
  { key: 'quizTokens', label: '阅读理解题' },
  { key: 'errorCardTokens', label: '错词卡片（一批）' },
  { key: 'summaryTokens', label: '薄弱点小结' },
  { key: 'maxInputTokens', label: '输入上限', step: 100 },
  { key: 'reasoningMultiplier', label: '推理模型倍数', step: 0.5 },
]

const limitDraft = ref({})
const limitMessage = ref('')

/** 当前额度与哪个档位一致（用来高亮按钮，不额外存状态） */
const activePresetGuess = computed(() => {
  if (!ai.limitOptions || !ai.limits) return ai.activePreset
  for (const preset of ai.limitOptions.presets) {
    const same = Object.entries(preset.values).every(
      ([key, value]) => Number(ai.limits[key]) === Number(value)
    )
    if (same) return preset.id
  }
  return ai.activePreset
})

function syncLimitDraft() {
  if (!ai.limits) return
  limitDraft.value = Object.fromEntries(
    limitFields.map((field) => [field.key, ai.limits[field.key]])
  )
}

async function applyPreset(presetId) {
  limitMessage.value = ''
  await ai.applyLimitPreset(presetId)
  syncLimitDraft()
  limitMessage.value = '已套用档位'
}

async function saveLimitDraft() {
  limitMessage.value = ''
  try {
    await ai.saveLimits(limitDraft.value)
    syncLimitDraft()
    limitMessage.value = '已保存'
  } catch (error) {
    limitMessage.value = ''
    formError.value = error.message
  }
}

async function resetLimitValues() {
  limitMessage.value = ''
  await ai.resetLimits()
  syncLimitDraft()
  limitMessage.value = '已恢复为系统推荐值'
}

/** 切换「允许模型先内部思考」。默认关闭——这是实测最有效的止损开关。 */
async function toggleThinking() {
  limitMessage.value = ''
  try {
    await ai.setAllowThinking(!ai.limits?.allowThinking)
    limitMessage.value = ai.limits?.allowThinking
      ? '已允许模型内部思考：会更慢更贵，但输出可能更细致'
      : '已让模型跳过内部思考：更快更省，正文更稳定'
  } catch (error) {
    formError.value = error.message
  }
}

onMounted(() => {
  ai.loadStatus().catch(() => {})
  ai.loadLimits().then(syncLimitDraft).catch(() => {})
})

const selectedPreset = computed(() =>
  ai.providers.find((provider) => provider.id === form.value.provider)
)

/** 切换服务商时带出预设地址与模型，用户仍可改 */
function onProviderChange() {
  const preset = selectedPreset.value
  if (!preset) return
  form.value.baseUrl = preset.baseUrl || ''
  form.value.model = preset.model || ''
  // 换服务商后旧的模型列表不再适用
  ai.availableModels = []
  ai.modelsError = ''
  formError.value = ''
  formOk.value = ''
}

/** 拉取账号可用模型（只调 /models，不消耗 token） */
async function fetchModels() {
  formError.value = ''
  formOk.value = ''

  if (form.value.apiKey.trim().length < 8) {
    formError.value = '请先填写 API Key，再获取可用模型'
    return
  }

  const result = await ai.loadModels({
    provider: form.value.provider,
    apiKey: form.value.apiKey.trim(),
    baseUrl: form.value.baseUrl.trim(),
    model: form.value.model.trim(),
  })

  if (!result.ok) {
    formError.value = result.message || '获取模型列表失败'
    return
  }

  // 自动选中一个可用的模型，省掉手打这一步
  if (result.suggested) {
    form.value.model = result.suggested
  }
  formOk.value = result.corrected
    ? `已自动把模型名纠正为「${result.suggested}」（模型 id 区分大小写）`
    : `获取到 ${result.models.length} 个可用模型`
}

/** 用户手打模型名时，若只是大小写不一致就自动纠正成列表里的规范写法 */
function canonicalizeModel() {
  const typed = form.value.model.trim()
  if (!typed || !ai.availableModels.length) return

  const exact = ai.availableModels.find((id) => id === typed)
  if (exact) return

  const matched = ai.availableModels.filter((id) => id.toLowerCase() === typed.toLowerCase())
  if (matched.length === 1) {
    form.value.model = matched[0]
    formOk.value = `已把「${typed}」纠正为「${matched[0]}」`
  }
}

// 初始也带一次预设
onProviderChange()

function maskKey(key) {
  return key || ''
}

async function verifyOnly() {
  formError.value = ''
  formOk.value = ''

  if (form.value.apiKey.trim().length < 8) {
    formError.value = '请先填写 API Key'
    return
  }

  try {
    const result = await ai.verifyKey({
      provider: form.value.provider,
      apiKey: form.value.apiKey.trim(),
      baseUrl: form.value.baseUrl.trim(),
      model: form.value.model.trim(),
    })
    if (result.verified) {
      formOk.value = `校验通过（${result.test.latencyMs}ms，模型 ${result.test.model}）`
    } else {
      formError.value = result.test.message
    }
  } catch (error) {
    formError.value = error.message
  }
}

async function saveKey() {
  formError.value = ''
  formOk.value = ''

  if (form.value.apiKey.trim().length < 8) {
    formError.value = '请填写完整的 API Key'
    return
  }
  if (form.value.provider === 'custom' && !form.value.baseUrl.trim()) {
    formError.value = '自定义服务商需要填写接口地址'
    return
  }

  saving.value = true
  try {
    const result = await ai.saveKey({
      provider: form.value.provider,
      apiKey: form.value.apiKey.trim(),
      baseUrl: form.value.baseUrl.trim(),
      model: form.value.model.trim(),
      label: form.value.label.trim(),
    })
    formOk.value = result.message || '保存成功'
    // 通过但有需要注意的地方（例如推理型模型会占用输出额度）也要讲清楚
    formWarnings.value = result.warnings || []
    form.value.apiKey = ''
  } catch (error) {
    formError.value = error.message
    formWarnings.value = []
  } finally {
    saving.value = false
  }
}

async function removeKey(id) {
  if (!window.confirm('确定删除这把 Key 吗？删除后会回落到官方额度或本地内容。')) return
  await ai.deleteKey(id)
  formOk.value = '已删除'
}

async function testKey() {
  formError.value = ''
  formOk.value = ''
  try {
    const result = await ai.testKey()
    formOk.value = result.ok
      ? `连通正常（${result.latencyMs}ms，模型 ${result.model}）`
      : `测试失败：${result.message}`
    if (!result.ok) formError.value = result.message
  } catch (error) {
    formError.value = error.message
  }
}

function formatTokens(value) {
  const num = Number(value || 0)
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return String(num)
}

function formatCost(usd) {
  const cny = Number(usd || 0) * 7.2
  if (cny <= 0) return '¥0'
  if (cny < 0.01) return `¥${cny.toFixed(4)}`
  return `¥${cny.toFixed(3)}`
}

const typeLabels = {
  article: '巩固短文',
  quiz: '阅读理解题',
  error_card: '错词卡片',
  weak_summary: '薄弱点小结',
}
</script>

<template>
  <div class="settings">
    <h1 class="section-title">AI 设置</h1>
    <p class="section-sub">不配置也能用：错因分析与易混词对比完全免费</p>

    <div v-if="!ai.status" class="card">
      <p class="muted">正在加载…</p>
    </div>

    <template v-else>
      <!-- 当前状态 -->
      <div class="card block mode-card" :class="ai.mode">
        <div class="mode-head">
          <span class="mode-badge">{{ ai.mode === 'user' ? '使用我的 Key' : ai.mode === 'server' ? '使用官方额度' : '未配置 AI' }}</span>
          <span class="mode-detail">
            {{ ai.mode === 'none' ? '生成内容时会自动返回本地复习清单' : `${ai.activeLabel} · ${ai.status.activeProvider?.model || ''}` }}
          </span>
        </div>

        <div class="zero-cost">
          <p class="zero-title">以下能力永远不花一分钱</p>
          <ul class="zero-list">
            <li v-for="item in ai.zeroCostFeatures" :key="item">{{ item }}</li>
          </ul>
        </div>

        <div v-if="ai.key" class="mode-actions">
          <button class="btn btn-ghost" :disabled="ai.loading.test" @click="testKey">
            {{ ai.loading.test ? '测试中…' : '测试当前 Key' }}
          </button>
        </div>
      </div>

      <!-- 今日用量 -->
      <div class="card block">
        <h2 class="block-title">用量与成本</h2>
        <p class="block-sub">
          今日已调用 {{ ai.monthTotals.used }} 次 · 缓存命中 {{ ai.monthTotals.cached }} 次
        </p>

        <div class="usage-grid">
          <div v-for="(item, type) in ai.todayUsage" :key="type" class="usage-item">
            <span class="usage-name">{{ typeLabels[type] || type }}</span>
            <span class="usage-count mono-num">
              {{ item.used }}<template v-if="item.limit"> / {{ item.limit }}</template>
            </span>
            <span v-if="item.cached" class="usage-cached">缓存 {{ item.cached }}</span>
          </div>
        </div>

        <div class="cost-row">
          <div class="cost-item">
            <span class="cost-num">{{ formatTokens(ai.monthTotals.promptTokens) }}</span>
            <span class="cost-label">近 30 天输入 token</span>
          </div>
          <div class="cost-item">
            <span class="cost-num">{{ formatTokens(ai.monthTotals.completionTokens) }}</span>
            <span class="cost-label">近 30 天输出 token</span>
          </div>
          <div class="cost-item">
            <span class="cost-num">{{ formatCost(ai.monthTotals.costUsd) }}</span>
            <span class="cost-label">估算成本</span>
          </div>
        </div>

        <p class="pricing-note">
          单价参考：输入 ¥{{ (ai.status.pricing.pricePerMillion.input * 7.2).toFixed(2) }} / 百万 token，
          输出 ¥{{ (ai.status.pricing.pricePerMillion.output * 7.2).toFixed(2) }} / 百万 token。
          仅用于估算，实际以服务商账单为准（可在 server/.env 调整 AI_PRICE_* 参数）。
        </p>
      </div>

      <!-- token 额度：可套用档位，也可逐项调整 -->
      <div v-if="ai.limitOptions" class="card block">
        <h2 class="block-title">单次生成的 token 额度</h2>
        <p class="block-sub">
          这是「输出上限」而不是「预留额度」——模型写完就停，用不到的部分不收费。
        </p>

        <div class="measure-note">
          <p class="measure-title">真实调用实测（已关掉内部思考）</p>
          <div class="measure-grid">
            <span>短文 230 词 <strong>{{ ai.limitOptions.measured.articleTokens }}</strong></span>
            <span>理解题 3 题 <strong>{{ ai.limitOptions.measured.quizTokens }}</strong></span>
            <span>错词卡片 6 张 <strong>{{ ai.limitOptions.measured.errorCardTokens }}</strong></span>
            <span>一周小结 <strong>{{ ai.limitOptions.measured.summaryTokens }}</strong></span>
          </div>
          <p class="measure-foot">{{ ai.limitOptions.measured.note }}</p>
        </div>

        <div class="preset-row">
          <button
            v-for="preset in ai.limitOptions.presets"
            :key="preset.id"
            class="preset-btn"
            :class="{ active: activePresetGuess === preset.id }"
            :disabled="ai.loading.limits"
            @click="applyPreset(preset.id)"
          >
            {{ preset.label }}
          </button>
          <button class="preset-btn ghost" :disabled="ai.loading.limits" @click="resetLimitValues">
            恢复推荐值
          </button>
        </div>
        <p class="preset-desc">
          {{ ai.limitOptions.presets.find((p) => p.id === activePresetGuess)?.description || '当前为自定义值' }}
        </p>

        <!--
          是否允许模型先内部思考。
          这不是个抽象的开关：实测数字摆在下面，用户自己判断值不值得开。
        -->
        <div v-if="ai.limitOptions.thinking" class="thinking-box">
          <div class="thinking-head">
            <div class="thinking-text">
              <p class="thinking-title">
                {{ ai.limitOptions.thinking.label }}
                <span class="thinking-default">默认关闭</span>
              </p>
              <p class="thinking-sub">
                关掉后模型直接写正文：更快、更省，也不会出现「额度全花在思考上、正文一个字都没有」。
              </p>
            </div>
            <button
              class="switch"
              :class="{ on: ai.limits?.allowThinking }"
              :disabled="ai.loading.limits"
              :aria-pressed="Boolean(ai.limits?.allowThinking)"
              @click="toggleThinking"
            >
              <span class="switch-track"><span class="switch-knob"></span></span>
              <span class="switch-text">{{ ai.limits?.allowThinking ? '已开启' : '已关闭' }}</span>
            </button>
          </div>

          <div class="thinking-evidence">
            <div class="ev-row">
              <span class="ev-tag bad">允许思考</span>
              <span>
                3 次里 3 次把 {{ ai.limitOptions.thinking.measured.withThinking.outputTokens }} 额度
                全用在思考上，写出正文 0 次，耗时约 12.2 秒
              </span>
            </div>
            <div class="ev-row">
              <span class="ev-tag ok">跳过思考</span>
              <span>
                3 次里 0 次思考，写出正文 3 次，平均只用
                {{ ai.limitOptions.thinking.measured.withoutThinking.outputTokens }} 输出 token，
                耗时约 3.2 秒
              </span>
            </div>
          </div>
          <p class="measure-foot">{{ ai.limitOptions.thinking.note }}</p>
          <p v-if="ai.limitOptions.thinking.measured" class="thinking-model-hint">
            如果服务商不认这个参数，系统会依次改用 <code>reasoning_effort</code>、再退回原样请求，不会因此失败。
          </p>
        </div>

        <div class="limit-grid">
          <label v-for="field in limitFields" :key="field.key" class="field">
            <span class="field-label">
              {{ field.label }}
              <span class="field-range">推荐 {{ ai.limitOptions.recommended[field.key] }}</span>
            </span>
            <input
              v-model.number="limitDraft[field.key]"
              type="number"
              class="input"
              :min="ai.limitOptions.bounds[field.key][0]"
              :max="ai.limitOptions.bounds[field.key][1]"
              :step="field.step || 50"
            />
          </label>
        </div>

        <p v-if="limitMessage" class="msg ok">{{ limitMessage }}</p>

        <div class="form-actions">
          <button class="btn btn-primary" :disabled="ai.loading.limits" @click="saveLimitDraft">
            保存额度设置
          </button>
        </div>
        <p class="form-hint">
          上面的「推理模型倍数」只在
          <strong>{{ ai.limits?.allowThinking ? '已允许内部思考' : '允许内部思考' }}</strong>
          时才生效：那种情况下模型会先把额度用于思考，因此实际调用时会再乘
          <strong>{{ ai.limits?.reasoningMultiplier || 3 }}×</strong>，避免正文 JSON 被截断。
          默认跳过思考，因此不受这个倍数影响。
        </p>
      </div>

      <!-- 我的 Key -->
      <div class="card block">
        <h2 class="block-title">接入我自己的 API Key</h2>
        <p class="block-sub">
          Key 会加密后保存，只用于你自己的请求；接口从不回传明文，你也可以随时删除。
        </p>

        <div v-if="ai.keys.length" class="key-list">
          <div v-for="key in ai.keys" :key="key.id" class="key-row">
            <div class="key-info">
              <span class="key-label">{{ key.label || key.provider }}</span>
              <span class="key-mask">{{ maskKey(key.maskedKey) }}</span>
              <span class="key-model">{{ key.model }}</span>
            </div>
            <div class="key-actions">
              <span v-if="!key.decryptable" class="key-warn">需重填</span>
              <button class="btn-mini" @click="removeKey(key.id)">删除</button>
            </div>
          </div>
        </div>

        <div class="form">
          <label class="field">
            <span class="field-label">服务商</span>
            <select v-model="form.provider" class="input" @change="onProviderChange">
              <option v-for="provider in ai.providers" :key="provider.id" :value="provider.id">
                {{ provider.label }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">API Key</span>
            <input
              v-model="form.apiKey"
              type="password"
              class="input"
              placeholder="sk-..."
              autocomplete="off"
            />
          </label>

          <div class="field-row">
            <label class="field">
              <span class="field-label">
                模型
                <button
                  v-if="!ai.availableModels.length"
                  class="inline-btn"
                  :disabled="ai.loading.models"
                  @click.prevent="fetchModels"
                >
                  {{ ai.loading.models ? '获取中…' : '获取可用模型' }}
                </button>
                <span v-else class="field-label-ok">已获取 {{ ai.availableModels.length }} 个</span>
              </span>

              <!-- 拿到列表就变成下拉选择，避免手打模型名出错 -->
              <select v-if="ai.availableModels.length" v-model="form.model" class="input">
                <option v-for="id in ai.availableModels" :key="id" :value="id">{{ id }}</option>
              </select>
              <input
                v-else
                v-model="form.model"
                class="input"
                placeholder="如 deepseek-v4-pro"
                @change="canonicalizeModel"
              />
            </label>

            <label class="field">
              <span class="field-label">备注（可选）</span>
              <input v-model="form.label" class="input" placeholder="如 我的 DeepSeek" />
            </label>
          </div>

          <!-- 已获取的模型做成快捷选择，一眼就能换成更便宜的那个 -->
          <div v-if="ai.availableModels.length" class="model-chips">
            <span class="chips-label">点一下切换：</span>
            <button
              v-for="id in ai.availableModels"
              :key="id"
              class="model-chip"
              :class="{ active: form.model === id }"
              @click="form.model = id"
            >
              {{ id }}
            </button>
          </div>

          <label v-if="form.provider === 'custom'" class="field">
            <span class="field-label">接口地址（需兼容 OpenAI 协议）</span>
            <input v-model="form.baseUrl" class="input" placeholder="https://.../v1" />
          </label>

          <p v-if="selectedPreset?.note" class="preset-note">{{ selectedPreset.note }}</p>
          <p v-if="formError" class="msg error">{{ formError }}</p>
          <p v-else-if="formOk" class="msg ok">{{ formOk }}</p>

          <div v-if="formWarnings.length" class="msg warn">
            <p v-for="(warning, i) in formWarnings" :key="i">⚠ {{ warning }}</p>
          </div>

          <!-- 诊断详情：把「哪一步失败、可用模型有哪些」摊开，避免只看到一句校验未通过 -->
          <div v-if="ai.verifyResult && !ai.verifyResult.ok" class="diag">
            <p class="diag-title">诊断过程</p>
            <ul class="diag-steps">
              <li v-for="(step, i) in ai.verifyResult.steps || []" :key="i" :class="{ bad: !step.ok }">
                <span class="diag-mark">{{ step.ok ? '✓' : '✗' }}</span>
                <span class="diag-step">{{ step.step }}</span>
                <span v-if="step.detail" class="diag-detail">{{ step.detail }}</span>
              </li>
            </ul>
            <p v-if="ai.verifyResult.hint" class="diag-hint">💡 {{ ai.verifyResult.hint }}</p>
            <p class="diag-meta">
              实际请求地址：{{ ai.verifyResult.checkedBaseUrl }}　模型：{{ ai.verifyResult.checkedModel }}
            </p>
          </div>

          <div class="form-actions">
            <button class="btn btn-ghost" :disabled="ai.loading.test" @click="verifyOnly">
              {{ ai.loading.test ? '测试中…' : '测试连接（不保存）' }}
            </button>
            <button class="btn btn-primary" :disabled="saving || ai.loading.saveKey" @click="saveKey">
              {{ saving ? '校验中…' : '保存并测试连通性' }}
            </button>
          </div>
          <p class="form-hint">
            校验会先用 <code>GET /models</code> 验证 Key（<strong>这一步不消耗 token</strong>），
            再检查模型名，最后发一次 8 token 的调用。全部通过才会保存。
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.block {
  margin-bottom: 16px;
}

.block-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 4px;
}

.block-sub {
  color: var(--ink-soft);
  font-size: 13px;
  margin: 0 0 18px;
}

/* 当前模式 */
.mode-card {
  border-left: 3px solid var(--line);
}

.mode-card.user {
  border-left-color: var(--ok);
}

.mode-card.server {
  border-left-color: var(--accent);
}

.mode-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.mode-badge {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-deep);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 4px 14px;
}

.mode-detail {
  font-size: 13px;
  color: var(--ink-soft);
}

.zero-cost {
  background: var(--ok-soft);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
}

.zero-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ok);
}

.zero-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--ink);
  line-height: 1.7;
}

.mode-actions {
  margin-top: 16px;
}

/* 用量 */
.usage-grid {
  display: grid;
  gap: 10px;
  margin-bottom: 20px;
}

.usage-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
}

.usage-name {
  flex: 1;
}

.usage-count {
  font-weight: 600;
  color: var(--accent-deep);
}

.usage-cached {
  font-size: 12px;
  color: var(--ok);
}

.cost-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.cost-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 14px 8px;
}

.cost-num {
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 600;
  color: var(--accent-deep);
}

.cost-label {
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 2px;
  text-align: center;
}

.pricing-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-soft);
}

/* Key 列表 */
.key-list {
  display: grid;
  gap: 10px;
  margin-bottom: 20px;
}

.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}

.key-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
  min-width: 0;
}

.key-label {
  font-weight: 600;
}

.key-mask {
  font-family: ui-monospace, monospace;
  color: var(--ink-soft);
}

.key-model {
  font-size: 12px;
  color: var(--ink-soft);
  background: var(--bg-card);
  border-radius: 999px;
  padding: 1px 10px;
}

.key-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.key-warn {
  font-size: 12px;
  color: var(--bad);
}

.btn-mini {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--ink-soft);
}

.btn-mini:hover {
  color: var(--bad);
  border-color: var(--bad-soft);
}

/* 表单 */
.form {
  display: grid;
  gap: 14px;
}

.field {
  display: grid;
  gap: 6px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field-label {
  font-size: 13px;
  color: var(--ink-soft);
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-label-ok {
  font-size: 12px;
  color: var(--ok);
}

.inline-btn {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: var(--accent-deep);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.inline-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chips-label {
  font-size: 12px;
  color: var(--ink-soft);
}

.model-chip {
  border: 1px solid var(--line);
  background: var(--bg);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 12.5px;
  font-family: ui-monospace, monospace;
  color: var(--ink);
  transition: border-color 0.15s, background 0.15s;
}

.model-chip:hover {
  border-color: var(--accent);
}

.model-chip.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 600;
}

/* token 额度 */
.measure-note {
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 16px;
}

.measure-title {
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-soft);
}

.measure-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
  color: var(--ink-soft);
}

.measure-grid strong {
  color: var(--accent-deep);
  font-variant-numeric: tabular-nums;
}

.measure-foot {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--ink-soft);
  opacity: 0.85;
}

.preset-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.preset-btn {
  border: 1px solid var(--line);
  background: var(--bg);
  border-radius: 999px;
  padding: 7px 16px;
  font-size: 13px;
  color: var(--ink);
}

.preset-btn:hover {
  border-color: var(--accent);
}

.preset-btn.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 600;
}

.preset-btn.ghost {
  color: var(--ink-soft);
}

.preset-desc {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--ink-soft);
}

/* 「允许模型内部思考」开关 */
.thinking-box {
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  margin-bottom: 16px;
}

.thinking-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.thinking-text {
  min-width: 200px;
  flex: 1;
}

.thinking-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-deep);
}

.thinking-default {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-soft);
  background: var(--bg-card);
  border-radius: 999px;
  padding: 1px 8px;
}

.thinking-sub {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-soft);
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: none;
  padding: 2px 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}

.switch-track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: #cfccdd;
  transition: background 0.18s ease;
  flex: none;
}

.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
  transition: transform 0.18s ease;
}

.switch.on .switch-track {
  background: var(--accent);
}

.switch.on .switch-knob {
  transform: translateX(18px);
}

.switch.on .switch-text {
  color: var(--accent-deep);
  font-weight: 600;
}

.switch:disabled {
  opacity: 0.6;
}

.thinking-evidence {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgb(0 0 0 / 8%);
  display: grid;
  gap: 6px;
}

.ev-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink);
}

.ev-tag {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  padding: 1px 8px;
}

.ev-tag.bad {
  color: var(--bad);
  background: var(--bad-soft);
}

.ev-tag.ok {
  color: var(--ok);
  background: var(--ok-soft);
}

.thinking-model-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ink-soft);
}

.thinking-model-hint code {
  font-size: 11.5px;
  background: var(--bg-card);
  border-radius: 4px;
  padding: 1px 5px;
}

.limit-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.field-range {
  font-size: 11.5px;
  color: var(--ink-soft);
  opacity: 0.8;
}

@media (max-width: 640px) {
  .limit-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.input {
  width: 100%;
  padding: 11px 14px;
  font-size: 14px;
  font-family: inherit;
  color: var(--ink);
  background: var(--bg);
  border: 1.5px solid var(--line);
  border-radius: var(--radius-sm);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-card);
}

.preset-note,
.form-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
}

.msg {
  margin: 0;
  padding: 10px 14px;
  font-size: 13px;
  border-radius: var(--radius-sm);
}

.msg.error {
  color: var(--bad);
  background: var(--bad-soft);
}

.msg.ok {
  color: var(--ok);
  background: var(--ok-soft);
}

.msg.warn {
  color: #8a6d1f;
  background: #fdf6e3;
  display: grid;
  gap: 6px;
}

.msg.warn p {
  margin: 0;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.form-hint code {
  font-family: ui-monospace, monospace;
  background: var(--bg);
  border-radius: 4px;
  padding: 1px 5px;
}

/* 校验失败的诊断面板 */
.diag {
  background: var(--bg);
  border: 1px solid var(--bad-soft);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
}

.diag-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
}

.diag-steps {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: grid;
  gap: 6px;
}

.diag-steps li {
  display: flex;
  gap: 8px;
  font-size: 13px;
  align-items: baseline;
}

.diag-mark {
  color: var(--ok);
  flex: none;
}

.diag-steps li.bad .diag-mark {
  color: var(--bad);
}

.diag-step {
  flex: none;
  min-width: 88px;
}

.diag-detail {
  color: var(--ink-soft);
  font-size: 12.5px;
  word-break: break-all;
}

.diag-hint {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--accent-deep);
}

.diag-meta {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
  word-break: break-all;
}

@media (max-width: 560px) {
  .cost-row,
  .field-row {
    grid-template-columns: 1fr;
  }
}
</style>
