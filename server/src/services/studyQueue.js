import { clamp } from '../utils/json.js'
export async function selectDailyWords({ plan, studyMode = 'review-first', listDue, listFresh, maxSize = 60 }) {
  if (!['review-first', 'review-only', 'new-only'].includes(studyMode)) throw new Error('Unknown study mode')
  if (studyMode === 'review-only') {
    // Each group starts at the head of the live due list; answered words leave it via SRS.
    const limit = clamp(maxSize, 0, 10)
    const reviews = limit > 0 ? await listDue(limit) : []
    return reviews.map(row => ({ row, kind: 'review' }))
  }
  const reviews = studyMode === 'new-only' ? [] : await listDue(clamp(plan.reviewTarget-plan.reviewDone,0,maxSize))
  const fresh = await listFresh(clamp(plan.newTarget-plan.newDone,0,Math.max(0,maxSize-reviews.length)))
  return [...reviews.map(row=>({row,kind:'review'})),...fresh.map(row=>({row,kind:'new'}))]
}
