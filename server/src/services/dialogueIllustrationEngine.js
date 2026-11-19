import { z } from 'zod'

export const COMIC_STYLE = 'Create one polished storybook comic panel, with cohesive characters and scenery. Use natural, restrained low-to-moderate saturation colors and soft balanced lighting. Clean deliberate linework, smooth refined surfaces, clear facial expressions and readable actions. Choose colors to suit the scene; no fixed palette. No rough sketch, noise, grain, garish neon, oversaturation, text, speech bubbles, watermarks or collage. Maintain the supplied cast descriptions across this story.'

const updateSchema = z.object({
  changed: z.literal(true), topicKey: z.string().regex(/^[a-z0-9-]{1,80}$/),
  description: z.string().trim().min(10).max(1000), caption: z.string().trim().min(1).max(300),
})
export function visualUpdate(raw) {
  const result = updateSchema.safeParse(raw)
  return result.success ? result.data : null
}
export function canAddPanel(context, update, turn) {
  return Boolean(context?.enabled && update && context.count < 6 && turn - context.lastTurn >= 2 && update.topicKey !== context.topicKey)
}
export function castFor(scene) {
  return `Keep the same two adult characters throughout: learner (${scene.userRole || 'a visitor'}) wears a muted blue casual jacket; conversation partner (${scene.role}) wears a soft green top or appropriate uniform. Keep their hair, age, clothing and appearance consistent. Setting: ${scene.location || scene.title}.`
}
export function openingPanel(scene) {
  return { topicKey: 'opening', caption: scene.title.slice(0, 300),
    description: JSON.stringify({ location: scene.location, characters: [scene.userRole, scene.role], task: scene.task, opening: scene.opening }).slice(0, 1800) }
}
