/**
 * InterpretService — B4.1
 *
 * 后台记忆提取服务：对话结束后，自动将值得长期保留的内容提取为结构化记忆。
 *
 * 触发机制（buffer 累积制）：
 *   - 每轮对话结束后将本轮新消息追加进 buffer
 *   - 当满足任一触发条件时，启动一次 backgroundAgentLoop：
 *     1. 累积 token ≥ 500
 *     2. 累积轮次 ≥ 3
 *     3. 用户静默 ≥ 2 分钟
 *   - 日级兜底：seal day 时 buffer 有残留则强制触发
 *
 * 工具设计（防呆原则）：
 *   - 仅暴露 `upsert_memory` 一个工具
 *   - LLM 只传 type + 语义字段 + 内容字段，不传 id / 路径
 *   - service 层自动判断是新建还是合并更新
 */
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import type { ChatMessageData, ToolSchema, ToolResult } from '@desktop-claw/shared'
import { backgroundAgentLoop } from '../agent/loop'
import { resolveSkillsDir } from '../agent/skill-manager'
import { extractFrontmatter } from '../agent/skill-primitives'
import { memoryIndexService } from './memory-index-service'
import { estimateTokens } from '../llm/token-estimator'
import { executeUpsertMemory, UPSERT_MEMORY_PROPERTIES } from './upsert-memory-executor'

// ─── 触发阈值 ─────────────────────────────────

const TOKEN_THRESHOLD = 500
const ROUND_THRESHOLD = 3
const SILENCE_MS = 2 * 60 * 1000 // 2 分钟

// ─── Buffer 状态 ──────────────────────────────

let pendingMessages: ChatMessageData[] = []
let accumulatedTokens = 0
let accumulatedRounds = 0
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let runningPromise: Promise<void> | null = null

// ─── 公开接口 ─────────────────────────────────

/**
 * 将一轮对话的新消息喂入 interpret buffer。
 * 由 ws.ts 在每轮 task 完成后调用。
 */
export function feedInterpretBuffer(messages: ChatMessageData[]): void {
  for (const msg of messages) {
    // 只将 user 和 assistant 消息纳入 buffer（tool 消息不独立计 token）
    if (msg.role === 'user' || msg.role === 'assistant') {
      pendingMessages.push(msg)
      accumulatedTokens += estimateTokens(msg.content || '')
      if (msg.role === 'user') accumulatedRounds++
    }
  }

  // 重置静默计时器
  resetSilenceTimer()

  // 检查 token / 轮次阈值
  if (accumulatedTokens >= TOKEN_THRESHOLD || accumulatedRounds >= ROUND_THRESHOLD) {
    void triggerInterpret()
  }
}

/**
 * 强制刷出 buffer 中的残留内容（日级兜底）。
 * 由 memory-service.ts 的 seal day 流程调用。
 */
export async function flushInterpretBuffer(): Promise<void> {
  if (silenceTimer) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
  // 如果 interpret 正在运行，限时等待其完成（15s，不阻塞关机链路）
  if (running && runningPromise) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        runningPromise,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.warn('[interpret] flush: running interpret timed out (15s), proceeding')
            resolve()
          }, 15000)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  // 再刷出 buffer 中的残留（限时 15s，不阻塞关机链路）
  if (pendingMessages.length > 0 && !running) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        triggerInterpret(),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.warn('[interpret] flush: pending interpret timed out (15s), proceeding')
            resolve()
          }, 15000)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

// ─── 内部实现 ─────────────────────────────────

function resetSilenceTimer(): void {
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = setTimeout(() => {
    if (pendingMessages.length > 0 && !running) {
      void triggerInterpret()
    }
  }, SILENCE_MS)
}

function triggerInterpret(): Promise<void> {
  if (running) return Promise.resolve()
  if (pendingMessages.length === 0) return Promise.resolve()

  running = true
  if (silenceTimer) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }

  // 快照并清空 buffer
  const snapshot = [...pendingMessages]
  pendingMessages = []
  accumulatedTokens = 0
  accumulatedRounds = 0

  const p = (async () => {
    try {
      await runInterpret(snapshot)
    } catch (err) {
      console.error('[interpret] failed:', err)
    } finally {
      running = false
      runningPromise = null
    }
  })()

  runningPromise = p
  return p
}

