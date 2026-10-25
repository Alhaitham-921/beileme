<script setup>
import { computed, ref, watch } from 'vue'
import {
  accentPresets, appearance, backgrounds, backgroundUrl, defaultAppearance,
  removeUploadedBackground, resetAppearance, setAppearance, storageStatus,
  uploadBackground, uploadedBackgroundUrl,
} from '../stores/theme'

const fileInput = ref(null)
const uploading = ref(false)
const uploadError = ref('')
const notice = ref('')
const colorDraft = ref(appearance.accent)
const isColorValid = computed(() => /^#[\da-f]{6}$/i.test(colorDraft.value.trim()))
const positions = [
  { value: 'center', label: '居中' }, { value: 'top', label: '上方' },
  { value: 'bottom', label: '下方' }, { value: 'left', label: '左侧' }, { value: 'right', label: '右侧' },
]
const selectedBackgroundName = computed(() => appearance.background === 'uploaded'
  ? '我的风景' : backgrounds.find(item => item.id === appearance.background)?.name || '静谧底色')
watch(() => appearance.accent, value => { colorDraft.value = value })

function setColor(value) {
  colorDraft.value = value
  if (/^#[\da-f]{6}$/i.test(value.trim())) setAppearance({ accent: value.trim() })
}

function selectBackground(item) {
  uploadError.value = ''
  notice.value = ''
  setAppearance({ background: item.id, dim: item.dim ?? 48, position: 'center' })
}

async function onUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return
  uploading.value = true
  uploadError.value = ''
  notice.value = ''
  try {
    const result = await uploadBackground(file)
    if (result) notice.value = `背景已保存在此设备，已根据画面亮度调整暗化程度为 ${result.recommendedDim}%。`
  } catch (error) {
    uploadError.value = error.message || '图片保存失败，请重试。'
  } finally {
    uploading.value = false
    event.target.value = ''
  }
}

async function removeImage() {
  uploadError.value = ''
  notice.value = ''
  try {
    await removeUploadedBackground()
    notice.value = '已删除此设备上保存的自定义背景。'
  } catch (error) { uploadError.value = error.message }
}

async function restoreDefaults() {
  uploadError.value = ''
  notice.value = ''
  try {
    await resetAppearance()
    notice.value = '已恢复默认外观。'
  } catch (error) { uploadError.value = error.message }
}
</script>

<template>
  <section class="card appearance-panel" aria-labelledby="appearance-title">
    <header class="appearance-heading">
      <div>
        <span class="section-eyebrow">为专注留一点空间</span>
        <h2 id="appearance-title">你的学习氛围</h2>
        <p>选一片风景，让每一次打开都恰到好处。</p>
      </div>
      <span class="save-indicator"><span aria-hidden="true"></span>即时生效 · 自动保存</span>
    </header>

    <div class="appearance-layout">
      <div class="appearance-controls">
        <fieldset class="setting-group material-group">
          <legend>界面材质</legend>
          <div class="material-options">
            <button type="button" class="material-option" :class="{ selected: appearance.material === 'glass' }" :aria-pressed="appearance.material === 'glass'" @click="setAppearance({ material: 'glass' })">
              <span class="material-symbol glass-symbol" aria-hidden="true"><i></i><i></i></span>
              <span><strong>沉浸毛玻璃</strong><small>透过微光，感受空间</small></span>
              <span class="selection-mark" aria-hidden="true">{{ appearance.material === 'glass' ? '✓' : '' }}</span>
            </button>
            <button type="button" class="material-option" :class="{ selected: appearance.material === 'solid' }" :aria-pressed="appearance.material === 'solid'" @click="setAppearance({ material: 'solid' })">
              <span class="material-symbol solid-symbol" aria-hidden="true"><i></i><i></i></span>
              <span><strong>清晰实色</strong><small>稳定层次，轻松阅读</small></span>
              <span class="selection-mark" aria-hidden="true">{{ appearance.material === 'solid' ? '✓' : '' }}</span>
            </button>
          </div>
        </fieldset>

        <fieldset class="setting-group">
          <legend>主题色</legend>
          <p class="group-description">在按钮、进度和选中状态中，点亮你喜欢的颜色。</p>
          <div class="accent-options" role="group" aria-label="预设主题色">
            <button v-for="item in accentPresets" :key="item.id" type="button" class="accent-option" :class="{ selected: appearance.accent === item.color }" :style="{ '--swatch': item.color }" :aria-label="item.name" :title="item.name" :aria-pressed="appearance.accent === item.color" @click="setAppearance({ accent: item.color })">
              <span aria-hidden="true">{{ appearance.accent === item.color ? '✓' : '' }}</span>
            </button>
          </div>
          <div class="custom-color-row">
            <label class="color-picker-label"><input type="color" :value="appearance.accent" aria-label="自定义主题色" @input="setColor($event.target.value)" /><span>自定义颜色</span></label>
            <label class="hex-label"><span class="sr-only">十六进制主题色</span><input :value="colorDraft" class="hex-input" type="text" maxlength="7" placeholder="#9AAEFF" spellcheck="false" :aria-invalid="!isColorValid" :aria-describedby="!isColorValid ? 'color-error' : undefined" @input="setColor($event.target.value)" /></label>
          </div>
          <p v-if="!isColorValid" id="color-error" class="inline-error">请输入完整的颜色值，例如 #9AAEFF。</p>
          <p v-else class="color-hint">过暗的颜色会适度提亮，让控件始终清晰。</p>
        </fieldset>

        <fieldset class="setting-group background-group">
          <legend>窗外的风景</legend>
          <p class="group-description">一组安静的自然景色，也可以换成你的珍藏。</p>
          <div class="background-options" role="group" aria-label="背景风景">
            <button v-for="item in backgrounds" :key="item.id" type="button" class="background-option" :class="{ selected: appearance.background === item.id }" :aria-pressed="appearance.background === item.id" @click="selectBackground(item)">
              <span class="background-thumb" :style="{ backgroundImage: `url('${item.url}')` }"><span v-if="appearance.background === item.id" class="background-check" aria-hidden="true">✓</span></span>
              <strong>{{ item.name }}</strong>
            </button>
          </div>
          <div v-if="uploadedBackgroundUrl" class="uploaded-row">
            <button type="button" class="uploaded-choice" :class="{ selected: appearance.background === 'uploaded' }" :aria-pressed="appearance.background === 'uploaded'" @click="setAppearance({ background: 'uploaded' })">
              <img :src="uploadedBackgroundUrl" alt="自定义背景缩略图" />
              <span><strong>我的风景</strong><small>已保存在此设备</small></span><span v-if="appearance.background === 'uploaded'" aria-hidden="true">✓</span>
            </button>
            <button type="button" class="text-button remove-background" :disabled="uploading" @click="removeImage">删除</button>
          </div>
          <div class="background-actions">
            <input ref="fileInput" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" tabindex="-1" aria-hidden="true" :disabled="uploading" @change="onUpload" />
            <button type="button" class="upload-button" :disabled="uploading" @click="fileInput?.click()"><span aria-hidden="true">{{ uploading ? '◌' : '+' }}</span>{{ uploading ? '正在处理图片…' : uploadedBackgroundUrl ? '更换本地图片' : '上传本地图片' }}</button>
            <button type="button" class="text-button plain-background" :class="{ active: appearance.background === 'none' }" :aria-pressed="appearance.background === 'none'" @click="setAppearance({ background: 'none' })">使用纯色背景</button>
          </div>
          <p class="upload-hint">JPG、PNG、WebP、AVIF · 最大 12 MB · 仅存于此设备</p>
          <p v-if="uploadError" role="alert" class="inline-error">{{ uploadError }}</p>

          <details class="background-details">
            <summary>微调画面<span>位置 · 暗化 · 模糊</span><span class="details-chevron" aria-hidden="true">⌄</span></summary>
            <div class="background-adjustments">
              <label class="position-control"><span>图片位置</span><select :value="appearance.position" @change="setAppearance({ position: $event.target.value })"><option v-for="position in positions" :key="position.value" :value="position.value">{{ position.label }}</option></select></label>
              <label class="range-control"><span>背景暗化<output>{{ appearance.dim }}%</output></span><input type="range" min="0" max="85" step="1" :value="appearance.dim" @input="setAppearance({ dim: Number($event.target.value) })" /></label>
              <label class="range-control"><span>背景模糊<output>{{ appearance.blur }} px</output></span><input type="range" min="0" max="24" step="1" :value="appearance.blur" @input="setAppearance({ blur: Number($event.target.value) })" /></label>
              <button type="button" class="text-button default-background" @click="setAppearance({ background: defaultAppearance.background, position: defaultAppearance.position, dim: defaultAppearance.dim, blur: defaultAppearance.blur })">恢复默认风景</button>
            </div>
          </details>
        </fieldset>

        <fieldset class="setting-group density-group">
          <legend>显示密度</legend>
          <div class="density-options" role="group" aria-label="界面显示密度">
            <button type="button" :class="{ selected: appearance.density === 'comfortable' }" :aria-pressed="appearance.density === 'comfortable'" @click="setAppearance({ density: 'comfortable' })">舒适<span>从容留白</span></button>
            <button type="button" :class="{ selected: appearance.density === 'compact' }" :aria-pressed="appearance.density === 'compact'" @click="setAppearance({ density: 'compact' })">紧凑<span>更多内容</span></button>
          </div>
        </fieldset>
      </div>

      <aside class="appearance-preview-column" aria-label="外观实时预览">
        <div class="preview-label"><span class="preview-live-dot" aria-hidden="true"></span>实时预览<span>{{ selectedBackgroundName }}</span></div>
        <div class="scene-preview" :class="[appearance.material, appearance.density]">
          <div class="preview-landscape" :style="{ backgroundImage: backgroundUrl ? `url('${backgroundUrl}')` : 'none', backgroundPosition: appearance.position, filter: `blur(${appearance.blur / 2}px)` }"></div>
          <div class="preview-shade" :style="{ backgroundColor: `rgba(4, 10, 20, ${appearance.dim / 100})` }"></div>
          <div class="mini-header"><span aria-hidden="true">◒</span><span>背了么</span><span>每日一词</span></div>
          <div class="mini-word-card">
            <div class="mini-progress"><span>保持好奇，慢慢积累</span><span>12 / 20</span></div>
            <span class="mini-word">serendipity</span>
            <span class="mini-phonetic">/ˌser.ənˈdɪp.ə.ti/</span>
            <p class="mini-definition"><span>n.</span> 不期而遇的美好</p>
            <div class="mini-progress-track"><span></span></div>
            <span class="mini-continue">继续学习<span aria-hidden="true">→</span></span>
          </div>
          <span class="preview-caption">一方安静，装下每一份进步。</span>
        </div>
        <p class="preview-note">你的偏好会应用于整个应用。<br />学习进度始终为你保留。</p>
      </aside>
    </div>

    <footer class="appearance-footer">
      <p v-if="storageStatus" class="storage-warning" role="status">{{ storageStatus }}</p>
      <p v-else class="appearance-notice" role="status">{{ notice || '外观偏好保存在当前浏览器，无需额外保存。' }}</p>
      <button type="button" class="text-button reset-appearance" :disabled="uploading" @click="restoreDefaults">恢复默认外观</button>
    </footer>
  </section>
</template>

<style scoped>
.appearance-panel { padding: clamp(22px, 3vw, 34px); margin-bottom: 24px; }
.appearance-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 28px; }
.section-eyebrow { font-size: 10px; letter-spacing: .15em; color: var(--accent-deep); }
.appearance-heading h2 { margin: 8px 0 7px; font-size: 24px; font-weight: 600; letter-spacing: -.04em; }
.appearance-heading p, .group-description { margin: 0; color: var(--ink-soft); font-size: 12px; line-height: 1.8; }
.save-indicator { display: inline-flex; align-items: center; gap: 7px; color: var(--ink-soft); font-size: 10px; white-space: nowrap; }
.save-indicator > span, .preview-live-dot { width: 5px; height: 5px; flex-shrink: 0; border-radius: 50%; background: var(--ok, #8abcab); }
.appearance-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(250px, .85fr); gap: 34px; align-items: start; }
.appearance-controls { min-width: 0; }
.setting-group { min-width: 0; padding: 0 0 24px; margin: 0 0 24px; border: 0; border-bottom: 1px solid var(--line); }
.setting-group legend { padding: 0; margin-bottom: 12px; font-size: 13px; font-weight: 600; }
.group-description { margin: -5px 0 14px; font-size: 11px; }
.material-options { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.material-option { display: flex; align-items: center; gap: 10px; min-width: 0; text-align: left; padding: 13px 11px; border: 1px solid var(--line); border-radius: 11px; background: var(--bg); color: var(--ink); transition: border-color 160ms, background 160ms; }
.material-option.selected { border-color: var(--accent); background: var(--accent-soft); }
.material-option > span:nth-child(2) { flex: 1; }
.material-option strong { display: block; font-size: 11px; font-weight: 500; }
.material-option small { display: block; margin-top: 5px; font-size: 9px; color: var(--ink-soft); }
.material-symbol { display: block; position: relative; width: 25px; height: 27px; flex-shrink: 0; }
.material-symbol i { position: absolute; width: 18px; height: 20px; border: 1px solid rgba(180, 196, 223, .6); border-radius: 4px; }
.material-symbol i:first-child { bottom: 0; left: 0; background: rgba(180, 196, 223, .16); }
.material-symbol i:last-child { right: 0; top: 0; background: rgba(170, 190, 230, .24); backdrop-filter: blur(3px); }
.solid-symbol i:last-child { background: #566173; }
.selection-mark { display: grid; place-items: center; width: 13px; height: 13px; border: 1px solid var(--line); border-radius: 50%; color: var(--on-accent); flex-shrink: 0; font-size: 9px; }
.selected .selection-mark { background: var(--accent); border-color: var(--accent); }
.accent-options { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; margin: 0 0 13px; }
.accent-option { display: grid; place-items: center; min-width: 0; height: 44px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: #172032; }
.accent-option > span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 3px transparent; font-size: 14px; transition: box-shadow 160ms; }
.accent-option.selected > span { box-shadow: 0 0 0 3px var(--bg-card), 0 0 0 4px var(--swatch); }
.custom-color-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.color-picker-label { display: inline-flex; align-items: center; gap: 9px; font-size: 11px; color: var(--ink-soft); cursor: pointer; }
.color-picker-label input { appearance: none; width: 28px; height: 28px; padding: 3px; border: 1px solid var(--line); border-radius: 7px; background: transparent; cursor: pointer; }
.color-picker-label input::-webkit-color-swatch-wrapper { padding: 0; }
.color-picker-label input::-webkit-color-swatch { border: 0; border-radius: 3px; }
.hex-input { width: 99px; padding: 7px 9px; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 7px; background: var(--bg); font: 10px ui-monospace, monospace; letter-spacing: .06em; }
.hex-input[aria-invalid="true"] { border-color: var(--bad); }
.color-hint { margin: 8px 0 0; color: var(--ink-soft); font-size: 9px; line-height: 1.8; }
.background-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.background-option { padding: 0; border: 0; color: var(--ink-soft); background: transparent; text-align: left; }
.background-thumb { position: relative; display: block; width: 100%; height: 68px; border: 1px solid var(--line); border-radius: 9px; background-color: #172030; background-size: cover; background-position: center; transition: box-shadow 160ms; }
.background-option.selected .background-thumb { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.background-option strong { display: block; font-size: 10px; font-weight: 400; margin-top: 7px; }
.background-option.selected strong { color: var(--ink); }
.background-check { display: grid; place-items: center; position: absolute; right: 5px; bottom: 5px; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-size: 10px; }
.background-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 9px; margin-top: 15px; }
.upload-button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font-size: 10px; }
.upload-button > span { font-size: 15px; line-height: 1; color: var(--ink-soft); }
.text-button { min-height: 44px; padding: 5px 0; border: 0; background: transparent; color: var(--ink-soft); font-size: 10px; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 4px; }
.text-button:hover, .text-button.active { color: var(--accent-deep); text-decoration-color: currentColor; }
.upload-hint { margin: 9px 0 0; font-size: 9px; color: var(--ink-soft); line-height: 1.8; }
.uploaded-row { display: flex; align-items: center; gap: 12px; margin-top: 13px; }
.uploaded-choice { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; padding: 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); text-align: left; }
.uploaded-choice.selected { border-color: var(--accent); }
.uploaded-choice img { width: 48px; height: 35px; border-radius: 5px; object-fit: cover; }
.uploaded-choice > span:nth-child(2) { flex: 1; }
.uploaded-choice strong { display: block; font-weight: 500; font-size: 10px; }
.uploaded-choice small { display: block; margin-top: 4px; font-size: 9px; color: var(--ink-soft); }
.uploaded-choice > span:last-child { color: var(--accent-deep); }
.remove-background:hover { color: var(--bad); }
.background-details { margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line); }
.background-details summary { display: flex; align-items: center; gap: 8px; list-style: none; font-size: 11px; cursor: pointer; }
.background-details summary::-webkit-details-marker { display: none; }
.background-details summary > span:nth-child(1) { margin-left: auto; color: var(--ink-soft); font-size: 9px; }
.details-chevron { font-size: 15px; color: var(--ink-soft); transition: transform 160ms; }
.background-details[open] .details-chevron { transform: rotate(180deg); }
.background-adjustments { display: grid; gap: 18px; margin-top: 18px; }
.position-control { display: flex; align-items: center; justify-content: space-between; font-size: 11px; }
.position-control select { width: 108px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--ink); font-size: 11px; color-scheme: dark; }
.range-control { display: grid; gap: 10px; font-size: 11px; }
.range-control > span { display: flex; justify-content: space-between; }
.range-control output { font-size: 10px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.range-control input { width: 100%; height: 28px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.default-background { justify-self: start; }
.density-group { padding-bottom: 0; margin-bottom: 0; border: 0; }
.density-options { display: flex; gap: 9px; }
.density-options button { display: flex; align-items: center; justify-content: center; gap: 9px; flex: 1; padding: 11px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font-size: 11px; }
.density-options button > span { color: var(--ink-soft); font-size: 9px; }
.density-options button.selected { background: var(--accent-soft); border-color: var(--accent); }
.appearance-preview-column { position: sticky; top: 32px; min-width: 0; }
.preview-label { display: flex; align-items: center; gap: 7px; margin-bottom: 12px; color: var(--ink-soft); font-size: 10px; }
.preview-label > span:last-child { margin-left: auto; font-size: 9px; }
.scene-preview { position: relative; isolation: isolate; min-height: 345px; overflow: hidden; border: 1px solid rgba(210, 222, 243, .16); border-radius: 14px; padding: 19px 17px 23px; background: #0c1320; }
.preview-landscape, .preview-shade { position: absolute; inset: -12px; z-index: -1; }
.preview-landscape { background-size: cover; }
.preview-shade { background-image: linear-gradient(180deg, rgba(7, 15, 27, .08), rgba(7, 15, 27, .42)); }
.mini-header { display: flex; gap: 7px; align-items: center; font-size: 10px; color: #e0e6f1; }
.mini-header > span:first-child { font-size: 15px; color: var(--accent-deep); }
.mini-header > span:last-child { margin-left: auto; color: #a7b1c4; font-size: 8px; }
.mini-word-card { display: flex; flex-direction: column; align-items: center; padding: 17px 17px 15px; margin-top: 31px; border: 1px solid rgba(220, 229, 249, .14); border-radius: 12px; background: rgba(17, 26, 42, .73); box-shadow: 0 10px 30px rgba(0, 0, 0, .14), inset 0 1px rgba(255, 255, 255, .04); backdrop-filter: blur(18px); color: #e7ebf4; }
.solid .mini-word-card { background: #1a2333; backdrop-filter: none; }
.compact .mini-word-card { padding: 12px 14px; }
.mini-progress { display: flex; justify-content: space-between; align-items: center; align-self: stretch; gap: 8px; font-size: 7px; color: #a5aec0; }
.mini-word { margin-top: 29px; font-family: var(--serif); font-size: clamp(25px, 2.4vw, 33px); letter-spacing: -.035em; }
.mini-phonetic { margin-top: 6px; color: #a0abc0; font-size: 9px; }
.mini-definition { margin: 21px 0 24px; font-size: 11px; }
.mini-definition > span { color: #a0abc0; margin-right: 7px; font-family: var(--serif); }
.mini-progress-track { height: 2px; width: 100%; background: rgba(220, 229, 249, .13); border-radius: 3px; }
.mini-progress-track > span { display: block; height: 100%; width: 60%; border-radius: inherit; background: var(--accent); }
.mini-continue { display: flex; justify-content: space-between; align-self: stretch; margin-top: 14px; padding: 10px 12px; border-radius: 6px; font-size: 9px; background: var(--accent); color: var(--on-accent); }
.preview-caption { display: block; margin-top: 20px; text-align: center; font-size: 8px; color: #b9c2d4; }
.preview-note { margin: 15px 0 0; text-align: center; color: var(--ink-soft); font-size: 10px; line-height: 1.9; }
.appearance-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 28px; padding-top: 19px; border-top: 1px solid var(--line); }
.appearance-notice, .storage-warning { flex: 1; margin: 0; color: var(--ink-soft); font-size: 10px; line-height: 1.8; }
.storage-warning { color: var(--warn-ink, #d7b67c); }
.reset-appearance { flex-shrink: 0; }
.inline-error { margin: 10px 0 0; color: var(--bad, #e6a4a4); font-size: 10px; line-height: 1.8; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
button { cursor: pointer; font-family: inherit; }
.material-option, .upload-button, .density-options button, .background-details summary, .position-control select { min-height: 44px; }
.color-picker-label { min-height: 44px; }
.remove-background { min-width: 44px; }
button:disabled { cursor: wait; opacity: .55; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--accent-deep); outline-offset: 4px; }
@supports not (backdrop-filter: blur(1px)) { .mini-word-card { background: #1a2333; } }
@media (max-width: 1000px) { .appearance-layout { grid-template-columns: minmax(0, 1fr) minmax(225px, .8fr); gap: 22px; }.material-option { gap: 7px; padding: 11px 8px; }.material-symbol { display: none; } }
@media (max-width: 760px) { .appearance-layout { grid-template-columns: minmax(0, 1fr); }.appearance-preview-column { position: static; }.scene-preview { min-height: 320px; padding-inline: 26px; }.mini-word-card { max-width: 320px; margin-inline: auto; }.mini-word { font-size: 32px; }.save-indicator { display: none; }.appearance-heading { margin-bottom: 24px; }.material-symbol { display: block; }.appearance-preview-column { margin-top: 5px; }.appearance-footer { align-items: flex-start; } }
@media (max-width: 380px) { .appearance-panel { padding: 18px; }.accent-options { gap: 3px; }.accent-option > span { width: 25px; height: 25px; }.material-symbol { display: none; }.material-option small { font-size: 8px; }.scene-preview { padding-inline: 14px; }.background-details summary > span:nth-child(1) { font-size: 8px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
</style>
