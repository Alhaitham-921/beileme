<script setup>
import { ref, onMounted } from 'vue'
import { http } from '../api/client.js'
import { useAuthStore } from '../stores/auth.js'
const auth=useAuthStore(), password=ref(''),code=ref(''),busy=ref(false),notice=ref(''),error=ref('')
onMounted(async()=>{try{auth.user=(await http.get('/auth/me')).user}catch{}})
async function act(confirm=false){
 if(busy.value)return
 busy.value=true;error.value='';notice.value=''
 try{
  if(confirm){await http.post('/auth/verify-email',{body:{code:code.value.trim()}});auth.user=(await http.get('/auth/me')).user;code.value='';password.value='';notice.value='邮箱已验证，可以通过登录页找回密码。'}
  else {const result=await http.post('/auth/email-verification',{body:{currentPassword:password.value}});notice.value=result.message;password.value=''}
 }catch(e){error.value=e.message}finally{busy.value=false}
}
</script>
<template>
 <section class="card block" aria-label="账号与密码找回">
  <h2>账号与密码找回</h2>
  <p>邮箱：{{ auth.user?.email || '未绑定邮箱' }}</p>
  <p v-if="auth.user?.emailVerified">已验证。忘记密码时，可在登录页使用邮件重置码找回。</p>
  <template v-else-if="auth.user?.email">
   <p>请先验证注册邮箱归你所有。忘记密码后，只有已验证的邮箱才能找回。</p>
   <form @submit.prevent="act(false)">
    <label class="field"><span>当前登录密码</span><input class="input" v-model="password" type="password" autocomplete="current-password" required maxlength="128" /></label>
    <button class="btn btn-secondary" :disabled="busy">发送邮箱验证邮件</button>
   </form>
   <form @submit.prevent="act(true)">
    <label class="field"><span>邮件中的32位验证码（复制粘贴）</span><input class="input" v-model="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required minlength="32" maxlength="32" /></label>
    <button class="btn btn-primary" :disabled="busy">验证邮箱</button>
   </form>
   <p class="muted">邮件可能进入垃圾箱，重新发送需间隔60秒。请不要分享验证码。</p>
  </template>
  <p v-else>请联系管理员核验并绑定可用邮箱。</p>
  <p v-if="notice" role="status">{{ notice }}</p><p v-if="error" class="error" role="alert">{{ error }}</p>
 </section>
</template>
<style scoped>form{display:grid;gap:12px;margin:18px 0}.field{display:grid;gap:8px}p{overflow-wrap:anywhere}</style>
