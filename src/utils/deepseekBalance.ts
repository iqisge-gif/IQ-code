import axios from 'axios'
import { readCurrentCustomApiProvider } from './customApiStorage.js'

export type DeepSeekBalanceInfo = {
  currency?: string
  total_balance?: string
}

export type DeepSeekBalanceResponse = {
  is_available?: boolean
  balance_infos?: DeepSeekBalanceInfo[]
}

let cachedBalance: DeepSeekBalanceResponse | null = null
let lastFetchedAt = 0
let inFlight: Promise<DeepSeekBalanceResponse | null> | null = null
const BALANCE_TTL_MS = 30_000

export function formatDeepSeekBalance(balance: DeepSeekBalanceResponse | null): string | null {
  if (!balance?.is_available) return null
  const usd = balance.balance_infos?.find(item => item.currency === 'USD')?.total_balance
  const cny = balance.balance_infos?.find(item => item.currency === 'CNY')?.total_balance
  if (usd && cny) return `Balance: USD ${usd} · CNY ${cny}`
  if (usd) return `Balance: USD ${usd}`
  if (cny) return `Balance: CNY ${cny}`
  return null
}

export async function fetchDeepSeekBalance(force = false): Promise<DeepSeekBalanceResponse | null> {
  const now = Date.now()
  if (!force && cachedBalance && now - lastFetchedAt < BALANCE_TTL_MS) {
    return cachedBalance
  }
  if (!force && inFlight) {
    return inFlight
  }

  const provider = readCurrentCustomApiProvider()
  if (provider?.provider !== 'deepseek' || !provider.baseURL || !provider.apiKey) {
    cachedBalance = null
    lastFetchedAt = now
    return null
  }

  const url = `${provider.baseURL.replace(/\/$/, '')}/user/balance`
  inFlight = axios.get<DeepSeekBalanceResponse>(url, {
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
    },
    timeout: 10_000,
  }).then(response => {
    cachedBalance = response.data ?? null
    lastFetchedAt = Date.now()
    return cachedBalance
  }).catch(() => {
    cachedBalance = null
    lastFetchedAt = Date.now()
    return null
  }).finally(() => {
    inFlight = null
  })

  return inFlight
}
