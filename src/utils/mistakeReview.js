export function startMistakeReview(items) {
  return {
    queue: items.map(item => ({ item, step: 1, attempt: 1 })),
    index: 0,
    nextRound: [],
    completed: 0,
  }
}

export function advanceMistakeReview(state, correct) {
  const entry = state.queue[state.index]
  if (!entry) return state

  const finished = correct && entry.step === 3
  const completed = state.completed + Number(finished)
  const nextRound = finished ? state.nextRound : [...state.nextRound, {
    item: entry.item,
    step: correct ? entry.step + 1 : 1,
    attempt: entry.attempt + Number(!correct),
  }]
  const index = state.index + 1
  if (index < state.queue.length) return { ...state, index, nextRound, completed }

  // Every unfinished word gets one task per pass. Later steps come before restarts.
  return {
    queue: [...nextRound].sort((a, b) => b.step - a.step),
    index: 0,
    nextRound: [],
    completed,
  }
}
