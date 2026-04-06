/**
 * save-memory-tool — B4.2
 *
 * 对话 loop 中的进程内 Tool：用户主动要求保存记忆时调用。
 * 复用 upsert-memory-executor 的共享逻辑，标记 savedByUser = true。
 */
import type { ToolSchema, ToolDefinition } from '@desktop-claw/shared'
import { executeUpsertMemory, UPSERT_MEMORY_PROPERTIES } from './upsert-memory-executor'
import { compileCapsules } from './capsule-compiler'

const SAVE_MEMORY_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'save_memory',
    description:
      '保存一条用户明确要求记住的信息。支持四种类型：' +
      'self（用户自身属性）、relationship（人际关系）、topic（话题/项目）、saved（通用存档）。' +
      '系统自动判断新建或合并更新。',
    parameters: {
      type: 'object',
      properties: UPSERT_MEMORY_PROPERTIES,
      required: ['type', 'summary']
    }
  }
}

export const saveMemoryTool: ToolDefinition = {
  schema: SAVE_MEMORY_SCHEMA,
  execute: async (args) => {
    const result = await executeUpsertMemory(args, { savedByUser: true })
    if (result.success) {
      try { await compileCapsules() } catch { /* recompile best-effort */ }
    }
    return result
  }
}
