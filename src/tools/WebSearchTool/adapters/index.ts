/**
 * Search adapter factory — selects the appropriate backend by checking
 * whether the API base URL points to Anthropic's official endpoint.
 */

import { BingSearchAdapter } from './bingAdapter.js'
import type { WebSearchAdapter } from './types.js'

export type { SearchResult, SearchOptions, SearchProgress, WebSearchAdapter } from './types.js'

let cachedAdapter: WebSearchAdapter | null = null

export function createAdapter(): WebSearchAdapter {
  // Use Bing adapter directly, skip API adapter selection logic
  if (cachedAdapter) return cachedAdapter

  cachedAdapter = new BingSearchAdapter()
  return cachedAdapter
}
