import { buildUsageReport } from './costEstimate.js'

export function emptyUsage() {
  return { promptTokens: 0, completionTokens: 0, calls: 0, unknownCalls: 0 }
}

export function addUsage(total, usage, model) {
  if (usage && usage.reported !== false) {
    total.promptTokens += Number(usage.promptTokens || 0)
    total.completionTokens += Number(usage.completionTokens || 0)
  } else total.unknownCalls = (total.unknownCalls || 0) + 1
  total.calls += 1
  if (model) total.model = model
  return total
}

export function usageReport(total, provider) {
  return { ...buildUsageReport({ ...total, source: provider.source, model: total.model || provider.model }), calls: total.calls, unknownCalls: total.unknownCalls || 0 }
}
