import {query} from '../db/pool.js'
import {todayKey,businessDayStartUtc,addDays} from '../utils/time.js'
import {avatarUrl} from './avatarService.js'

/** Learning volume, never a claim of mastery: distinct spelling across books. */
export async function getLeaderboard(userId,{period='total'}={}){
  const date=todayKey(),params=[]
  let time=''
  if(period==='daily'){time='AND a.created_at>=? AND a.created_at<?';params.push(businessDayStartUtc(date),businessDayStartUtc(addDays(date,1)))}
  const rows=await query(`WITH counts AS (
    SELECT a.user_id,COUNT(DISTINCT w.spelling_norm) word_count
    FROM answer_logs a JOIN words w ON w.id=a.word_id
    WHERE a.source IN ('study','review') ${time} GROUP BY a.user_id
  ), ranked AS (
    SELECT user_id,word_count,RANK() OVER(ORDER BY word_count DESC) place FROM counts WHERE word_count>0
  ), numbered AS (
    SELECT *,ROW_NUMBER() OVER(ORDER BY word_count DESC,user_id) position,COUNT(*) OVER() participants FROM ranked
  ) SELECT n.*,u.avatar_revision FROM numbered n JOIN users u ON u.id=n.user_id
    WHERE position<=50 OR user_id=? ORDER BY position`,[...params,userId])
  const present=row=>({rank:Number(row.place),words:Number(row.word_count),name:Number(row.user_id)===Number(userId)?'我':`学习者·${String(row.user_id).padStart(4,'0')}`,isMe:Number(row.user_id)===Number(userId),avatarUrl:avatarUrl(row.user_id,row.avatar_revision)})
  const me=rows.find(row=>Number(row.user_id)===Number(userId))
  return {period,date:period==='daily'?date:null,participants:Number(rows[0]?.participants||0),
    items:rows.filter(row=>Number(row.position)<=50).map(present),me:me?present(me):{rank:null,words:0,name:'我',isMe:true,avatarUrl:null},
    rule:period==='daily'?'按北京时间当天实际作答过的新词和复习词统计，同词跨词书、重复作答均只计一次。':'累计实际作答过的不同单词数，同词跨词书去重。学习量不等于已掌握词汇量。'}
}
