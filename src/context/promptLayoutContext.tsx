import { createContext, useContext } from 'react'

export type PromptLayoutContextValue = {
  columns: number
}

export const PromptLayoutContext =
  createContext<PromptLayoutContextValue | null>(null)

export function usePromptLayoutColumns(): number | null {
  return useContext(PromptLayoutContext)?.columns ?? null
}
