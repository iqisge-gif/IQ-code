import type { LocalCommandCall } from '../../types/command.js'
import {
  formatCustomApiProviderIndex,
  getCustomApiProviderByIndex,
  updateCustomApiProviders,
} from '../../utils/customApiStorage.js'

function parseRemoveModelArgs(args: string): { providerIndex: number; modelId: string } | null {
  const trimmed = args.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) {
    return { providerIndex: 0, modelId: parts[0] }
  }
  const first = Number(parts[0])
  if (Number.isInteger(first) && first > 0) {
    return { providerIndex: first - 1, modelId: parts.slice(1).join(' ').trim() }
  }
  return { providerIndex: 0, modelId: trimmed }
}

export const call: LocalCommandCall = async (args, _context) => {
  const parsed = parseRemoveModelArgs(args)
  if (!parsed?.modelId) {
    return {
      type: 'text',
      value: 'Usage: /remove-model [provider-number] <model-id>',
    }
  }

  const targetProvider = getCustomApiProviderByIndex(parsed.providerIndex)
  if (!targetProvider) {
    return {
      type: 'text',
      value: `Provider not found: ${parsed.providerIndex + 1}`,
    }
  }
  const savedModels = targetProvider.savedModels ?? []
  if (!savedModels.includes(parsed.modelId)) {
    return {
      type: 'text',
      value: `Model not found in ${targetProvider.name}: ${parsed.modelId}`,
    }
  }

  const remainingModels = savedModels.filter(model => model !== parsed.modelId)
  const nextCurrentModel = targetProvider.model === parsed.modelId ? (remainingModels[0] ?? undefined) : targetProvider.model

  const nextStorage = updateCustomApiProviders(current => ({
    ...current,
    providers: (current.providers ?? []).map(provider =>
      provider.id === targetProvider.id
        ? {
            ...provider,
            model: nextCurrentModel,
            savedModels: remainingModels,
          }
        : provider,
    ),
  }))

  if (nextStorage.currentProviderId === targetProvider.id) {
    if (nextCurrentModel) {
      process.env.ANTHROPIC_MODEL = nextCurrentModel
    } else {
      delete process.env.ANTHROPIC_MODEL
    }
  }

  return {
    type: 'text',
    value: `Removed model ${parsed.modelId} from ${targetProvider.name} (${formatCustomApiProviderIndex(parsed.providerIndex)})`,
  }
}
