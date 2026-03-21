import type { ChatMessageData } from '@desktop-claw/shared'
import { streamChat } from '../llm/client'

/** Agent Loop 最大迭代回合数（防死循环） */
const MAX_STEPS = 10

/** 上下文保留最大轮数（user+assistant 算一轮） */
const MAX_HISTORY_TURNS = 10

/** System Prompt — MVP 固定版本，后续改为运行时组装 */
const SYSTEM_PROMPT =
  '你是 Claw 🐾，一个住在用户桌面上的 AI 桌宠伙伴。你友好、简洁、有趣，偶尔带点俏皮。用中文回复。'

export interface AgentLoopParams {
  /** 用户当前输入 */
  prompt: string
  /** 对话历史 */
  history: ChatMessageData[]
  /** 流式 token 回调 */
  onToken: (delta: string) => void
  /** 最终完成回调 */
  onDone: (fullContent: string) => void
  /** 错误回调 */
  onError: (code: string, message: string) => void
  /** 取消信号 */
  signal?: AbortSignal
}

/**
 * 裁剪历史：保留最近 N 轮对话（user+assistant 成对计算）
 * 始终保留完整的 pair，不会切到一半
 */
function trimHistory(history: ChatMessageData[], maxTurns: number): ChatMessageData[] {
  if (history.length === 0) return []

  // 从后往前数 turn：每遇到一个 user 消息算一轮
  let turns = 0
  let cutIndex = history.length

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      turns++
      if (turns > maxTurns) {
        cutIndex = i + 1
        break
      }
    }
    cutIndex = i
  }

  return history.slice(cutIndex)
}

/**
 * Agent Loop（ReAct-like 执行循环）
 *
 * MVP 阶段：无工具，循环只跑一圈（LLM 直接返回文本）。
 * 后续 A.6 加入 tools 后，循环会在 tool_calls ↔ tool_result 间多轮迭代。
 *
 * @returns AbortController 用于外部取消
 */
export function agentLoop(params: AgentLoopParams): AbortController {
  const controller = new AbortController()

  // 如果外部传了 signal，监听其 abort 事件
  if (params.signal) {
    if (params.signal.aborted) {
      controller.abort()
    } else {
      params.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  void _runLoop(params, controller)

  return controller
}

async function _runLoop(
  { prompt, history, onToken, onDone, onError }: AgentLoopParams,
  controller: AbortController
): Promise<void> {
  // 1. 裁剪历史
  const trimmed = trimHistory(history, MAX_HISTORY_TURNS)

  // 2. 组装内部 messages 数组
  //    当前 prompt 不在 history 里，单独追加为最后一条 user 消息
  const messages: ChatMessageData[] = [...trimmed, { role: 'user', content: prompt }]

  // 3. ReAct 循环
  for (let step = 0; step < MAX_STEPS; step++) {
    if (controller.signal.aborted) {
      onError('CANCELLED', '任务已取消')
      return
    }

    // 调用 LLM（传入 systemPrompt + messages，流式返回）
    const result = await callLLM(messages, onToken, controller)

    if (result.error) {
      onError(result.error.code, result.error.message)
      return
    }

    // MVP：无 tool_calls，LLM 只返回纯文本 → 直接结束
    // 未来 A.6：检查 result.toolCalls，执行工具，追加 tool_result 到 messages，continue
    if (result.content) {
      onDone(result.content)
      return
    }

    // 安全兜底：LLM 返回了空内容
    onError('EMPTY_RESPONSE', 'LLM 返回了空内容')
    return
  }

  // 超过最大回合数
  onError('MAX_STEPS', `Agent Loop 达到最大回合数 (${MAX_STEPS})`)
}

// ─── LLM 调用封装 ─────────────────────────────────

interface LLMResult {
  content: string | null
  error: { code: string; message: string } | null
}

/**
 * 将 streamChat 包装为 Promise，收集完整文本
 * 同时通过 onToken 实时分发 delta
 */
function callLLM(
  messages: ChatMessageData[],
  onToken: (delta: string) => void,
  controller: AbortController
): Promise<LLMResult> {
  return new Promise((resolve) => {
    const abort = streamChat(messages, {
      onToken(delta) {
        onToken(delta)
      },
      onDone(fullContent) {
        resolve({ content: fullContent, error: null })
      },
      onError(code, message) {
        resolve({ content: null, error: { code, message } })
      }
    }, SYSTEM_PROMPT)

    // 关联取消：agentLoop 的 controller abort 时，也 abort LLM 请求
    controller.signal.addEventListener('abort', () => abort.abort(), { once: true })
  })
}
