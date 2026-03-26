import type { ChatMessageData } from '@desktop-claw/shared'
import { agentLoop } from '../agent/loop'

// ─── 类型定义 ─────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TaskCallbacks {
  onToken: (delta: string) => void
  onDone: (fullContent: string) => void
  onError: (code: string, message: string) => void
  onCancelled: () => void
  onStatus?: (text: string) => void
}

interface Task {
  taskId: string
  content: string
  status: TaskStatus
  callbacks: TaskCallbacks
}

/** 队列上限，防堆积 */
const MAX_QUEUE_SIZE = 20
/** 单个 task 最大执行时间 */
const TASK_TIMEOUT_MS = 120_000

// ─── TaskCoordinator ──────────────────────────

/**
 * FIFO 串行任务队列
 *
 * - enqueue(): 新任务入队，若无正在运行的任务则立即执行
 * - cancel(): 取消指定任务（运行中 → abort，排队中 → 移除）
 * - 每个任务完成/失败/取消后自动 drain 下一个
 */
export class TaskCoordinator {
  private queue: Task[] = []
  private running: Task | null = null
  private abortController: AbortController | null = null
  private taskTimer: ReturnType<typeof setTimeout> | null = null

  /** 获取会话历史的回调，由外部注入 */
  private getHistory: () => ChatMessageData[]
  /** 任务完成后追加本轮产生的所有消息（含 tool_calls / tool_result / final assistant） */
  private pushMessages: (messages: ChatMessageData[]) => void

  constructor(
    getHistory: () => ChatMessageData[],
    pushMessages: (messages: ChatMessageData[]) => void
  ) {
    this.getHistory = getHistory
    this.pushMessages = pushMessages
  }

  /**
   * 将新任务加入队列
   * @returns true 入队成功，false 队列已满
   */
  enqueue(taskId: string, content: string, callbacks: TaskCallbacks): boolean {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      console.warn(`[coordinator] queue full (${MAX_QUEUE_SIZE}), rejecting task ${taskId}`)
      return false
    }

    const task: Task = { taskId, content, status: 'pending', callbacks }
    this.queue.push(task)
    console.log(`[coordinator] enqueued task ${taskId} (queue: ${this.queue.length})`)

    this.drain()
    return true
  }

  /**
   * 取消指定任务
   * - 正在运行 → abort + 标记 cancelled
   * - 排队中 → 直接移除
   * - 不存在 → 忽略
   */
  cancel(taskId: string): void {
    // 正在运行的任务
    if (this.running?.taskId === taskId) {
      this.running.status = 'cancelled'
      this.abortController?.abort()
      this.clearTaskTimer()
      this.running.callbacks.onCancelled()
      this.running = null
      this.abortController = null
      this.drain()
      return
    }

    // 排队中的任务
    const idx = this.queue.findIndex((t) => t.taskId === taskId)
    if (idx !== -1) {
      const [removed] = this.queue.splice(idx, 1)
      removed.status = 'cancelled'
      removed.callbacks.onCancelled()
    }
  }

  /** 当前是否有任务在运行 */
  get busy(): boolean {
    return this.running !== null
  }

  /** 队列中等待的任务数 */
  get pendingCount(): number {
    return this.queue.length
  }

  // ─── 内部 ───────────────────────────────────

  private clearTaskTimer(): void {
    if (this.taskTimer) {
      clearTimeout(this.taskTimer)
      this.taskTimer = null
    }
  }

  private drain(): void {
    if (this.running) return
    const next = this.queue.shift()
    if (!next) return

    this.running = next
    next.status = 'running'
    console.log(`[coordinator] running task ${next.taskId}`)

    // task 级超时：120s 后强制终止
    this.taskTimer = setTimeout(() => {
      if (this.running?.taskId === next.taskId) {
        console.warn(`[coordinator] task ${next.taskId} timed out after ${TASK_TIMEOUT_MS}ms`)
        this.abortController?.abort()
        next.status = 'failed'
        next.callbacks.onError('TASK_TIMEOUT', `任务超时（${TASK_TIMEOUT_MS / 1000}s）`)
        this.running = null
        this.abortController = null
        this.taskTimer = null
        this.drain()
      }
    }, TASK_TIMEOUT_MS)

    this.abortController = agentLoop({
      prompt: next.content,
      history: this.getHistory(),
      onToken: (delta) => next.callbacks.onToken(delta),
      onStatus: next.callbacks.onStatus ? (text) => next.callbacks.onStatus!(text) : undefined,
      onDone: (fullContent, newMessages) => {
        next.status = 'done'
        this.clearTaskTimer()
        this.pushMessages(newMessages)
        next.callbacks.onDone(fullContent)
        this.running = null
        this.abortController = null
        this.drain()
      },
      onError: (code, message) => {
        next.status = 'failed'
        this.clearTaskTimer()
        next.callbacks.onError(code, message)
        this.running = null
        this.abortController = null
        this.drain()
      }
    })
  }
}
