import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { EffortValue } from 'src/utils/effort.js'
import { normalizeModelStringForAPI } from '../../utils/model/model.js'

type AnyBlock = Record<string, unknown>

export type OpenAICompatConfig = {
  apiKey: string
  baseURL: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type OpenAIChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAIChatContentPart[] | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
  reasoning_content?: string
}

export type OpenAIChatRequest = {
  model: string
  messages: OpenAIChatMessage[]
  stream?: boolean
  enable_thinking?: boolean
  thinking_budget?: number
  reasoning_effort?: 'high' | 'max'
  extra_body?: {
    thinking?: {
      type: 'enabled' | 'disabled'
    }
  }
  temperature?: number
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters?: unknown
    }
  }>
  tool_choice?: 'auto' | { type: 'function'; function: { name: string } }
  max_tokens?: number
}

type OpenAIStreamChunk = {
  id?: string
  model?: string
  choices?: Array<{
    index?: number
    delta?: {
      role?: 'assistant'
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export function joinBaseUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/$/, '')}${path}`
}

export function contentToText(content: BetaMessageParam['content']): string {
  if (typeof content === 'string') return content
  return content
    .map(block => {
      if (block.type === 'text') return typeof block.text === 'string' ? block.text : ''
      if (block.type === 'tool_result') {
        return typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function toBlocks(content: BetaMessageParam['content']): AnyBlock[] {
  return Array.isArray(content)
    ? (content as unknown as AnyBlock[])
    : [{ type: 'text', text: content }]
}

function toDataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`
}

function mapAnthropicUserBlocksToOpenAIContent(
  blocks: AnyBlock[],
): OpenAIChatContentPart[] {
  return blocks.flatMap(block => {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      return [{ type: 'text' as const, text: block.text }]
    }
    if (
      block.type === 'image' &&
      block.source &&
      typeof block.source === 'object' &&
      (block.source as Record<string, unknown>).type === 'base64' &&
      typeof (block.source as Record<string, unknown>).media_type === 'string' &&
      typeof (block.source as Record<string, unknown>).data === 'string'
    ) {
      return [{
        type: 'image_url' as const,
        image_url: {
          url: toDataUrl(
            String((block.source as Record<string, unknown>).media_type),
            String((block.source as Record<string, unknown>).data),
          ),
        },
      }]
    }
    return []
  })
}

export function getToolDefinitions(tools?: BetaToolUnion[]): OpenAIChatRequest['tools'] {
  if (!tools || tools.length === 0) return undefined
  const mapped = tools.flatMap(tool => {
    const record = tool as unknown as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : undefined
    if (!name) return []
    return [{
      type: 'function' as const,
      function: {
        name,
        description:
          typeof record.description === 'string' ? record.description : undefined,
        parameters: record.input_schema,
      },
    }]
  })
  return mapped.length > 0 ? mapped : undefined
}

function mapEffortToOpenAIThinkingBudget(
  effort?: EffortValue,
): number | undefined {
  if (effort === 'none') return 0
  if (effort === 'low') return 1024
  if (effort === 'medium') return 4096
  if (effort === 'high') return 8192
  if (effort === 'max' || typeof effort === 'number') return 16384
  return undefined
}

function mapEffortToDeepSeekReasoningEffort(
  effort?: EffortValue,
): 'high' | 'max' | undefined {
  if (effort === 'none') return undefined
  if (effort === 'max') return 'max'
  if (typeof effort === 'number') return 'max'
  return 'high'
}

