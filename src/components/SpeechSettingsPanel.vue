<script setup>
import { onMounted, ref } from 'vue'
import http from '../api/client.js'

const loading = ref(true), busy = ref(false), canManage = ref(false), configured = ref(false)
const keyConfigured = ref(false), error = ref(''), message = ref('')
const form = ref({ enabled: true, apiKey: '', dailyQuota: 100, perMinuteQuota: 6 })
async function load() {
  loading.value = true; error.value = ''
  try {
    const status = await http.get('/speech/status')
    configured.value = status.configured; canManage.value = status.canManage
    if (canManage.value) {
      const settings = await http.get('/speech/admin/settings')
      keyConfigured.value = settings.keyConfigured
      form.value = { enabled: settings.enabled, apiKey: '', dailyQuota: settings.dailyQuota, perMinuteQuota: settings.perMinuteQuota }
    }
  } catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
async function submit(testOnly = false) {
  busy.value = true; error.value = ''; message.value = ''
  try {
    if (testOnly) {
      const result = await http.post('/speech/admin/test', { body: { ...form.value }, timeoutMs: 20000 })
      message.value = result.message
    } else {
      await http.put('/speech/admin/settings', { body: { ...form.value }, timeoutMs: 20000 })
      await load()
      message.value = '已保存，对本服务器的所有登录用户立即生效。'
    }
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <section class="card speech-settings" aria-label="共享语音服务">
    <h2>语音输入</h2>
    <p v-if="loading" role="status">正在读取语音服务…</p>
    <template v-else>
      <p>{{ configured ? '管理员已开启共享语音识别，你可以直接录音转文字，无需个人 API Key。' : '共享语音识别尚未就绪，请联系管理员配置或开启。' }}</p>
      <router-link to="/speech" class="btn btn-primary">打开语音转文字</router-link>
      <form v-if="canManage" class="admin-form" @submit.prevent="submit(false)">
        <h3>管理员配置</h3>
        <p>服务：硅基流动 · FunAudioLLM/SenseVoiceSmall。密钥加密保存在服务器，不向用户返回。</p>
        <fieldset :disabled="busy">
          <label class="toggle"><input v-model="form.enabled" type="checkbox" /> 对所有登录用户开启语音识别</label>
          <label>硅基流动 API Key
            <input v-model.trim="form.apiKey" type="password" autocomplete="new-password" maxlength="4096" :placeholder="keyConfigured ? '已有密钥，留空保留；填写可替换' : '填写硅基流动 API Key'" />
          </label>
          <label>每位用户每日识别次数<input v-model.number="form.dailyQuota" type="number" min="1" max="1000" required /></label>
          <label>每位用户每分钟最多次数<input v-model.number="form.perMinuteQuota" type="number" min="1" max="60" required /></label>
          <small>这是本应用的使用限额；硅基流动账号本身仍受平台总限速约束。服务重启后本应用计数会重置。</small>
          <div class="actions"><button class="btn" type="button" @click="submit(true)">测试账号连通性</button><button class="btn btn-primary" type="submit">{{ busy ? '处理中…' : '保存共享配置' }}</button></div>
        </fieldset>
      </form>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <button v-if="error && !busy" class="btn" @click="load">重新读取</button>
  </section>
</template>

<style scoped>
.speech-settings { margin-top: 24px; padding: 24px; }.speech-settings p { line-height: 1.8; margin: 12px 0 18px; }
.admin-form { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 22px; }
fieldset { border: 0; padding: 0; display: grid; gap: 18px; min-width: 0; }
label { display: grid; gap: 8px; }.toggle { display: flex; align-items: center; gap: 10px; }
input:not([type="checkbox"]) { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: inherit; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; }.error { color: var(--bad); }small { line-height: 1.7; opacity: .75; }
</style>
