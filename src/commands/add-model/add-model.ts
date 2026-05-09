import type { LocalCommandCall } from '../../types/command.js'
import {
  createCustomApiProviderEntry,
  formatCustomApiProviderIndex,
  getCustomApiProviderByIndex,
  persistCustomApiProviders,
  readCustomApiProvidersStorage,
  updateCustomApiProviders,
} from '../../utils/customApiStorage.js'

function parseAddModelArgs(args: string): { providerIndex: number; modelId: string } | null {
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
  const parsed = parseAddModelArgs(args)
  if (!parsed?.modelId) {
    return {
      type: 'text',
      value: 'Usage: /add-model [provider-number] <model-id>',
    }
  }

  let targetProvider = getCustomApiProviderByIndex(parsed.providerIndex)
  if (!targetProvider && parsed.providerIndex === 0) {
    const current = readCustomApiProvidersStorage()
    const createdProvider = createCustomApiProviderEntry(0)
    persistCustomApiProviders({
      currentProviderId: current.currentProviderId ?? createdProvider.id,
      providers: [createdProvider, ...(current.providers ?? [])],
    })
    targetProvider = createdProvider
  }
  if (!targetProvider) {
    return {
      type: 'text',
      value: `Provider not found: ${parsed.providerIndex + 1}`,
    }
  }

  const nextStorage = updateCustomApiProviders(current => ({
    ...current,
    providers: (current.providers ?? []).map(provider =>
      provider.id === targetProvider?.id
        ? {
            ...provider,
            model: parsed.modelId,
            savedModels: [...new Set([...(provider.savedModels ?? []), parsed.modelId])],
          }
        : provider,
    ),
  }))
  const nextProvider = nextStorage.providers?.find(provider => provider.id === targetProvider.id) ?? targetProvider
  if (nextStorage.currentProviderId === targetProvider.id) {
    process.env.ANTHROPIC_MODEL = parsed.modelId
  }

  return {
    type: 'text',
    value: `Added model ${parsed.modelId} to ${nextProvider.name} (${formatCustomApiProviderIndex(parsed.providerIndex)})`,
  }
}
