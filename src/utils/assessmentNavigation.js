/** Keep the visible question until its answer is saved and continuation is requested. */
export function createAssessmentNavigation({ state, submit, now = () => performance.now(), onAdvance = () => {} }) {
  let generation = 0
  let request = null
  let shownAt = now()

  function reset(session) {
    generation++
    request = null
    shownAt = now()
    Object.assign(state, { session, selected: null, pending: null, busy: false, error: '', continueRequested: false })
  }

  function advance() {
    if (state.selected === null || state.error) return
    if (state.busy) { state.continueRequested = true; return }
    if (!state.pending) return
    const next = state.pending
    reset(next)
    onAdvance(next)
  }

  async function save() {
    if (!request || state.busy || state.pending) return
    const currentGeneration = generation
    const currentRequest = request
    state.busy = true
    state.error = ''
    try {
      const next = await submit(currentRequest.sessionId, { ...currentRequest.body })
      if (currentGeneration !== generation) return
      state.pending = next
    } catch (e) {
      if (currentGeneration !== generation) return
      state.error = e.message || '保存失败，请重试'
      // A failed attempt never carries a queued continuation into its retry.
      state.continueRequested = false
    } finally {
      if (currentGeneration === generation) {
        state.busy = false
        if (state.continueRequested && state.pending) advance()
      }
    }
  }

  function answer(selectedIndex) {
    if (state.busy || state.selected !== null || !state.session?.question) return
    const { session } = state
    if (selectedIndex !== -1 && (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= session.question.options.length)) return
    state.selected = selectedIndex
    request = {
      sessionId: session.id,
      body: { wordId: session.question.wordId, selectedIndex, rtMs: Math.max(0, Math.min(3600000, Math.round(now() - shownAt))) },
    }
    return save()
  }

  function retry() {
    if (!state.error || state.selected === null) return
    return save()
  }

  function dispose() {
    generation++
    request = null
  }

  return { reset, answer, advance, retry, dispose }
}
