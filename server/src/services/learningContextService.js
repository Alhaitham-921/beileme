import { loadWordEvidence, loadPracticeTotals } from '../repositories/learningEvidenceRepository.js'

/** Shared, bounded read model. Each consumer keeps its own learning decisions. */
export async function loadLearningContext({ userId, bookId, wordIds = [], since, until, frozenLearning = null, frozenEvidence = null }) {
  const ids = [...new Set(wordIds)]
  if(ids.length>200)throw new RangeError('学习上下文单次最多关联200个词')
  const [learning, wordEvidence] = await Promise.all([
    frozenLearning || loadPracticeTotals(userId, bookId, since, until),
    frozenEvidence || loadWordEvidence(userId, bookId, ids, since, until),
  ])
  return { learning, wordEvidence }
}
