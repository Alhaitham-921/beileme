export const fixedTabs = [
  { id:'today',to:'/',icon:'home',label:'今日',pages:['/study','/assessment'] },
]
export const navigationModules = [
  {id:'library',to:'/library',icon:'book',label:'听读空间'},
  {id:'notebooks',to:'/notebooks',icon:'book',label:'单词本',pages:['/recall']},
  {id:'practice',to:'/practice',icon:'chat',label:'情境'},
  {id:'more',to:'/more',icon:'menu',label:'更多'},
  {id:'lookup',to:'/lookup',icon:'search',label:'查词'},
  {id:'review',to:'/review',icon:'repeat',label:'温故知新'},
  {id:'roots',to:'/roots',icon:'layers',label:'词根词缀'},
  {id:'dashboard',to:'/dashboard',icon:'chart',label:'学习足迹'},
  {id:'leaderboard',to:'/leaderboard',icon:'trophy',label:'学习排行'},
  {id:'settings',to:'/settings',icon:'settings',label:'设置'},
]
export const mainNavigation = [
  {...fixedTabs[0],caption:'TODAY'},
  ...['lookup','review','notebooks','practice','library','roots','dashboard','leaderboard'].map(id=>navigationModules.find(module=>module.id===id)),
]
export const defaultTabIds = ['notebooks','practice','leaderboard','more']
export function normalizeTabIds(value) {
  const valid = new Set(navigationModules.map(m=>m.id)), used = new Set()
  const reserved = new Set(Array.isArray(value) ? value.slice(0,4).filter(id=>valid.has(id)) : [])
  return [0,1,2,3].map(index=>{
    const id=Array.isArray(value)?value[index]:null
    const next=valid.has(id)&&!used.has(id)?id:[...defaultTabIds,...valid].find(candidate=>!used.has(candidate)&&!reserved.has(candidate))
    used.add(next);return next
  })
}
export function drawerSwipe({startX,startY,endX,endY,elapsedMs,direction='open'}) {
  const dx=(endX-startX)*(direction==='close'?-1:1),dy=Math.abs(endY-startY)
  return elapsedMs<=800 && dx>=64 && dx>dy*1.6 && dy<80
}
export function tabMatches(tab,path) {
  return path===tab.to || (tab.to!=='/'&&path.startsWith(tab.to+'/')) || (tab.pages||[]).some(p=>path===p||path.startsWith(p+'/'))
}
