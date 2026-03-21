import type { ChatMessageData } from '@desktop-claw/shared'
import { loadLLMConfig } from './config'

export interface StreamCallbacks {
  onToken: (delta: string) => void
  onDone: (fullContent: string) => void
  onError: (code: string, message: string) => void
}

const TIMEOUT_MS = 30_000
const DEFAULT_SYSTEM_PROMPT = '你是 Claw 🐾，一个住在用户桌面上的 AI 桌宠伙伴。你友好、简洁、有趣，偶尔带点俏皮。用中文回复。'

/**
 * 流式调用 OpenAI 兼容 LLM API
 * @param systemPrompt 可选，自定义 system prompt（由 Agent Loop 传入）
 * @returns 一个 AbortController，可调用 .abort() 取消请求
 */
export function streamChat(
  history: ChatMessageData[],
  callbacks: StreamCallbacks,
  systemPrompt?: string
): AbortController {
  const controller = new AbortController()

  // 异步执行，不阻塞调用方
  void _doStream(history, callbacks, controller, systemPrompt)

  return controller
}

async function _doStream(
  history: ChatMessageData[],
  { onToken, onDone, onError }: StreamCallbacks,
  controller: AbortController,
  systemPrompt?: string
): Promise<void> {
  const config = loadLLMConfig()
  if (!config) {
    onError('CONFIG_MISSING', '未配置 LLM，请在 设置 中填写 API Key')
    return
  }

  // 构建 messages：system + history
  const messages = [
    { role: 'system' as const, content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content }))
  ]

  // 规范化 baseURL：确保以 / 结尾，拼接 chat/completions
  const base = config.baseURL.replace(/\/+$/, '')
  const url = `${base}/chat/completions`

  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        max_tokens: 2048
      }),
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

    while (true) {
      const { done, value } = await reader.read()
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
          const delta = parsed.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            fullContent += delta
            onToken(delta)
          }
        } catch {
          // 解析失败的行静默跳过
          console.warn('[llm] failed to parse SSE chunk:', data.slice(0, 100))
        }
      }
    }

    onDone(fullContent)
  } catch (err: unknown) {
    clearTimeout(timeoutId)

    if (err instanceof Error && err.name === 'AbortError') {
      onError('TIMEOUT', '请求超时或已取消')
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[llm] stream error:', message)
      onError('STREAM_ERROR', message)
    }
  }
}
