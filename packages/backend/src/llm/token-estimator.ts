import type { ChatMessageData } from '@desktop-claw/shared'

/**
 * 轻量 token 估算（不依赖任何 tokenizer 库，模型无关）
 *
 * 经验系数：
 * - 中文：约 1.5 字 ≈ 1 token
 * - 英文/数字/符号：约 4 字符 ≈ 1 token
 * - 混合内容取加权平均
 *
 * 每条消息额外 +4 token（role / 分隔符开销）
 */

/** 每条消息的固定开销（role + 分隔符） */
const MSG_OVERHEAD = 4

/** 估算单段文本的 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  let cjk = 0
  let other = 0
  for (const ch of text) {
    // CJK 统一表意字符 + 常用标点
    if (ch.charCodeAt(0) > 0x2e80) {
      cjk++
    } else {
      other++
    }
  }

  // 中文 ~1.5 字/token，非中文 ~4 字符/token
  return Math.ceil(cjk / 1.5 + other / 4)
}

/** 估算单条消息的 token 数（含 role 开销） */
export function estimateMessageTokens(msg: ChatMessageData): number {
  let tokens = MSG_OVERHEAD + estimateTokens(msg.content)

  // tool_calls 中的 function name + arguments 也占 token
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += estimateTokens(tc.function.name) + estimateTokens(tc.function.arguments)
    }
  }

  return tokens
}

/** 估算消息数组的总 token 数 */
export function estimateHistoryTokens(messages: ChatMessageData[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}