async function runInterpret(messages: ChatMessageData[]): Promise<void> {
  const systemPrompt = loadInterpretSystemPrompt()
  if (!systemPrompt) {
    console.warn('[interpret] SKILL.md not found, skipping')
    return
  }

  const userMessage = assembleUserMessage(messages)

  console.log(
    `[interpret] starting: ${messages.length} messages, ` +
    `~${messages.reduce((n, m) => n + estimateTokens(m.content || ''), 0)} tokens`
  )

  const result = await backgroundAgentLoop({
    systemPrompt,
    userMessage,
    tools: [UPSERT_MEMORY_SCHEMA],
    executeTool: executeInterpretTool
  })

  console.log(
    `[interpret] done: success=${result.success}, toolCalls=${result.toolCallCount}` +
    (result.error ? `, error=${result.error}` : '')
  )
}

// ─── System Prompt 加载 ──────────────────────

function loadInterpretSystemPrompt(): string | null {
  const skillsDir = resolveSkillsDir()
  const skillMdPath = join(skillsDir, 'memory-interpret', 'SKILL.md')

  if (!existsSync(skillMdPath)) return null

  const raw = readFileSync(skillMdPath, 'utf-8')
  const { body } = extractFrontmatter(raw)
  return body
}

// ─── User Message 组装 ───────────────────────

function assembleUserMessage(messages: ChatMessageData[]): string {
  const parts: string[] = []

  // 1. 注入当前 memory index 摘要
  const indexSummary = buildIndexSummary()
  if (indexSummary) {
    parts.push('## 当前已有记忆索引\n\n' + indexSummary)
  }

  // 2. 指令
  const today = new Date().toISOString().split('T')[0]
  parts.push(
    '## 任务\n\n' +
    `请阅读以下对话内容（日期：${today}），判断其中是否有值得长期保留的信息。\n` +
    '如果有，使用 upsert_memory 工具逐条提取。如果没有值得提取的，直接回复"无需提取"。\n' +
    '注意：宁缺毋滥。闲聊和一次性问答不需要提取。'
  )

  // 3. 对话内容
  const transcript = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const role = m.role === 'user' ? '用户' : 'Claw'
      // 截断过长的单条消息，防止 token 爆炸
      const content = m.content.length > 2000
        ? m.content.slice(0, 2000) + '…(截断)'
        : m.content
      return `${role}：${content}`
    })
    .join('\n\n')

  parts.push('## 对话内容\n\n' + transcript)

  return parts.join('\n\n')
}

function buildIndexSummary(): string | null {
  const manifest = memoryIndexService.getManifest()
  if (manifest.indexes.length === 0) return null

  const sections: string[] = []

  for (const idx of manifest.indexes) {
    if (idx.count === 0) continue
    const entries = memoryIndexService.getEntries(idx.type)
    const lines = entries.slice(0, 20).map(e => `- ${e.label}: ${e.summary}`)
    if (entries.length > 20) {
      lines.push(`- …还有 ${entries.length - 20} 条`)
    }
    sections.push(`### ${idx.type} (${idx.count} 条)\n${lines.join('\n')}`)
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

// ─── upsert_memory 工具 ──────────────────────

const UPSERT_MEMORY_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'upsert_memory',
    description:
      '创建或更新一条结构化记忆。系统自动判断是新建还是合并更新：' +
      'Self Memory 按 category+key 匹配；Relationship 按 name 匹配；Topic 按 name 匹配。' +
      '不要传 id / createdAt / updatedAt。',
    parameters: {
      type: 'object',
      properties: UPSERT_MEMORY_PROPERTIES,
      required: ['type', 'summary']
    }
  }
}

// ─── upsert_memory 执行器（薄包装） ──────────

async function executeInterpretTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  if (toolName !== 'upsert_memory') {
    return { success: false, content: '', error: `未知工具: ${toolName}` }
  }
  return executeUpsertMemory(args, { savedByUser: false })
}
