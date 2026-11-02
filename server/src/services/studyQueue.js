import { clamp } from '../utils/json.js'
export async function selectDailyWords({ plan, studyMode = 'review-first', listDue, listFresh, maxSize = 60 }) {
  if (!['review-first', 'new-only'].includes(studyMode)) throw new Error('Unknown study mode')
  const reviews = studyMode === 'new-only' ? [] : await listDue(clamp(plan.reviewTarget-plan.reviewDone,0,maxSize))
  const fresh = await listFresh(clamp(plan.newTarget-plan.newDone,0,Math.max(0,maxSize-reviews.length)))
  return [...reviews.map(row=>({row,kind:'review'})),...fresh.map(row=>({row,kind:'new'}))]
}
