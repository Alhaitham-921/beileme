<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { http } from '../api/client.js'
import { useAuthStore } from '../stores/auth.js'
import UserAvatar from './UserAvatar.vue'
const auth = useAuthStore(), busy = ref(false), notice = ref(''), error = ref(''), preview = ref(''), encoded = ref('')
let alive = true
function clearPreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value=''; encoded.value='' }
onBeforeUnmount(() => { alive = false; clearPreview() })
const dataUrl = blob => new Promise((resolve, reject) => { const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob) })
async function choose(event) {
  const file = event.target.files?.[0]; event.target.value=''
  if (!file || busy.value) return
  error.value=''; notice.value=''; busy.value=true
  let source
  try {
    if (file.size > 8*1024*1024) throw new Error('请选择小于 8 MB 的图片。')
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
    source=URL.createObjectURL(file)
    const picture=new Image()
    await new Promise((resolve,reject)=>{picture.onload=resolve;picture.onerror=()=>reject(new Error('无法读取这张图片，请换一张。'));picture.src=source})
    if (picture.naturalWidth*picture.naturalHeight>20_000_000) throw new Error('图片尺寸过大，请先缩小后上传。')
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256
    const side=Math.min(picture.naturalWidth,picture.naturalHeight)
    canvas.getContext('2d').drawImage(picture,(picture.naturalWidth-side)/2,(picture.naturalHeight-side)/2,side,side,0,0,256,256)
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88))
    if (!blob) throw new Error('图片处理失败，请换一张。')
    const value=await dataUrl(blob)
    if (!alive) return
    clearPreview();preview.value=URL.createObjectURL(blob);encoded.value=value
  } catch (e) { if (alive) error.value=e.message }
  finally { if (source) URL.revokeObjectURL(source);if(alive)busy.value=false }
}
async function save(remove=false) {
  if (busy.value) return
  busy.value=true;error.value='';notice.value=''
  try {
    const result=remove?await http.del('/profile/avatar'):await http.put('/profile/avatar',{body:{image:encoded.value}})
    if (!alive) return
    auth.user={...auth.user,avatarUrl:result.avatarUrl};clearPreview();notice.value=remove?'已恢复默认头像。':'头像已保存，会同步到排行榜。'
  } catch(e) { if(alive)error.value=e.message }
  finally { if(alive)busy.value=false }
}
</script>
<template>
  <section class="card avatar-settings" aria-label="自定义头像">
    <div class="avatar-heading"><img v-if="preview" :src="preview" class="avatar-preview" alt="新头像预览"/><UserAvatar v-else :src="auth.user?.avatarUrl" :label="auth.displayName"/><div><h2>我的头像</h2><p class="muted">头像会显示在学习排行榜和个人侧栏，跨设备同步。</p></div></div>
    <p class="muted">支持 JPG、PNG、WebP，最大 8 MB。图片会居中裁为方形，确认预览后保存。</p>
    <div class="avatar-actions"><label class="btn btn-ghost" :class="{'is-disabled':busy}">选择图片<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="choose" /></label><button v-if="preview" class="btn btn-primary" :disabled="busy" :aria-busy="busy" @click="save()">保存头像</button><button v-if="preview" class="btn btn-quiet" :disabled="busy" @click="clearPreview">取消</button><button v-else-if="auth.user?.avatarUrl" class="btn btn-quiet" :disabled="busy" @click="save(true)">恢复默认头像</button></div>
    <LoadingState v-if="busy">正在处理头像…</LoadingState><p v-if="notice" role="status">{{notice}}</p><p v-if="error" class="avatar-error" role="alert">{{error}}</p>
  </section>
</template>
<style scoped>
.avatar-settings{margin:16px 0}.avatar-heading{display:flex;align-items:center;gap:16px}.avatar-heading .user-avatar,.avatar-preview{width:64px;height:64px;border-radius:50%;object-fit:cover;flex:none}.avatar-settings h2{font-size:19px;margin:0 0 8px}.avatar-settings p{font-size:12px;line-height:1.8}.avatar-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}.avatar-actions label{position:relative;overflow:hidden}.avatar-actions input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}.avatar-actions label:focus-within{outline:2px solid var(--accent);outline-offset:3px}.avatar-actions .is-disabled{opacity:.5}.avatar-error{color:var(--bad)}
</style>
