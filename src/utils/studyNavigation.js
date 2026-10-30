/** Revisit a completed card without submitting another answer or inventing old SRS data. */
export function studyAnswerForItem(item) {
  if (!item?.answered) return null
  if (item.answerResult) return item.answerResult
  return {
    isCorrect: item.correct,
    correctText: Array.isArray(item.word?.definitions) ? item.word.definitions.join('；') : '',
    analysis: {},
    progress: null,
    restored: true,
  }
}
