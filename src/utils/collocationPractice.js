const ignored = new Set(['a', 'an', 'the', 'be', 'to', 'somebody', 'something', 'someone', 'one'])
const normalize = text => String(text || '').normalize('NFKC').replace(/[’‘]/g, "'").trim().replace(/\s+/g, ' ').toLowerCase()
const irregular = { be: ['am','is','are','was','were','been','being'], have: ['has','had'], do: ['does','did','done'],
  go: ['goes','went','gone'], make: ['made'], take: ['took','taken'], get: ['got','gotten'], give: ['gave','given'],
  see: ['saw','seen'], write: ['wrote','written'], speak: ['spoke','spoken'], buy: ['bought'], think: ['thought'],
  teach: ['taught'], learn: ['learnt'], find: ['found'], bring: ['brought'], build: ['built'], feel: ['felt'],
  leave: ['left'], keep: ['kept'], meet: ['met'], pay: ['paid'], run: ['ran','running'], say: ['said'],
  sell: ['sold'], send: ['sent'], stand: ['stood'], understand: ['understood'], choose: ['chose','chosen'] }

/** Recall a partner word from a previously displayed phrase. No invented distractors. */
export function buildCollocationQuestions(phrases, spelling) {
  const target = normalize(spelling)
  if (!target) return []
  const variants = [target, target+'s', target+'es', target+'ed', target+'ing', ...(Object.hasOwn(irregular,target) ? irregular[target] : [])]
  if (target.endsWith('e')) variants.push(target+'d', target.slice(0,-1)+'ing')
  if (target.endsWith('y')) variants.push(target.slice(0,-1)+'ies', target.slice(0,-1)+'ied')
  if (/[aeiou][b-df-hj-np-tv-z]$/.test(target)) variants.push(target+target.at(-1)+'ed', target+target.at(-1)+'ing')
  const escaped = variants.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp('(?<![a-z])(?:' + escaped + ')(?![a-z])', 'i')
  const seen = new Set()
  return phrases.flatMap(item => {
    if (!item || typeof item.phrase !== 'string' || !/\p{Script=Han}/u.test(item.translation || '')) return []
    const phrase = item.phrase.trim()
    const key = normalize(phrase)
    const match = pattern.exec(phrase)
    if (!match || seen.has(key) || phrase.split(/\s+/).length < 2) return []
    const tokens = [...phrase.matchAll(/[a-z]+(?:[’'][a-z]+)*/gi)]
      .filter(token => token.index + token[0].length <= match.index || token.index >= match.index + match[0].length)
    const chosen = tokens.find(token => !ignored.has(normalize(token[0])))
    if (!chosen) return []
    seen.add(key)
    return [{ phrase, translation: item.translation, answer: chosen[0],
      prompt: phrase.slice(0, chosen.index) + '____' + phrase.slice(chosen.index + chosen[0].length) }]
  }).slice(0, 6)
}

export const matchesCollocationAnswer = (input, answer) => normalize(input) === normalize(answer)
