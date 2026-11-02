<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { http } from '../api/client.js'
import logo from '../assets/logo.png'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

/** 'login' | 'register' */
const mode = ref('login')
const recovery=ref({email:'',code:'',password:'',confirm:''})
const recoveryNotice=ref('')
const recoveryBusy=ref(false)
async function recover(reset=false){
 if(recoveryBusy.value)return
 recoveryBusy.value=true;formError.value='';recoveryNotice.value=''
 try{
  if(reset){
   if(recovery.value.password!==recovery.value.confirm)throw new Error('两次输入的新密码不一致')
   await http.post('/auth/reset-password',{auth:false,body:{email:recovery.value.email.trim(),code:recovery.value.code.trim(),newPassword:recovery.value.password}})
   form.value.account=recovery.value.email.trim();form.value.password='';recovery.value.code='';recovery.value.password='';recovery.value.confirm='';mode.value='login';recoveryNotice.value='密码已重置，请使用新密码登录。'
  }else{recoveryNotice.value=(await http.post('/auth/forgot-password',{auth:false,body:{email:recovery.value.email.trim()}})).message}
 }catch(e){formError.value=e.message}finally{recoveryBusy.value=false}
}

const form = ref({ account: '', email: '', password: '', confirm: '', nickname: '' })
const formError = ref('')
const submitting = ref(false)

const isRegister = computed(() => mode.value === 'register')
const submitLabel = computed(() => (isRegister.value ? '注册并开始' : '登录'))

function switchMode(next) {
  mode.value = next
  formError.value = ''
  auth.error = ''
}

/** 先在前端做基础校验，把明显错误挡住，减少一次无效请求 */
function validate() {
  const { account, email, password, confirm } = form.value

  if (isRegister.value) {
    if (!email.trim()) return '请填写邮箱'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '邮箱格式看起来不太对'
    if (password.length < 8) return '密码至少 8 位'
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return '密码需要同时包含字母和数字'
    if (password !== confirm) return '两次输入的密码不一致'
    return ''
  }

  if (!account.trim()) return '请填写邮箱'
  if (!password) return '请填写密码'
  return ''
}

