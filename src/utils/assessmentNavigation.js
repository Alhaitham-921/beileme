export function createAssessmentNavigation({ state, submit, now = () => performance.now(), onAdvance = () => {} }) {
  let generation = 0
  let queue = []
  let pendingSave
  let shownAt = now()

  function show(session) {
    if (session?.question?.wordId !== state.session?.question?.wordId || session?.id !== state.session?.id) {
      shownAt = now()
    }
    state.session = session
    state.selected = null
  }

  function reset(session) {
    generation++
    queue = []
    pendingSave = undefined
    show(session)
    shownAt = now()
    Object.assign(state, { saving: false, error: '', needsReload: false })
  }

  function preview(session) {
    show({ ...session, answered: session.answered + 1, question: session.upcoming, upcoming: null })
  }

  async function save() {
    if (!queue.length || state.saving) return
    const currentGeneration = generation
    const { sessionId, body } = queue[0]
    state.saving = true
    state.error = ''
    try {
      const next = await submit(sessionId, body)
      if (currentGeneration !== generation) return
      queue.shift()
      if (!queue.length) {
        show(next)
        onAdvance(next)
      } else if (next.question?.wordId !== queue[0].body.wordId) {
        // Another tab may have moved past the preview while this request was in flight.
        reset(next)
        onAdvance(next)
        return
      } else if (next.upcoming) {
        preview(next)
      }
    } catch (error) {
      if (currentGeneration !== generation) return
      state.error = error.message || '保存失败，请重试'
      state.needsReload = error.status === 409
    } finally {
      if (currentGeneration === generation) state.saving = false
    }
    if (currentGeneration === generation && !state.error && queue.length) return save()
  }

  function answer(selectedIndex) {
    const { session } = state
    if (state.error || state.selected !== null || !session?.question) return
    if (selectedIndex !== -1 && (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= session.question.options.length)) return
    queue.push({
      sessionId: session.id,
      body: { wordId: session.question.wordId, selectedIndex, rtMs: Math.max(0, Math.min(3600000, Math.round(now() - shownAt))) },
    })
    if (session.upcoming) preview(session)
    else state.selected = selectedIndex
    return startSaving()
  }

  function startSaving() {
    if (!state.saving) pendingSave = save()
    return pendingSave
  }

  function retry() {
    if (state.error && !state.needsReload) return startSaving()
  }

  function dispose() {
    generation++
    queue = []
  }

  return { reset, answer, retry, dispose, whenSaved: () => pendingSave }
}
