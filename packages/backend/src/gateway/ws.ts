import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import type { ChatMessageData } from '@desktop-claw/shared'
import { agentLoop } from '../agent/loop'

/** 内存会话记录（MVP：单对话，无持久化） */
const conversation: ChatMessageData[] = []
const clients = new Set<WebSocket>()

/** 当前运行中的任务（用于取消） */
let activeAbort: AbortController | null = null
let activeTaskId: string | null = null

let msgCounter = 0
function genMsgId(): string {
  return `msg_${Date.now()}_${++msgCounter}`
}

function sendTo(ws: WebSocket, envelope: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(envelope))
  }
}

function broadcast(envelope: object): void {
  const data = JSON.stringify(envelope)
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(data)
    }
  }
}

/**
 * 注册 Fastify WebSocket 插件并设置 /ws 路由
 */
export async function setupWebSocket(app: FastifyInstance): Promise<void> {
  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket)
    console.log(`[ws] client connected (total: ${clients.size})`)

    // 新连接发送当前会话历史
    sendTo(socket, {
      id: genMsgId(),
      type: 'conversation.history',
      taskId: '',
      ts: new Date().toISOString(),
      payload: { messages: conversation }
    })

    socket.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString())
        handleClientMessage(data)
      } catch {
        console.error('[ws] failed to parse message')
      }
    })

    socket.on('close', () => {
      clients.delete(socket)
      console.log(`[ws] client disconnected (total: ${clients.size})`)
    })
  })
}

function handleClientMessage(
  msg: { type: string; taskId: string; payload?: Record<string, unknown> }
): void {
  switch (msg.type) {
    case 'task.create': {
      const content = (msg.payload?.content as string) ?? ''

      // 记录用户消息
      conversation.push({ role: 'user', content })

      // 广播 ack（附带 content 以便其他窗口同步用户消息）
      broadcast({
        id: genMsgId(),
        type: 'task.ack',
        taskId: msg.taskId,
        ts: new Date().toISOString(),
        payload: { content }
      })

      // Agent Loop（替代直接调 LLM）
      activeTaskId = msg.taskId
      activeAbort = agentLoop({
        prompt: content,
        history: conversation.slice(0, -1), // 不含刚 push 的当前 user 消息（loop 内部会自己追加）
        onToken(delta) {
          broadcast({
            id: genMsgId(),
            type: 'task.token',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { delta }
          })
        },
        onDone(fullContent) {
          conversation.push({ role: 'assistant', content: fullContent })
          broadcast({
            id: genMsgId(),
            type: 'task.done',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { content: fullContent }
          })
          activeAbort = null
          activeTaskId = null
        },
        onError(code, message) {
          broadcast({
            id: genMsgId(),
            type: 'task.error',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { code, message }
          })
          activeAbort = null
          activeTaskId = null
        }
      })
      break
    }
    case 'task.cancel': {
      if (activeAbort && activeTaskId === msg.taskId) {
        activeAbort.abort()
        activeAbort = null
        activeTaskId = null
      }
      broadcast({
        id: genMsgId(),
        type: 'task.cancelled',
        taskId: msg.taskId,
        ts: new Date().toISOString(),
        payload: {}
      })
      break
    }
    default:
      console.warn('[ws] unknown message type:', msg.type)
  }
}
