import {BASE_URL} from '../api/client.js'
const memory=new Map()
const memoryOnly=new Set()
let database
export function recordingKey(userId,sessionId,turn){
 if(![userId,sessionId,turn].every(n=>Number.isSafeInteger(Number(n))&&Number(n)>0))throw new Error('录音所属账号或练习无效')
 return JSON.stringify([BASE_URL,Number(userId),Number(sessionId),Number(turn)])
}
async function open(){
 if(typeof indexedDB==='undefined')throw new Error('浏览器不支持本机录音存储')
 if(!database)database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('beileme-dialogue-recordings',1)
  request.onupgradeneeded=()=>request.result.createObjectStore('clips',{keyPath:'key'})
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)
 }).catch(error=>{database=null;throw error})
 return database
}
async function operation(mode,action){
 const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('clips',mode),request=action(tx.objectStore('clips'))
  tx.oncomplete=()=>resolve(request.result);tx.onabort=tx.onerror=()=>reject(tx.error||request.error||new Error('录音存储失败'))
 })
}
export async function saveDialogueRecording(userId,sessionId,turn,clips){
 const key=recordingKey(userId,sessionId,turn)
 if(!clips.length||clips.some(c=>!(c.blob instanceof Blob)||!c.blob.type.startsWith('audio/')||c.blob.size>2097152))throw new Error('录音格式或大小无效')
 const value={key,clips,createdAt:Date.now()};memory.set(key,value)
 try{await operation('readwrite',store=>store.put(value));memoryOnly.delete(key);return {persistent:true}}catch{memoryOnly.add(key);return {persistent:false}}
}
export async function readDialogueRecording(userId,sessionId,turn){
 const key=recordingKey(userId,sessionId,turn)
 if(memory.has(key))return memory.get(key)
 try{return await operation('readonly',store=>store.get(key))||null}catch{return null}
}
export async function deleteDialogueRecording(userId,sessionId,turn){
 const key=recordingKey(userId,sessionId,turn)
 // If durable removal fails, retain the player so the user can retry.
 try{await operation('readwrite',store=>store.delete(key))}catch(error){if(!memoryOnly.has(key))throw error}
 memory.delete(key);memoryOnly.delete(key)
}
export function releaseRecordingMemory(userId,sessionId){
 for(const key of memory.keys()){const [,owner,session]=JSON.parse(key);if(owner===Number(userId)&&session===Number(sessionId)){memory.delete(key);memoryOnly.delete(key)}}
}
