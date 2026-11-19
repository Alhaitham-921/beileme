import {ref,computed} from 'vue'
import {fixedTabs,navigationModules,defaultTabIds,normalizeTabIds} from '../utils/androidNavigation.js'
export const selectedTabIds=ref([...defaultTabIds])
let account=null
const key=()=>account?`beileme:android-tabs:${account}`:null
export function initializeNavigation(id){
  const next=id?String(id):null;if(next===account)return
  account=next
  try{selectedTabIds.value=normalizeTabIds(key()?JSON.parse(localStorage.getItem(key())||'null'):null)}catch{selectedTabIds.value=[...defaultTabIds]}
}
export function saveNavigation(ids){
  selectedTabIds.value=normalizeTabIds(ids)
  try{if(key())localStorage.setItem(key(),JSON.stringify(selectedTabIds.value));return true}catch{return false}
}
export const androidTabs=computed(()=>[...fixedTabs,...selectedTabIds.value.map(id=>navigationModules.find(m=>m.id===id))])
