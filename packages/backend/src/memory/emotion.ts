import type { PersistedMessage } from './memory-service'

// ─── 情绪状态类型 ────────────────────────────

export type EmotionState = 'idle' | 'busy' | 'done' | 'night'

export interface EmotionResult {
  state: EmotionState
  /** 单击气泡可用的随机话术池 */
  phrases: string[]
}

// ─── 纯函数：从当日记忆 + 时间派生情绪状态 ──

/**
 * 派生情绪状态（纯函数，零 LLM 成本）
 *
 * 规则：
 *  - 22:00-06:00 → night（深夜模式）
 *  - 最近 5 分钟内有对话 → busy（忙碌中）
 *  - 当日有 ≥ 5 条 user 消息且最近 30 分钟无对话 → done（告一段落）
 *  - 其他 → idle（空闲）
 */
export function deriveEmotionState(
  todayMessages: PersistedMessage[],
  currentTime: Date = new Date()
): EmotionResult {
  const hour = currentTime.getHours()

  // night: 22:00 - 06:00
  if (hour >= 22 || hour < 6) {
    return {
      state: 'night',
      phrases: [
        '夜深了，早点休息呀 🌙',
        '熬夜对身体不好哦～',
        '我也有点困了…打个哈欠 😪',
        '晚安～明天见 ✨'
      ]
    }
  }

  // 计算最后一条消息的时间距今
  const lastMsg = todayMessages.length > 0
    ? todayMessages[todayMessages.length - 1]
    : null
  const lastMsgTime = lastMsg?.ts ? new Date(lastMsg.ts).getTime() : 0
  const minutesSinceLast = lastMsgTime
    ? (currentTime.getTime() - lastMsgTime) / 60_000
    : Infinity

  // busy: 最近 5 分钟内有对话
  if (minutesSinceLast < 5) {
    return {
      state: 'busy',
      phrases: [
        '在呢在呢～',
        '嗯？还有什么事吗？',
        '我在听～',
        '有什么需要帮忙的？'
      ]
    }
  }

  // done: 聊了不少但暂停了
  const userMsgCount = todayMessages.filter((m) => m.role === 'user').length
  if (userMsgCount >= 5 && minutesSinceLast >= 30) {
    return {
      state: 'done',
      phrases: [
        '刚才聊得挺开心的～',
        '休息一下也好 ☕',
        '有事随时叫我哦',
        '我在这里等你～'
      ]
    }
  }

  // idle: 默认空闲
  return {
    state: 'idle',
    phrases: [
      '嗨～有什么想聊的吗？',
      '今天过得怎么样？',
      '无聊的话可以找我玩哦 🐾',
      '我在这里呢～',
      '要不要聊聊天？'
    ]
  }
}
