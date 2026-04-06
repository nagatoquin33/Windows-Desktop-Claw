// ─── Tool 类型定义（Skill 体系核心类型） ───────────

/** Tool Use JSON Schema 声明（传给 LLM API 的 tools[] 参数） */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<
        string,
        {
          type: string
          description: string
          enum?: string[]
          /** array 类型的元素 schema */
          items?: Record<string, unknown>
          [key: string]: unknown
        }
      >
      required: string[]
    }
  }
}

/** Tool 执行结果 */
export interface ToolResult {
  success: boolean
  /** 返回给 LLM 的文本结果 */
  content: string
  /** 失败时的错误说明 */
  error?: string
}

/** 一个完整的 Tool 定义（schema + execute） */
export interface ToolDefinition {
  schema: ToolSchema
  execute: (args: Record<string, unknown>) => Promise<ToolResult>
}

/** LLM 返回的 tool_call 结构 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}