async function submit() {
  if (submitting.value) return

  const message = validate()
  if (message) {
    formError.value = message
    return
  }

  formError.value = ''
  submitting.value = true
  try {
    if (isRegister.value) {
      await auth.register({
        email: form.value.email.trim(),
        password: form.value.password,
        nickname: form.value.nickname.trim(),
      })
    } else {
      await auth.login({
        account: form.value.account.trim(),
        password: form.value.password,
      })
    }

    // 登录成功：没做过引导先去引导页，否则回到用户原本想去的页面
    if (!auth.isOnboarded) {
      router.replace({ name: 'onboarding' })
      return
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirect)
  } catch (error) {
    formError.value = error.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="brand-mark">
      <img :src="logo" alt="" />
    </div>
    <h1 class="auth-title">背了么</h1>
    <p class="auth-slogan">用单词，而不是背单词</p>

    <div class="card auth-card">
      <div class="tabs">
        <button class="tab" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
        <button class="tab" :class="{ active: isRegister }" @click="switchMode('register')">
          注册
        </button>
      </div>

      <form v-if="mode !== 'recover'" class="form" @submit.prevent="submit">
        <template v-if="isRegister">
          <label class="field">
            <span class="field-label">邮箱</span>
            <input
              v-model="form.email"
              type="email"
              autocomplete="email"
              placeholder="例如：123456789@qq.com"
              class="input"
            />
          </label>

          <label class="field">
            <span class="field-label">昵称<span class="optional">（可选）</span></span>
            <input v-model="form.nickname" type="text" maxlength="20" placeholder="怎么称呼你" class="input" />
          </label>

          <label class="field">
            <span class="field-label">密码</span>
            <input
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              placeholder="至少 8 位，含字母和数字"
              class="input"
            />
          </label>

          <label class="field">
            <span class="field-label">确认密码</span>
            <input
              v-model="form.confirm"
              type="password"
              autocomplete="new-password"
              placeholder="再输入一次"
              class="input"
            />
          </label>
        </template>

        <template v-else>
          <label class="field">
            <span class="field-label">邮箱</span>
            <input
              v-model="form.account"
              type="text"
              autocomplete="username"
              placeholder="注册时使用的邮箱"
              class="input"
            />
          </label>

          <label class="field">
            <span class="field-label">密码</span>
            <input
              v-model="form.password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              class="input"
            />
          </label>
        </template>

        <p v-if="formError || auth.error" class="form-error">{{ formError || auth.error }}</p>

        <button type="submit" class="btn btn-primary btn-lg btn-full" :disabled="submitting">
          {{ submitting ? '处理中…' : submitLabel }}
        </button>
      </form>

      <button v-if="mode === 'login'" class="text-button" @click="switchMode('recover')">忘记密码？</button>
      <section v-if="mode === 'recover'" aria-label="找回密码">
       <h2>通过邮箱找回密码</h2>
       <p>仅支持已验证的注册邮箱。旧账号请先登录，在偏好设置 → 账号安全中完成邮箱验证；无法登录且邮箱未验证时，请联系管理员核验。</p>
       <form class="form" @submit.prevent="recover(false)">
        <label class="field"><span>注册邮箱</span><input class="input" v-model="recovery.email" type="email" autocomplete="email" required maxlength="190" /></label>
        <button class="btn btn-secondary" :disabled="recoveryBusy">获取重置码</button>
       </form>
       <form class="form" @submit.prevent="recover(true)">
        <label class="field"><span>邮件中的32位重置码</span><input class="input" v-model="recovery.code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required minlength="32" maxlength="32" /></label>
        <label class="field"><span>新密码</span><input class="input" v-model="recovery.password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" placeholder="至少8位，包含字母和数字" /></label>
        <label class="field"><span>确认新密码</span><input class="input" v-model="recovery.confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="128" /></label>
        <button class="btn btn-primary" :disabled="recoveryBusy">重置密码</button>
       </form>
       <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
       <p class="muted">重置码15分钟有效。重新获取需间隔60秒，请同时检查垃圾邮件。</p>
      </section>
      <p v-if="recoveryNotice" role="status">{{ recoveryNotice }}</p>
      <p class="hint">
        学习记录保存在服务器上，换设备登录也能接着背。
        <br />
        邮箱用于账号隔离、归属验证和密码找回，不发送营销邮件。
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  max-width: 460px;
  margin: 0 auto;
  padding: 56px 20px 80px;
  text-align: center;
}

.brand-mark img {
  width: 72px;
  height: 72px;
  border-radius: 22px;
  box-shadow: var(--shadow);
}

.auth-title {
  font-family: var(--serif);
  font-size: 30px;
  margin: 18px 0 2px;
}

.auth-slogan {
  color: var(--ink-soft);
  margin: 0 0 28px;
}

.auth-card {
  text-align: left;
}

.tabs {
  display: flex;
  gap: 6px;
  background: var(--bg);
  border-radius: 999px;
  padding: 4px;
  margin-bottom: 24px;
}

.tab {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 999px;
  padding: 9px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-soft);
  transition: background 0.18s, color 0.18s;
}

.tab.active {
  background: var(--bg-card);
  color: var(--accent-deep);
  box-shadow: 0 1px 3px rgba(60, 45, 30, 0.08);
}

.form {
  display: grid;
  gap: 16px;
}

.field {
  display: grid;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  color: var(--ink-soft);
}

.optional {
  color: var(--ink-soft);
  opacity: 0.7;
}

.input {
  width: 100%;
  padding: 13px 16px;
  font-size: 15px;
  font-family: inherit;
  color: var(--ink);
  background: var(--bg);
  border: 1.5px solid var(--line);
  border-radius: var(--radius-sm);
  transition: border-color 0.15s, background 0.15s;
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-card);
}

.form-error {
  margin: 0;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--bad);
  background: var(--bad-soft);
  border-radius: var(--radius-sm);
}

.btn-full {
  width: 100%;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hint {
  margin: 20px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-soft);
}
</style>
