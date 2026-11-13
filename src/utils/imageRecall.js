import { IMAGE_RECALL_EXAMPLES } from '../data/imageRecallExamples.js'

const fold = value => value.normalize('NFKC').toLowerCase().trim()
const meanings = sense => fold(sense).split(/[；;、，,\/]/u)
  .map(part => part.replace(/[\s\p{P}]/gu, '')).filter(Boolean)
const overlaps = (a, b) => meanings(a).some(x => meanings(b).some(y =>
  x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)))))
// These scenes can reasonably suggest each other's answer without a caption.
const ambiguousExamples = [['break', 'fragile'], ['spill', 'pour'], ['absorb', 'spill']]

function shuffle(items, random) {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function buildImageRecallRounds(saved, random = Math.random, replacements = []) {
  const personal = saved.map(item => ({ ...item, key: item.imagePath }))
  const replacementsByKey = new Map(replacements.map(item => [item.exampleKey, item]))
  const examples = IMAGE_RECALL_EXAMPLES.map(item => {
    const replacement = replacementsByKey.get(item.key)
    return replacement?.imagePath
      ? { ...item, imagePath: replacement.imagePath, explanation: replacement.explanation, url: undefined }
      : item
  })
  const source = personal.length ? personal : examples
  const groups = new Map()
  for (const picture of source) {
    const key = fold(picture.spelling)
    const group = groups.get(key) || []
    if (!group.some(other => overlaps(other.sense, picture.sense))) group.push(picture)
    groups.set(key, group)
  }
  return shuffle([...groups], random).slice(0, 5).flatMap(([word, group]) => {
    const correct = shuffle(group, random).slice(0, 3)
    const targetMeanings = source.filter(item => fold(item.spelling) === word)
      .flatMap(item => item.definitions || [item.sense])
    const wrong = []
    const candidates = personal.length
      ? [...shuffle(personal, random), ...shuffle(examples, random)]
      : shuffle(examples, random)
    for (const picture of candidates) {
      if (fold(picture.spelling) === word || wrong.some(item => fold(item.spelling) === fold(picture.spelling))) continue
      if (ambiguousExamples.some(pair => pair.includes(word) && pair.includes(fold(picture.spelling)))) continue
      if (targetMeanings.some(sense => overlaps(sense, picture.sense)) ||
          wrong.some(item => overlaps(item.sense, picture.sense))) continue
      wrong.push(picture)
      if (wrong.length === 9 - correct.length) break
    }
    if (correct.length + wrong.length !== 9) return []
    return [{
      spelling: correct[0].spelling,
      options: shuffle([...correct.map(item => ({ ...item, correct: true })),
        ...wrong.map(item => ({ ...item, correct: false }))], random),
    }]
  })
}

export function matchesImageRecall(round, selected) {
  return round.options.every(option => option.correct === selected.includes(option.key))
}
