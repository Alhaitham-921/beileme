import http, { BASE_URL, getAccessToken } from './client.js'
import { Capacitor } from '@capacitor/core'
const nativeSession=Capacitor.getPlatform()==='android'

export const requestKey = () => crypto.randomUUID()
export const ielts = {
  overview:()=>http.get('/ielts/overview'),
  catalog:skill=>http.get('/ielts/papers',{query:skill?{skill}:undefined}),
  profile:()=>http.get('/ielts/profile'),
  saveProfile:body=>http.put('/ielts/profile',{body}),
  start:body=>http.post('/ielts/attempts',{body}),
  attempt:id=>http.get(`/ielts/attempts/${id}`),
  save:(id,body)=>http.put(`/ielts/attempts/${id}`,{body}),
  versions:id=>http.get(`/ielts/attempts/${id}/versions`),
  feedback:(id,requestKey)=>http.post(`/ielts/attempts/${id}/feedback`,{body:{requestKey}}),
  latestFeedback:id=>http.get(`/ielts/attempts/${id}/feedback`),
  job:id=>http.get(`/ielts/jobs/${id}`),
  cancelJob:id=>http.post(`/ielts/jobs/${id}/cancel`),
  access:()=>http.get('/ielts/access'),
  saveAccess:body=>http.put('/ielts/access',{body}),
  suggestion:(id,state)=>http.put(`/ielts/suggestions/${id}`,{body:{state}}),
  materials:()=>http.get('/ielts/materials'),
  saveMaterial:body=>http.post('/ielts/materials',{body}),
  vocabulary:ability=>http.get('/ielts/vocabulary',{query:{ability}}),
  vocabularyAnswer:body=>http.post('/ielts/vocabulary/answers',{body}),
  recordings:id=>http.get(`/ielts/attempts/${id}/recordings`),
  claimAudio:(id,sectionId)=>http.post(`/ielts/attempts/${id}/audio-plays`,{body:{sectionId}}),
  transcribe:(id,requestKey)=>http.post(`/ielts/recordings/${id}/transcribe`,{body:{requestKey},timeoutMs:90000}),
  adminCatalog:()=>http.get('/ielts/admin/papers'),
  adminPaper:id=>http.get(`/ielts/admin/papers/${id}`),
  saveDraft:body=>http.post('/ielts/admin/papers',{body}),
  review:(id,body)=>http.post(`/ielts/admin/papers/${id}/review`,{body}),
  grant:body=>http.post('/ielts/admin/credits',{body})
}
function mediaHeaders() { const token=getAccessToken();return token?{Authorization:`Bearer ${token}`} : {} }
export async function fetchMedia(path) {
  const relative=path.replace(/^\/api\/v1/,'')
  const response=await fetch(`${BASE_URL}${relative}`,{headers:mediaHeaders(),credentials:nativeSession?'omit':'include'})
  if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.error?.message||'音频暂时无法加载')}
  return URL.createObjectURL(await response.blob())
}
export async function uploadRecording(attemptId,questionId,blob) {
  const response=await fetch(`${BASE_URL}/ielts/attempts/${attemptId}/recordings/${questionId}`,{method:'POST',headers:{...mediaHeaders(),'Content-Type':blob.type,'X-Recording-Consent':'yes'},body:blob,credentials:nativeSession?'omit':'include'})
  const data=await response.json()
  if(!response.ok)throw new Error(data.error?.message||'录音保存失败')
  return data.data
}
export default ielts
