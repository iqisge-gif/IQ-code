import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { EffortValue } from 'src/utils/effort.js'
import {
  getToolDefinitions,
  joinBaseUrl,
  parseSSEChunk,
  toBlocks,
  type OpenAICompatConfig,
} from './openaiCompat.js'

type AnyBlock = Record<string, unknown>

type GeminiPart = {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  inlineData?: {
    mimeType: string
    data: string
  }
  functionCall?: {
    name?: string
    args?: unknown
  }
  functionResponse?: {
    name?: string
    response?: unknown
  }
}

type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

type GeminiTool = {
  functionDeclarations: Array<{
    name: string
    description?: string
    parameters?: unknown
  }>
}

type GeminiRequest = {
  contents: GeminiContent[]
  systemInstruction?: {
    parts: Array<{ text: string }>
  }
  tools?: GeminiTool[]
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY'
      allowedFunctionNames?: string[]
    }
  }
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    thinkingConfig?: {
      includeThoughts?: boolean
      thinkingBudget?: number
    }
  }
}

type GeminiStreamChunk = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[]
    }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

function getToolNameById(messages: BetaMessageParam[]): Map<string, string> {
  const toolNameById = new Map<string, string>()

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as unknown as AnyBlock[]) {
      if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        toolNameById.set(block.id, block.name)
      }
    }
  }

  return toolNameById
}

function getGeminiToolDefinitions(tools?: BetaToolUnion[]): GeminiTool[] | undefined {
  const definitions = getToolDefinitions(tools)
  if (!definitions || definitions.length === 0) return undefined

  return [
    {
      functionDeclarations: definitions.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      })),
    },
  ]
}

function mapToolChoice(
  toolChoice?: BetaToolChoiceAuto | BetaToolChoiceTool,
): GeminiRequest['toolConfig'] | undefined {
  if (toolChoice?.type === 'tool') {
    return {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [toolChoice.name],
      },
    }
  }

  if (toolChoice?.type === 'auto') {
    return {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    }
  }

  return undefined
}

function mapEffortToGeminiThinkingBudget(effort?: EffortValue): number | undefined {
  if (effort === 'none') return 0
  if (effort === 'low') return 1024
  if (effort === 'medium') return 4096
  if (effort === 'high') return 8192
  if (effort === 'max' || typeof effort === 'number') return 8192
  return undefined
}

function mapAnthropicUserBlocksToGeminiParts(blocks: AnyBlock[]): GeminiPart[] {
  return blocks.flatMap(block => {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      return [{ text: block.text }]
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
        inlineData: {
          mimeType: String((block.source as Record<string, unknown>).media_type),
          data: String((block.source as Record<string, unknown>).data),
        },
      }]
    }
    return []
  })
}

export function convertAnthropicRequestToGemini(input: {
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
}): GeminiRequest {
  const toolNameById = getToolNameById(input.messages)
  const contents: GeminiContent[] = []
  const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
  void configuredModel

  if (input.system) {
    const systemText = Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system

    if (systemText.trim()) {
      // kept separately in request body below
    }
  }

  for (const message of input.messages) {
    const blocks = toBlocks(message.content)

    if (message.role === 'user') {
      const parts: GeminiPart[] = []

      for (const block of blocks as AnyBlock[]) {
        if (block.type === 'tool_result') {
          const toolUseId =
            typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined
          const toolName = toolUseId ? toolNameById.get(toolUseId) : undefined
          parts.push({
            functionResponse: {
              name: toolName,
              response: {
                content:
                  typeof block.content === 'string'
                    ? block.content
                    : block.content ?? '',
              },
            },
          })
        }
      }

      parts.push(
        ...mapAnthropicUserBlocksToGeminiParts(
          blocks.filter(block => block.type !== 'tool_result') as AnyBlock[],
        ),
      )

      if (parts.length > 0) {
        contents.push({ role: 'user', parts })
      }
      continue
    }

    const parts: GeminiPart[] = []
    const assistantBlocks = Array.isArray(message.content)
      ? (message.content as unknown as AnyBlock[])
      : []

    for (const block of assistantBlocks) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        parts.push({ text: block.text })
        continue
      }

      if (block.type === 'tool_use') {
        parts.push({
          functionCall: {
            name: typeof block.name === 'string' ? block.name : undefined,
            args: block.input ?? {},
          },
        })
      }
    }

    if (parts.length > 0) {
      contents.push({ role: 'model', parts })
    }
  }

  const systemText = input.system
    ? Array.isArray(input.system)
      ? input.system.map(block => block.text ?? '').join('\n')
      : input.system
    : ''

  const thinkingBudget = mapEffortToGeminiThinkingBudget(input.effort)
  const thinkingEnabled =
    (input.thinking?.type === 'enabled' || input.thinking?.type === 'adaptive') &&
    thinkingBudget !== 0

  return {
    contents,
    ...(systemText.trim()
      ? {
          systemInstruction: {
            parts: [{ text: systemText }],
          },
        }
      : {}),
    ...(getGeminiToolDefinitions(input.tools)
      ? { tools: getGeminiToolDefinitions(input.tools) }
      : {}),
    ...(mapToolChoice(input.tool_choice)
      ? { toolConfig: mapToolChoice(input.tool_choice) }
      : {}),
    generationConfig: {
      temperature: input.temperature,
      maxOutputTokens: input.max_tokens,
      ...(thinkingEnabled
        ? {
            thinkingConfig: {
              includeThoughts: true,
              ...(typeof thinkingBudget === 'number' && thinkingBudget > 0
                ? { thinkingBudget }
                : {}),
            },
          }
        : {}),
    },
  }
}