function compressAssistantTextForTokenSaving(text: string): string {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/([。！？；;.!?])\s+/g, '$1 ')
    .trim()
  if (normalized.length <= 240) {
    return normalized
  }

  const sentences = normalized
    .split(/(?<=[。！？；;.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)

  if (sentences.length <= 2) {
    return `状态摘要：${normalized.slice(0, 240)}`
  }

  const summaryParts: string[] = []
  const keyFacts = sentences.filter(sentence =>
    /(错误|error|失败|fix|修复|原因|root cause|结论|因此|所以|需要|must|should|文件|file|路径|path|函数|function|类|class|参数|param|返回|return|步骤|step|plan|结果|result|输出|output)/i.test(
      sentence,
    ),
  )

  const decisions = sentences.filter(sentence =>
    /(决定|decision|采用|use|改为|change|切换|switch|保留|preserve|删除|remove|跳过|skip|压缩|compress|优化|optimi[sz]e)/i.test(
      sentence,
    ),
  )

  const nextActions = sentences.filter(sentence =>
    /(接下来|next|然后|will|将会|需要做|todo|后续|follow-up)/i.test(sentence),
  )

  if (keyFacts.length > 0) {
    summaryParts.push(`关键事实：${keyFacts.slice(0, 3).join('；')}`)
  }
  if (decisions.length > 0) {
    summaryParts.push(`关键决策：${decisions.slice(0, 2).join('；')}`)
  }
  if (nextActions.length > 0) {
    summaryParts.push(`后续动作：${nextActions.slice(0, 2).join('；')}`)
  }

  if (summaryParts.length === 0) {
    const anchors = [sentences[0]!, sentences[sentences.length - 1]!]
    return `状态摘要：${[...new Set(anchors)].join(' ')}`.slice(0, 320)
  }

  return `状态摘要：${summaryParts.join(' | ')}`.slice(0, 420)
}

function compressUserTextForTokenSaving(text: string): string {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/([。！？；;.!?])\s+/g, '$1 ')
    .trim()
  if (normalized.length <= 220) {
    return normalized
  }

  const sentences = normalized
    .split(/(?<=[。！？；;.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)

  const goals = sentences.filter(sentence =>
    /(想要|需要|目标|goal|want|need|实现|完成|修复|添加|优化|开始|继续|分析|研究)/i.test(
      sentence,
    ),
  )
  const constraints = sentences.filter(sentence =>
    /(不要|不能|必须|限制|约束|兼容|仅|只|保留|避免|without|must|should|require|constraint)/i.test(
      sentence,
    ),
  )
  const requests = sentences.filter(sentence =>
    /(请|帮我|给我|用|改成|翻译|优化|实现|支持|写一个|开始|继续|look|check|fix|translate|implement)/i.test(
      sentence,
    ),
  )

  const summaryParts: string[] = []
  if (goals.length > 0) {
    summaryParts.push(`当前目标：${goals.slice(0, 2).join('；')}`)
  }
  if (constraints.length > 0) {
    summaryParts.push(`约束条件：${constraints.slice(0, 2).join('；')}`)
  }
  if (requests.length > 0) {
    summaryParts.push(`具体请求：${requests.slice(0, 2).join('；')}`)
  }

  if (summaryParts.length === 0) {
    return `用户摘要：${sentences.slice(0, 2).join('；')}`.slice(0, 300)
  }

  return `用户摘要：${summaryParts.join(' | ')}`.slice(0, 380)
}

export function convertAnthropicRequestToOpenAI(input: {
  model: string
  system?: string | Array<{ type?: string; text?: string }>
  messages: BetaMessageParam[]
  tools?: BetaToolUnion[]
  tool_choice?: BetaToolChoiceAuto | BetaToolChoiceTool
  temperature?: number
  max_tokens?: number
  thinking?: {
    type?: 'enabled' | 'disabled' | 'adaptive'
    budget_tokens?: number
  }
  effort?: EffortValue
  compatProvider?: 'openai' | 'deepseek'
  tokenSavingMaxIntelligence?: boolean
}): OpenAIChatRequest {
  const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
  const targetModel = normalizeModelStringForAPI(configuredModel || input.model)
  const isDeepSeekCompat = input.compatProvider === 'deepseek'
  const hasToolHistory = input.messages.some(message => {
    if (message.role !== 'assistant') return false
    const blocks = Array.isArray(message.content)
      ? (message.content as unknown as AnyBlock[])
      : []
    return blocks.some(block => block.type === 'tool_use')
  })
  const hasToolDefinitions = !!input.tools?.length
  const toolChoiceLocked = input.tool_choice?.type === 'tool'
  const tokenSavingMaxIntelligenceActive =
    isDeepSeekCompat && input.tokenSavingMaxIntelligence
  const shouldEscalateTokenSavingMode =
    tokenSavingMaxIntelligenceActive &&
    (hasToolHistory || hasToolDefinitions || toolChoiceLocked)
  const messages: OpenAIChatMessage[] = []
  const latestUserMessageIndex = (() => {
    for (let i = input.messages.length - 1; i >= 0; i--) {
      if (input.messages[i]?.role === 'user') return i
    }
    return -1
  })()
  const pendingCompressedUserTexts: string[] = []
  const pendingCompressedAssistantTexts: string[] = []
  const flushCompressedBuffers = (): void => {
    if (pendingCompressedUserTexts.length > 0) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `用户合并摘要：${pendingCompressedUserTexts.join(' | ')}`.slice(0, 800),
          },
        ],
      })
      pendingCompressedUserTexts.length = 0
    }
    if (pendingCompressedAssistantTexts.length > 0) {
      messages.push({
        role: 'assistant',
        content: `助手合并摘要：${pendingCompressedAssistantTexts.join(' | ')}`.slice(0, 1000),
      })
      pendingCompressedAssistantTexts.length = 0
    }
  }

  if (input.system) {
    const systemText = Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system
    if (systemText) messages.push({ role: 'system', content: systemText })
  }

  for (const message of input.messages) {
    if (message.role === 'user') {
      const blocks = toBlocks(message.content)

      const toolResults = blocks.filter(block => block.type === 'tool_result')
      for (const result of toolResults) {
        flushCompressedBuffers()
        const toolUseId =
          typeof result.tool_use_id === 'string' ? result.tool_use_id : undefined
        const content = result.content
        messages.push({
          role: 'tool',
          tool_call_id: toolUseId,
          content: typeof content === 'string' ? content : JSON.stringify(content),
        })
      }

      const userContent = mapAnthropicUserBlocksToOpenAIContent(
        blocks.filter(block => block.type !== 'tool_result') as AnyBlock[],
      )
      if (userContent.length > 0) {
        const isLatestUserMessage = input.messages.indexOf(message) === latestUserMessageIndex
        const shouldCompressUser =
          tokenSavingMaxIntelligenceActive &&
          !shouldEscalateTokenSavingMode &&
          !isLatestUserMessage
        if (shouldCompressUser) {
          const compressedTexts = userContent
            .filter(part => part.type === 'text')
            .map(part => compressUserTextForTokenSaving(part.text))
            .filter(Boolean)
          if (compressedTexts.length > 0) {
            pendingCompressedUserTexts.push(...compressedTexts)
          }
          const nonTextParts = userContent.filter(part => part.type !== 'text')
          if (nonTextParts.length > 0) {
            flushCompressedBuffers()
            messages.push({ role: 'user', content: nonTextParts })
          }
        } else {
          flushCompressedBuffers()
          messages.push({ role: 'user', content: userContent })
        }
      }
      continue
    }

    if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content)
        ? (message.content as unknown as AnyBlock[])
        : []
      const rawText = blocks
        .filter(block => block.type === 'text')
        .map(block => (typeof block.text === 'string' ? block.text : ''))
        .join('')
      const text =
        tokenSavingMaxIntelligenceActive && !shouldEscalateTokenSavingMode
          ? compressAssistantTextForTokenSaving(rawText)
          : rawText
      const reasoningContent = blocks
        .filter(block => block.type === 'thinking')
        .map(block => (typeof block.thinking === 'string' ? block.thinking : ''))
        .join('')

      const toolCalls = blocks
        .filter(block => block.type === 'tool_use')
        .map(block => ({
          id: String(block.id),
          type: 'function' as const,
          function: {
            name: String(block.name),
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        }))

      const shouldIncludeReasoningContent =
        !isDeepSeekCompat ||
        toolCalls.length > 0 ||
        (!tokenSavingMaxIntelligenceActive && text.length > 0) ||
        shouldEscalateTokenSavingMode

      if (!text && toolCalls.length === 0 && !shouldIncludeReasoningContent) {
        continue
      }

      const shouldCompressAssistant =
        tokenSavingMaxIntelligenceActive &&
        !shouldEscalateTokenSavingMode &&
        toolCalls.length === 0 &&
        !shouldIncludeReasoningContent

      if (shouldCompressAssistant && text) {
        pendingCompressedAssistantTexts.push(text)
        continue
      }

      flushCompressedBuffers()
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(shouldIncludeReasoningContent && reasoningContent
          ? { reasoning_content: reasoningContent }
          : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    }
  }

  flushCompressedBuffers()

  const effortThinkingBudget = mapEffortToOpenAIThinkingBudget(input.effort)
  const explicitThinkingBudget =
    typeof effortThinkingBudget === 'number' && effortThinkingBudget > 0
      ? Math.min(
          input.max_tokens ? Math.max(1, input.max_tokens - 1) : effortThinkingBudget,
          effortThinkingBudget,
        )
      : input.thinking?.type === 'enabled' &&
          typeof input.thinking.budget_tokens === 'number'
        ? input.thinking.budget_tokens
        : undefined
  const enableThinking =
    effortThinkingBudget === 0
      ? false
      : effortThinkingBudget !== undefined
        ? true
        : input.thinking?.type === 'enabled' || input.thinking?.type === 'adaptive'
  const deepSeekThinkingType =
    input.thinking?.type === 'disabled' || effortThinkingBudget === 0
      ? 'disabled'
      : 'enabled'
  const deepSeekReasoningEffort =
    tokenSavingMaxIntelligenceActive && !shouldEscalateTokenSavingMode
      ? 'high'
      : mapEffortToDeepSeekReasoningEffort(input.effort)
  const deepSeekMaxTokens =
    tokenSavingMaxIntelligenceActive && !shouldEscalateTokenSavingMode
      ? input.max_tokens !== undefined
        ? Math.min(input.max_tokens, 8192)
        : input.max_tokens
      : input.max_tokens

  return {
    model: targetModel,
    messages,
    ...(isDeepSeekCompat
      ? {
          ...(deepSeekReasoningEffort
            ? { reasoning_effort: deepSeekReasoningEffort }
            : {}),
          extra_body: {
            thinking: {
              type: deepSeekThinkingType,
            },
          },
          ...(deepSeekMaxTokens !== undefined
            ? { max_tokens: deepSeekMaxTokens }
            : {}),
        }
      : {
          enable_thinking: enableThinking,
          ...(explicitThinkingBudget !== undefined
            ? { thinking_budget: explicitThinkingBudget }
            : {}),
          ...(input.temperature !== undefined
            ? { temperature: input.temperature }
            : {}),
          ...(input.max_tokens !== undefined
            ? { max_tokens: input.max_tokens }
            : {}),
        }),
    ...(getToolDefinitions(input.tools)
      ? { tools: getToolDefinitions(input.tools) }
      : {}),
    ...(input.tool_choice?.type === 'tool'
      ? {
          tool_choice: {
            type: 'function' as const,
            function: { name: input.tool_choice.name },
          },
        }
      : input.tool_choice?.type === 'auto'
        ? { tool_choice: 'auto' as const }
        : {}),
  }
}

