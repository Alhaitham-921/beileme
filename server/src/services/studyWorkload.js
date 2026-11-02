import { queryOne } from '../db/pool.js'
import { getOrCreateDailyPlan,countDueWords } from './planService.js'
export function taskCap(minutes, secondsPerWord=25){return minutes?Math.max(1,Math.min(60,Math.floor(minutes*60/Math.max(10,Math.min(60,secondsPerWord||25))))):60}
export async function studyWorkload(userId){
 const [plan,due,row]=await Promise.all([getOrCreateDailyPlan(userId),countDueWords(userId),queryOne('SELECT AVG(t.ms) average_ms FROM (SELECT hesitation_ms ms FROM answer_logs WHERE user_id=? AND hesitation_ms BETWEEN 1000 AND 120000 ORDER BY id DESC LIMIT 100) t',[userId])])
 const seconds=row?.average_ms?Math.max(10,Math.min(60,Number(row.average_ms)/1000)):25
 const newRemaining=Math.max(0,plan.newTarget-plan.newDone)
 return {plan,newRemaining,dueCount:due,secondsPerWord:Math.round(seconds),estimatedMinutes:Math.ceil((newRemaining+due)*seconds/60),recommendation:due>=Math.max(20,newRemaining*2)?'到期复习较多，可以先选5分钟小任务；也可以直接学新词。':'按自己的时间选择任务，未完成内容会保留。',caps:{5:taskCap(5,seconds),10:taskCap(10,seconds),full:60}}
}
