import { computed, ref } from 'vue'

const pending = ref(0)
export const navigating = ref(false)
export const hasActivity = computed(() => navigating.value || pending.value > 0)

// Each request owns its release function, including retries and cancellations.
export function beginRequest() {
  pending.value++
  let finished = false
  return () => {
    if (finished) return
    finished = true
    pending.value--
  }
}