export async function createOpenAICompatStream(
  config: OpenAICompatConfig,
  request: OpenAIChatRequest,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await (config.fetch ?? globalThis.fetch)(
    joinBaseUrl(config.baseURL, '/chat/completions'),
    {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        ...config.headers,
      },
      body: JSON.stringify({ ...request, stream: true }),
    },
  )

  if (!response.ok || !response.body) {
    let responseText = ''
    try {
      responseText = await response.text()
    } catch {
      responseText = ''
    }
    throw new Error(
      `OpenAI compatible request failed with status ${response.status}${responseText ? `: ${responseText}` : ''}`,
    )
  }

  return response.body.getReader()
}

export function parseSSEChunk(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts, remainder }
}

export function mapFinishReason(reason: string | null | undefined): BetaMessage['stop_reason'] {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

export async function* createAnthropicStreamFromOpenAI(input: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  model: string
}): AsyncGenerator<BetaRawMessageStreamEvent, BetaMessage, void> {
  const decoder = new TextDecoder()
  let buffer = ''
  let started = false
  let textStarted = false
  let textContentIndex: number | null = null
  let thinkingStarted = false
  let thinkingContentIndex: number | null = null
  let toolIndexByOpenAIIndex = new Map<number, number>()
  let nextContentIndex = 0
  let promptTokens = 0
  let completionTokens = 0
  let emittedAnyContent = false
  const toolCallState = new Map<number, { id: string; name: string; arguments: string }>()

  while (true) {
    const { done, value } = await input.reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSSEChunk(buffer)
    buffer = parsed.remainder

    for (const rawEvent of parsed.events) {
      const dataLines = rawEvent
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())

      for (const data of dataLines) {
        if (!data || data === '[DONE]') continue
        const chunk = JSON.parse(data) as OpenAIStreamChunk
        if (!chunk || typeof chunk !== 'object') {
          throw new Error(
            `[openaiCompat] invalid stream chunk: ${String(data).slice(0, 500)}`,
          )
        }
        const choice = chunk.choices?.[0]
        const delta = choice?.delta

        if (!choice && data !== '[DONE]') {
          throw new Error(
            `[openaiCompat] chunk missing choices[0]: ${JSON.stringify(chunk).slice(0, 1000)}`,
          )
        }

        if (!started) {
          started = true
          promptTokens = chunk.usage?.prompt_tokens ?? 0
          yield {
            type: 'message_start',
            message: {
              id: chunk.id ?? 'openai-compat',
              type: 'message',
              role: 'assistant',
              model: input.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: promptTokens,
                output_tokens: 0,
              },
            },
          } as BetaRawMessageStreamEvent
        }

        if (delta?.content) {
          if (!textStarted) {
            textStarted = true
            textContentIndex = nextContentIndex
            nextContentIndex += 1
            yield {
              type: 'content_block_start',
              index: textContentIndex,
              content_block: {
                type: 'text',
                text: '',
              },
            } as BetaRawMessageStreamEvent
          }

          yield {
            type: 'content_block_delta',
            index: textContentIndex ?? 0,
            delta: {
              type: 'text_delta',
              text: delta.content,
            },
          } as BetaRawMessageStreamEvent
          emittedAnyContent = true
        }

        if (delta?.reasoning_content) {
          if (!thinkingStarted) {
            thinkingStarted = true
            thinkingContentIndex = nextContentIndex
            nextContentIndex += 1
            yield {
              type: 'content_block_start',
              index: thinkingContentIndex,
              content_block: {
                type: 'thinking',
                thinking: '',
                signature: '',
              },
            } as BetaRawMessageStreamEvent
          }

          yield {
            type: 'content_block_delta',
            index: thinkingContentIndex ?? 0,
            delta: {
              type: 'thinking_delta',
              thinking: delta.reasoning_content,
            },
          } as BetaRawMessageStreamEvent
          emittedAnyContent = true
        }

        for (const toolCall of delta?.tool_calls ?? []) {
          const openAIIndex = toolCall.index ?? 0
          let anthropicIndex = toolIndexByOpenAIIndex.get(openAIIndex)
          if (anthropicIndex === undefined) {
            anthropicIndex = nextContentIndex
            toolIndexByOpenAIIndex.set(openAIIndex, anthropicIndex)
            nextContentIndex = Math.max(nextContentIndex, anthropicIndex + 1)
            const state = {
              id: toolCall.id ?? `toolu_${openAIIndex}`,
              name: toolCall.function?.name ?? '',
              arguments: '',
            }
            toolCallState.set(openAIIndex, state)
            yield {
              type: 'content_block_start',
              index: anthropicIndex,
              content_block: {
                type: 'tool_use',
                id: state.id,
                name: state.name,
                input: '',
              },
            } as BetaRawMessageStreamEvent
          }

          const state = toolCallState.get(openAIIndex)
          if (!state) continue
          if (toolCall.id) state.id = toolCall.id
          if (toolCall.function?.name) state.name = toolCall.function.name
          if (toolCall.function?.arguments) {
            state.arguments += toolCall.function.arguments
            yield {
              type: 'content_block_delta',
              index: anthropicIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: toolCall.function.arguments,
              },
            } as BetaRawMessageStreamEvent
            emittedAnyContent = true
          }
        }

        if (choice?.finish_reason) {
          if (!emittedAnyContent) {
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'text',
                text: '',
              },
            } as BetaRawMessageStreamEvent
            yield {
              type: 'content_block_stop',
              index: 0,
            } as BetaRawMessageStreamEvent
          }
          completionTokens = chunk.usage?.completion_tokens ?? completionTokens
          if (textStarted && textContentIndex !== null) {
            yield {
              type: 'content_block_stop',
              index: textContentIndex,
            } as BetaRawMessageStreamEvent
          }

          if (thinkingStarted && thinkingContentIndex !== null) {
            yield {
              type: 'content_block_stop',
              index: thinkingContentIndex,
            } as BetaRawMessageStreamEvent
          }

          for (const anthropicIndex of toolIndexByOpenAIIndex.values()) {
            yield {
              type: 'content_block_stop',
              index: anthropicIndex,
            } as BetaRawMessageStreamEvent
          }

          yield {
            type: 'message_delta',
            delta: {
              stop_reason: mapFinishReason(choice.finish_reason),
              stop_sequence: null,
            },
            usage: {
              output_tokens: completionTokens,
            },
          } as BetaRawMessageStreamEvent

          yield {
            type: 'message_stop',
          } as BetaRawMessageStreamEvent

          return {
            id: chunk.id ?? 'openai-compat',
            type: 'message',
            role: 'assistant',
            model: input.model,
            content: [],
            stop_reason: mapFinishReason(choice.finish_reason),
            stop_sequence: null,
            usage: {
              input_tokens: promptTokens,
              output_tokens: completionTokens,
            },
          } as BetaMessage
        }
      }
    }
  }

  throw new Error(
    `[openaiCompat] stream ended unexpectedly before message_stop for model=${input.model}`,
  )
}

export function mapOpenAIUsageToAnthropic(usage?: {
  prompt_tokens?: number
  completion_tokens?: number
}): BetaUsage | undefined {
  if (!usage) return undefined
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  } as BetaUsage
}
