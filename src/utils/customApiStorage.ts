import { randomUUID } from 'crypto'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { normalizeApiKeyForConfig } from './authPortable.js'
import { getSecureStorage } from './secureStorage/index.js'

export type OpenAICompatMode = 'chat_completions' | 'responses'

export type CustomApiProvider = 'anthropic' | 'openai' | 'gemini' | 'deepseek'

export type CustomApiStorageData = {
  provider?: CustomApiProvider
  openaiCompatMode?: OpenAICompatMode
  baseURL?: string
  apiKey?: string
  model?: string
  savedModels?: string[]
}

export type CustomApiProviderEntry = {
  id: string
  name?: string
  provider?: CustomApiProvider
  openaiCompatMode?: OpenAICompatMode
  baseURL?: string
  apiKey?: string
  model?: string
  savedModels?: string[]
}

export type CustomApiProvidersStorageData = {
  currentProviderId?: string
  providers?: CustomApiProviderEntry[]
}

const CUSTOM_API_STORAGE_KEY = 'customApiEndpoint'
const DEFAULT_PROVIDER_NAME_PREFIX = 'Provider'

export function readCustomApiStorage(): CustomApiStorageData {
  const storage = getStorage()
  const data = storage.read?.() ?? {}
  const raw = data[CUSTOM_API_STORAGE_KEY]
  const providersObject = readProvidersObject(raw)
  if (providersObject) {
    const currentProvider =
      providersObject.providers?.find(provider => provider.id === providersObject.currentProviderId) ??
      providersObject.providers?.[0]
    return currentProvider
      ? {
          provider: currentProvider.provider,
          openaiCompatMode: currentProvider.openaiCompatMode,
          baseURL: currentProvider.baseURL,
          apiKey: currentProvider.apiKey,
          model: currentProvider.model,
          savedModels: currentProvider.savedModels ?? [],
        }
      : {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const value = raw as Record<string, unknown>
  const provider =
    value.provider === 'openai' || value.provider === 'anthropic' || value.provider === 'gemini' || value.provider === 'deepseek'
      ? value.provider
      : undefined
  const openaiCompatMode =
    value.openaiCompatMode === 'chat_completions' || value.openaiCompatMode === 'responses'
      ? value.openaiCompatMode
      : provider === 'openai' || provider === 'deepseek'
        ? 'chat_completions'
        : undefined

  return {
    provider,
    openaiCompatMode,
    baseURL: typeof value.baseURL === 'string' ? value.baseURL : undefined,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    savedModels: Array.isArray(value.savedModels)
      ? value.savedModels.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function getStorage() {
  return getSecureStorage() as {
    read?: () => Record<string, unknown> | null
    update?: (data: Record<string, unknown>) => { success: boolean }
  }
}

function isCustomApiProvider(value: unknown): value is CustomApiProvider {
  return value === 'openai' || value === 'anthropic' || value === 'gemini' || value === 'deepseek'
}

function isOpenAICompatMode(value: unknown): value is OpenAICompatMode {
  return value === 'chat_completions' || value === 'responses'
}

function normalizeSavedModels(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : []
}

function normalizeProviderEntry(value: unknown, fallbackIndex = 0): CustomApiProviderEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const provider = isCustomApiProvider(raw.provider) ? raw.provider : undefined
  const openaiCompatMode = isOpenAICompatMode(raw.openaiCompatMode)
    ? raw.openaiCompatMode
    : provider === 'openai' || provider === 'deepseek'
      ? 'chat_completions'
      : undefined
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `provider-${fallbackIndex + 1}-${randomUUID()}`
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined

  return {
    id,
    name,
    provider,
    openaiCompatMode,
    baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : undefined,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    savedModels: normalizeSavedModels(raw.savedModels),
  }
}

function getDefaultProviderName(index: number): string {
  return `${DEFAULT_PROVIDER_NAME_PREFIX} ${index + 1}`
}

function finalizeProviders(
  providers: CustomApiProviderEntry[],
  preferredCurrentProviderId?: string,
): CustomApiProvidersStorageData {
  const normalizedProviders = providers.map((provider, index) => ({
    ...provider,
    name: provider.name?.trim() || getDefaultProviderName(index),
    savedModels: [...new Set((provider.savedModels ?? []).map(model => model.trim()).filter(Boolean))],
  }))

  return {
    currentProviderId:
      preferredCurrentProviderId && normalizedProviders.some(provider => provider.id === preferredCurrentProviderId)
        ? preferredCurrentProviderId
        : normalizedProviders[0]?.id,
    providers: normalizedProviders,
  }
}

function convertLegacyConfigToProviderEntry(entry: CustomApiStorageData | undefined, fallbackName: string): CustomApiProviderEntry | null {
  if (!entry) return null
  const hasValue = Object.values(entry).some(value => Array.isArray(value) ? value.length > 0 : !!value)
  if (!hasValue) return null
  return {
    id: `provider-1-${randomUUID()}`,
    name: fallbackName,
    provider: entry.provider,
    openaiCompatMode: entry.openaiCompatMode,
    baseURL: entry.baseURL,
    apiKey: entry.apiKey,
    model: entry.model,
    savedModels: normalizeSavedModels(entry.savedModels),
  }
}

function readProvidersObject(value: unknown): CustomApiProvidersStorageData | null {
  if (!value || typeof value !== 'object' || !('providers' in (value as Record<string, unknown>))) {
    return null
  }
  const raw = value as Record<string, unknown>
  const providers = Array.isArray(raw.providers)
    ? raw.providers
        .map((provider, index) => normalizeProviderEntry(provider, index))
        .filter((provider): provider is CustomApiProviderEntry => provider !== null)
    : []

  return finalizeProviders(
    providers,
    typeof raw.currentProviderId === 'string' ? raw.currentProviderId : undefined,
  )
}

function mergeProviderSources(
  configProviders: CustomApiProviderEntry[],
  secureProviders: CustomApiProviderEntry[],
  preferredCurrentProviderId?: string,
): CustomApiProvidersStorageData {
  const secureById = new Map(secureProviders.map(provider => [provider.id, provider]))
  const mergedProviders = configProviders.map((provider, index) => {
    const secureProvider = secureById.get(provider.id)
    return {
      ...provider,
      apiKey: secureProvider?.apiKey ?? provider.apiKey,
      baseURL: secureProvider?.baseURL ?? provider.baseURL,
      model: secureProvider?.model ?? provider.model,
      savedModels: secureProvider?.savedModels ?? provider.savedModels ?? [],
      provider: secureProvider?.provider ?? provider.provider,
      openaiCompatMode: secureProvider?.openaiCompatMode ?? provider.openaiCompatMode,
      name: provider.name ?? secureProvider?.name ?? getDefaultProviderName(index),
    }
  })

  for (const secureProvider of secureProviders) {
    if (!mergedProviders.some(provider => provider.id === secureProvider.id)) {
      mergedProviders.push(secureProvider)
    }
  }

  return finalizeProviders(mergedProviders, preferredCurrentProviderId)
}

export function readCustomApiProvidersStorage(): CustomApiProvidersStorageData {
  const storage = getStorage()
  const data = storage.read?.() ?? {}
  const secureProvidersObject = readProvidersObject(data[CUSTOM_API_STORAGE_KEY])
  const config = getGlobalConfig()
  const configProviders = finalizeProviders(
    (config.customApiProviders ?? []).map((provider, index) => ({
      ...provider,
      name: provider.name?.trim() || getDefaultProviderName(index),
      savedModels: normalizeSavedModels(provider.savedModels),
    })),
    config.currentCustomApiProviderId,
  )

  if ((configProviders.providers?.length ?? 0) > 0 || (secureProvidersObject?.providers?.length ?? 0) > 0) {
    return mergeProviderSources(
      configProviders.providers ?? [],
      secureProvidersObject?.providers ?? [],
      config.currentCustomApiProviderId ?? secureProvidersObject?.currentProviderId,
    )
  }

  const legacyStorageEntry = readCustomApiStorage()
  const legacyConfigEntry = config.customApiEndpoint
  const provider =
    convertLegacyConfigToProviderEntry(legacyStorageEntry, getDefaultProviderName(0)) ??
    convertLegacyConfigToProviderEntry(legacyConfigEntry, getDefaultProviderName(0))

  return finalizeProviders(provider ? [provider] : [], provider?.id)
}

export function readCurrentCustomApiProvider(): CustomApiProviderEntry | undefined {
  const storage = readCustomApiProvidersStorage()
  return storage.providers?.find(provider => provider.id === storage.currentProviderId) ?? storage.providers?.[0]
}

export function getCurrentCustomApiProviderIndex(): number {
  const storage = readCustomApiProvidersStorage()
  return Math.max(0, storage.providers?.findIndex(provider => provider.id === storage.currentProviderId) ?? 0)
}

export function writeCustomApiProvidersStorage(next: CustomApiProvidersStorageData): void {
  const storage = getStorage()
  const current = storage.read?.() ?? {}
  storage.update?.({
    ...current,
    customApiEndpoint: finalizeProviders(next.providers ?? [], next.currentProviderId),
  })
}

export function createCustomApiProviderEntry(
  index: number,
  overrides: Partial<CustomApiProviderEntry> = {},
): CustomApiProviderEntry {
  return {
    id: overrides.id?.trim() || `provider-${index + 1}-${randomUUID()}`,
    name: overrides.name?.trim() || getDefaultProviderName(index),
    provider: overrides.provider,
    openaiCompatMode:
      overrides.openaiCompatMode ?? (overrides.provider === 'openai' ? 'chat_completions' : undefined),
    baseURL: overrides.baseURL,
    apiKey: overrides.apiKey,
    model: overrides.model,
    savedModels: normalizeSavedModels(overrides.savedModels),
  }
}

export function formatCustomApiProviderType(provider?: CustomApiProvider): string {
  return provider === 'openai'
    ? 'OpenAI-compatible'
    : provider === 'gemini'
      ? 'Gemini API'
      : provider === 'anthropic'
        ? 'Anthropic-compatible'
        : 'Not set'
}

export function formatCustomApiProviderIndex(index: number): string {
  return `#${String(index + 1).padStart(3, '0')}`
}

export function persistCustomApiProviders(next: CustomApiProvidersStorageData): void {
  const finalized = finalizeProviders(next.providers ?? [], next.currentProviderId)
  const currentProvider = finalized.providers?.find(
    provider => provider.id === finalized.currentProviderId,
  )
  const normalizedKey = currentProvider?.apiKey
    ? normalizeApiKeyForConfig(currentProvider.apiKey)
    : undefined
  saveGlobalConfig(current => ({
    ...current,
    customApiProviders: (finalized.providers ?? []).map(provider => ({
      ...provider,
      apiKey: undefined,
    })),
    currentCustomApiProviderId: finalized.currentProviderId,
    customApiKeyResponses: normalizedKey
      ? {
          approved: [
            ...new Set([
              ...(current.customApiKeyResponses?.approved ?? []),
              normalizedKey,
            ]),
          ],
          rejected: (current.customApiKeyResponses?.rejected ?? []).filter(
            key => key !== normalizedKey,
          ),
        }
      : current.customApiKeyResponses,
  }))
  writeCustomApiProvidersStorage(finalized)
}

export function updateCustomApiProviders(
  updater: (current: CustomApiProvidersStorageData) => CustomApiProvidersStorageData,
): CustomApiProvidersStorageData {
  const next = updater(readCustomApiProvidersStorage())
  persistCustomApiProviders(next)
  return readCustomApiProvidersStorage()
}

export function getCustomApiProviderByIndex(index: number): CustomApiProviderEntry | undefined {
  return readCustomApiProvidersStorage().providers?.[index]
}

export function getCurrentCustomApiProviderWithIndex(): {
  provider: CustomApiProviderEntry | undefined
  index: number
} {
  const storage = readCustomApiProvidersStorage()
  const index = Math.max(
    0,
    storage.providers?.findIndex(provider => provider.id === storage.currentProviderId) ?? 0,
  )
  return {
    provider: storage.providers?.[index],
    index,
  }
}

export function writeCustomApiStorage(next: CustomApiStorageData): void {
  const current = readCustomApiProvidersStorage()
  const existingProviders = current.providers ?? []
  const target = existingProviders[0]
  const nextProvider: CustomApiProviderEntry = {
    id: target?.id ?? `provider-1-${randomUUID()}`,
    name: target?.name ?? getDefaultProviderName(0),
    provider: next.provider,
    openaiCompatMode: next.openaiCompatMode,
    baseURL: next.baseURL,
    apiKey: next.apiKey,
    model: next.model,
    savedModels: normalizeSavedModels(next.savedModels),
  }
  const remaining = existingProviders.slice(1)
  persistCustomApiProviders({
    currentProviderId: current.currentProviderId ?? nextProvider.id,
    providers: [nextProvider, ...remaining],
  })
}

export function clearCustomApiStorage(): void {
  const storage = getStorage()
  const current = storage.read?.() ?? {}
  const { customApiEndpoint: _, ...rest } = current
  storage.update?.(rest)
}
