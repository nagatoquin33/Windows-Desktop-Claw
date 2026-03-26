import type { ChatMessageData, ToolSchema, ToolCall } from '@desktop-claw/shared'
import { loadLLMConfig } from './config'

export interface StreamCallbacks {
  onToken: (delta: string) => void
  onDone: (fullContent: string) => void
  onError: (code: string, message: string) => void
  /** LLM 返回 tool_calls 时回调（不会同时触发 onDone） */
  onToolCalls?: (toolCalls: ToolCall[]) => void
}

export interface StreamChatOptions {
  /** 传给 LLM 的 tools 定义列表 */
  tools?: ToolSchema[]
  /** 自定义 system prompt（由 Agent Loop 传入） */
  systemPrompt?: string
}

/** 初始 fetch 超时（等待首次响应） */
const TIMEOUT_MS = 30_000
/** SSE 流中每次读取的超时（防半开连接） */
const PER_TOKEN_TIMEOUT_MS = 30_000
const DEFAULT_SYSTEM_PROMPT = '你是 Claw 🐾，一个住在用户桌面上的 AI 桌宠伙伴。你友好、简洁、有趣，偶尔带点俏皮。用中文回复。'

/**
 * 流式调用 OpenAI 兼容 LLM API
 * @param options 可选，tools + systemPrompt
 * @returns 一个 AbortController，可调用 .abort() 取消请求
 */
export function streamChat(
  history: ChatMessageData[],
  callbacks: StreamCallbacks,
  options?: StreamChatOptions
): AbortController {
  const controller = new AbortController()

  // 异步执行，不阻塞调用方
  void _doStream(history, callbacks, controller, options)

  return controller
}

async function _doStream(
  history: ChatMessageData[],
  { onToken, onDone, onError, onToolCalls }: StreamCallbacks,
  controller: AbortController,
  options?: StreamChatOptions
): Promise<void> {
  const config = loadLLMConfig()
  if (!config) {
    onError('CONFIG_MISSING', '未配置 LLM，请在 设置 中填写 API Key')
    return
  }

  // 构建 messages：system + history
  //   需要正确映射 tool_calls、tool 消息给 OpenAI API 格式
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    ...history.map((m) => {
      if (m.role === 'assistant' && m.tool_calls) {
        return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls }
      }
      if (m.role === 'tool' && m.tool_call_id) {
        return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id }
      }
      return { role: m.role, content: m.content }
    })
  ]

  // 规范化 baseURL：确保以 / 结尾，拼接 chat/completions
  const base = config.baseURL.replace(/\/+$/, '')
  const url = `${base}/chat/completions`

  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      stream: true,
      max_tokens: 2048
    }

    // 有 tools 时添加到请求体
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      onError('API_ERROR', `LLM API ${res.status}: ${errText}`)
      return
    }

    if (!res.body) {
      onError('NO_BODY', 'LLM API 未返回 stream body')
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''

    // tool_calls 累积器：SSE 流中 tool_calls 可能跨多个 chunk
    const pendingToolCalls: Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }> = new Map()

    while (true) {
      // per-token 超时：每次读取最多等 30s，防 DeepSeek 半开连接
      const readResult = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('PER_TOKEN_TIMEOUT')), PER_TOKEN_TIMEOUT_MS)
        )
      ])
      const { done, value } = readResult
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 处理 SSE 行
      const lines = buffer.split('\n')
      // 保留最后一行（可能不完整）
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          if (!choice) continue

          const delta = choice.delta

          // 文本内容
          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            fullContent += delta.content
            onToken(delta.content)
          }

          // tool_calls（流式累积）
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              const existing = pendingToolCalls.get(idx)
              if (!existing) {
                // 新的 tool_call
                pendingToolCalls.set(idx, {
                  id: tc.id ?? '',
                  type: 'function',
                  function: {
                    name: tc.function?.name ?? '',
                    arguments: tc.function?.arguments ?? ''
                  }
                })
              } else {
                // 增量追加
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.function.name += tc.function.name
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
              }
            }
          }

          // 非流式响应中的完整 tool_calls（某些 API 会直接返回完整 tool_calls）
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            // finish_reason 处理在流结束后统一进行
          }
        } catch {
          // 解析失败的行静默跳过
          console.warn('[llm] failed to parse SSE chunk:', data.slice(0, 100))
        }
      }
    }

    // 流结束后判断：有 tool_calls 则优先走 onToolCalls，否则 onDone
    if (pendingToolCalls.size > 0 && onToolCalls) {
      const toolCalls = Array.from(pendingToolCalls.values())
      onToolCalls(toolCalls)
    } else {
      onDone(fullContent)
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId)

    if (err instanceof Error && err.name === 'AbortError') {
      onError('TIMEOUT', '请求超时或已取消')
    } else if (err instanceof Error && err.message === 'PER_TOKEN_TIMEOUT') {
      console.warn('[llm] per-token timeout, aborting stream')
      controller.abort()
      onError('STREAM_TIMEOUT', 'LLM 响应中断（超过 30s 未收到新数据）')
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[llm] stream error:', message)
      onError('STREAM_ERROR', message)
    }
  }
}
