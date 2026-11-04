export function toggleCollectionIds(selected, ids, checked) {
  const next = new Set(selected)
  for (const raw of ids) {
    const id = Number(raw)
    if (!Number.isSafeInteger(id) || id <= 0) continue
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}
export function allCollectionIdsSelected(selected, ids) {
  return ids.length > 0 && ids.every(id => selected.has(Number(id)))
}