export async function createGeminiCompatStream(
  config: OpenAICompatConfig,
  model: string,
  request: GeminiRequest,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await (config.fetch ?? globalThis.fetch)(
    joinBaseUrl(
      config.baseURL,
      `/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    ),
    {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.apiKey,
        ...config.headers,
      },
      body: JSON.stringify(request),
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
      `Gemini request failed with status ${response.status}${responseText ? `: ${responseText}` : ''}`,
    )
  }

  return response.body.getReader()
}

function mapGeminiFinishReason(reason: string | undefined): BetaMessage['stop_reason'] {
  if (reason === 'MAX_TOKENS') return 'max_tokens'
  return 'end_turn'
}

export async function* createAnthropicStreamFromGemini(input: {
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
  let nextContentIndex = 0
  let promptTokens = 0
  let completionTokens = 0
  let emittedAnyContent = false
  let stopReason: BetaMessage['stop_reason'] = 'end_turn'
  let toolCounter = 0

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
        const chunk = JSON.parse(data) as GeminiStreamChunk
        if (!chunk || typeof chunk !== 'object') {
          throw new Error(`[geminiCompat] invalid stream chunk: ${String(data).slice(0, 500)}`)
        }

        if (!started) {
          started = true
          promptTokens = chunk.usageMetadata?.promptTokenCount ?? 0
          yield {
            type: 'message_start',
            message: {
              id: 'gemini-compat',
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

        const candidate = chunk.candidates?.[0]
        const parts = candidate?.content?.parts ?? []

        for (const part of parts) {
          if (typeof part.text === 'string' && part.text.length > 0 && part.thought) {
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
                  signature: typeof part.thoughtSignature === 'string' ? part.thoughtSignature : '',
                },
              } as BetaRawMessageStreamEvent
            }

            yield {
              type: 'content_block_delta',
              index: thinkingContentIndex ?? 0,
              delta: {
                type: 'thinking_delta',
                thinking: part.text,
              },
            } as BetaRawMessageStreamEvent
            emittedAnyContent = true
            continue
          }

          if (typeof part.text === 'string' && part.text.length > 0) {
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
                text: part.text,
              },
            } as BetaRawMessageStreamEvent
            emittedAnyContent = true
          }

          if (part.functionCall) {
            const anthropicIndex = nextContentIndex
            nextContentIndex += 1
            toolCounter += 1
            yield {
              type: 'content_block_start',
              index: anthropicIndex,
              content_block: {
                type: 'tool_use',
                id: `toolu_gemini_${toolCounter}`,
                name: part.functionCall.name ?? '',
                input: '',
              },
            } as BetaRawMessageStreamEvent

            const argsJson = JSON.stringify(part.functionCall.args ?? {})
            yield {
              type: 'content_block_delta',
              index: anthropicIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: argsJson,
              },
            } as BetaRawMessageStreamEvent
            yield {
              type: 'content_block_stop',
              index: anthropicIndex,
            } as BetaRawMessageStreamEvent
            emittedAnyContent = true
            stopReason = 'tool_use'
          }
        }

        if (candidate?.finishReason) {
          stopReason = stopReason === 'tool_use' ? 'tool_use' : mapGeminiFinishReason(candidate.finishReason)
        }

        promptTokens = chunk.usageMetadata?.promptTokenCount ?? promptTokens
        completionTokens = chunk.usageMetadata?.candidatesTokenCount ?? completionTokens
      }
    }
  }

  if (!started) {
    throw new Error(`[geminiCompat] stream ended before message_start for model=${input.model}`)
  }

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

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
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
    id: 'gemini-compat',
    type: 'message',
    role: 'assistant',
    model: input.model,
    content: [],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: promptTokens,
      output_tokens: completionTokens,
    },
  } as BetaMessage
}
