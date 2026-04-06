/**
 * forget-memory-tool — C-light
 *
 * 对话 loop 中的进程内 Tool：用户要求遗忘/删除某条记忆时调用。
 * 通过 query_index 找到的 id + type 来定位要删除的记忆。
 * 删除后自动触发 capsule 重新编译。
 */
import type { ToolSchema, ToolDefinition, ToolResult, MemoryType } from '@desktop-claw/shared'
import { memoryStoreService } from './memory-store-service'
import { compileCapsules } from './capsule-compiler'

const FORGET_MEMORY_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'forget_memory',
    description:
      '删除一条记忆。当用户说「忘掉这个」「删掉这条」「这个不对，别记了」时使用。' +
      '需要先用 query_index 查到要删除的记忆的 type 和 id。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['self', 'relationship', 'topic', 'saved'],
          description: '要删除的记忆类型'
        },
        id: {
          type: 'string',
          description: '要删除的记忆 ID（从 query_index 结果中获取）'
        },
        reason: {
          type: 'string',
          description: '删除原因（可选，用于日志记录）'
        }
      },
      required: ['type', 'id']
    }
  }
}

async function executeForgetMemory(args: Record<string, unknown>): Promise<ToolResult> {
  const type = args.type as MemoryType | undefined
  const id = args.id as string | undefined
  const reason = args.reason as string | undefined

  if (!type || !['self', 'relationship', 'topic', 'saved'].includes(type)) {
    return { success: false, content: '', error: `无效的 type: ${type}` }
  }
  if (!id) {
    return { success: false, content: '', error: '缺少 id' }
  }

  try {
    const deleted = await memoryStoreService.delete(type, id)
    if (!deleted) {
      return { success: false, content: '', error: `未找到 ${type}/${id}，可能已删除` }
    }

    console.log(`[forget-memory] deleted ${type}/${id}${reason ? ` — ${reason}` : ''}`)

    // 删除后重新编译 prompt capsule
    try {
      await compileCapsules()
    } catch (err) {
      console.error('[forget-memory] recompile failed:', err)
    }

    return { success: true, content: `已删除记忆 ${type}/${id}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, content: '', error: msg }
  }
}

export const forgetMemoryTool: ToolDefinition = {
  schema: FORGET_MEMORY_SCHEMA,
  execute: (args) => executeForgetMemory(args)
}
