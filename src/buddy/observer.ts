import type { Message } from '../types/message.js'
import { stripDisplayTagsAllowEmpty } from '../utils/displayTags.js'
import { getAssistantMessageText, getUserMessageText } from '../utils/messages.js'
import { matchesKeepGoingKeyword, matchesNegativeKeyword } from '../utils/userPromptKeywords.js'
import { companionUserId, getCompanion, roll } from './companion.js'
import { getGlobalConfig } from '../utils/config.js'

function isRealUserMessage(message: Message): boolean {
  if (message.type !== 'user') return false
  if (message.isMeta || message.isCompactSummary) return false
  if (message.isSynthetic || message.isReplay) return false
  if (message.parent_tool_use_id || message.toolUseResult) return false
  if (message.origin?.kind && message.origin.kind !== 'human') return false
  return true
}

function isUsableAssistantMessage(message: Message): boolean {
  return message.type === 'assistant' && !message.isMeta && !message.isCompactSummary
}

function cleaned(text: string | null): string {
  if (!text) return ''
  return stripDisplayTagsAllowEmpty(text).trim()
}

function getLatestUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || !isRealUserMessage(message)) continue
    const text = cleaned(getUserMessageText(message))
    if (text) return text
  }
  return ''
}

function getLatestAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || !isUsableAssistantMessage(message)) continue
    const text = cleaned(getAssistantMessageText(message))
    if (text) return text
  }
  return ''
}

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase()
  return needles.some(needle => lower.includes(needle))
}

function pick(seed: number, options: readonly string[]): string {
  return options[seed % options.length]!
}

function classifyReaction(userText: string, assistantText: string): string[] {
  const combined = `${userText}\n${assistantText}`.toLowerCase()

  if (includesAny(combined, ['/buddy', 'buddy'])) {
    return [
      'I am paying attention.',
      'Buddy is listening.',
      'Tiny penguin acknowledged.',
    ]
  }

  if (matchesNegativeKeyword(userText)) {
    return [
      'You have got this.',
      'Okay, deep breath.',
      'I am still cheering.',
    ]
  }

  if (matchesKeepGoingKeyword(userText)) {
    return [
      'Forward march.',
      'Still with you.',
      'Keep cooking.',
    ]
  }

  if (includesAny(combined, ['fixed', 'done', 'resolved', 'working', 'success'])) {
    return [
      'That feels like progress.',
      'Neat little win.',
      'Happy penguin noises.',
    ]
  }

  return [
    'Just vibing nearby.',
    'Watching the terminal glow.',
    'Tiny flippers crossed.',
  ]
}

export async function fireCompanionObserver(
  messages: Message[],
  onReaction: (reaction: string | undefined) => void,
): Promise<void> {
  const config = getGlobalConfig()
  if (config.companionMuted) return
  if (!getCompanion()) return

  const userText = getLatestUserText(messages)
  const assistantText = getLatestAssistantText(messages)
  if (!userText && !assistantText) return

  const choices = classifyReaction(userText, assistantText)
  const { inspirationSeed } = roll(companionUserId())
  const reaction = pick(inspirationSeed + userText.length + assistantText.length, choices)
  if (!reaction.trim()) return

  onReaction(reaction)
}
