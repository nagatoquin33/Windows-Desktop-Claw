/**
 * upsert-memory-executor — B4.2
 *
 * 共享的记忆 upsert 执行器。
 * 被 interpret-service（后台提取）和 save-memory-tool（对话 loop）共同使用。
 *
 * 语义匹配规则：
 *   - self: category + key 完全匹配 → 更新；否则新建
 *   - relationship: name（不区分大小写）→ 更新；否则新建
 *   - topic: name（不区分大小写）→ 更新；否则新建
 *   - saved: 总是新建（不做 upsert 合并）
 */
import type {
  ToolResult,
  ToolSchema,
  MemoryType,
  SourceRef,
  SelfCategory,
  TopicStatus,
  SavedKind,
  SelfMemoryItem,
  RelationshipMemoryItem,
  TopicMemoryItem,
  SavedArchiveItem
} from '@desktop-claw/shared'
import { memoryStoreService } from './memory-store-service'

// ─── 公共参数 Schema（供工具定义复用） ────────

type ToolProperties = ToolSchema['function']['parameters']['properties']

/** upsert_memory / save_memory 共享的 parameters.properties 定义 */
export const UPSERT_MEMORY_PROPERTIES: ToolProperties = {
  type: {
    type: 'string',
    enum: ['self', 'relationship', 'topic', 'saved'],
    description: '记忆类型'
  },
  summary: {
    type: 'string',
    description: '一句话摘要（必填）'
  },
  detail: {
    type: 'string',
    description: '详细描述（可选）'
  },
  confidence: {
    type: 'number',
    description: '置信度 0-1（self / relationship 可选）'
  },
  source_refs: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['conversation', 'file', 'user_input'] },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        note: { type: 'string' }
      },
      required: ['kind']
    },
    description: '来源引用'
  },
  // Self Memory 专用
  category: {
    type: 'string',
    enum: ['identity', 'preference', 'communication_style', 'working_style'],
    description: 'Self Memory 分类（type=self 时必填）'
  },
  key: {
    type: 'string',
    description: 'Self Memory 简短标识键，如 name、timezone（type=self 时必填）'
  },
  // Relationship Memory 专用
  name: {
    type: 'string',
    description: '人物名 / 主题名（type=relationship 或 type=topic 时必填）'
  },
  relation: {
    type: 'string',
    description: '与用户的关系，如 colleague、friend、boss（type=relationship 时必填）'
  },
  facts: {
    type: 'array',
    items: { type: 'string' },
    description: '已知稳定事实列表（type=relationship 可选）'
  },
  // Topic Memory 专用
  status: {
    type: 'string',
    enum: ['active', 'paused', 'archived'],
    description: 'Topic 状态（type=topic 可选，默认 active）'
  },
  recent_conclusions: {
    type: 'array',
    items: { type: 'string' },
    description: '近期结论（type=topic 可选）'
  },
  open_questions: {
    type: 'array',
    items: { type: 'string' },
    description: '待补问题（type=topic 可选）'
  },
  linked_source_ids: {
    type: 'array',
    items: { type: 'string' },
    description: '关联 source id（type=topic 可选）'
  },
  // Saved Archive 专用
  saved_kind: {
    type: 'string',
    enum: ['conversation_ref', 'source_ref', 'text_note', 'arrangement'],
    description: '存档类型（type=saved 时必填）'
  },
  title: {
    type: 'string',
    description: '存档标题（type=saved 时必填）'
  },
  saved_reason: {
    type: 'string',
    description: '保存原因（type=saved 可选）'
  }
}

// ─── 执行选项 ────────────────────────────────

export interface UpsertOptions {
  /** saved type: true = 用户主动保存, false = 后台 interpret */
  savedByUser: boolean
}

// ─── 主执行器 ────────────────────────────────

export async function executeUpsertMemory(
  args: Record<string, unknown>,
  options: UpsertOptions
): Promise<ToolResult> {
  const type = args.type as MemoryType | undefined
  if (!type || !['self', 'relationship', 'topic', 'saved'].includes(type)) {
    return { success: false, content: '', error: `无效的 type: ${type}` }
  }

  const summary = args.summary as string | undefined
  if (!summary) {
    return { success: false, content: '', error: '缺少 summary' }
  }

  const sourceRefs = (args.source_refs as SourceRef[] | undefined) ?? []

  try {
    switch (type) {
      case 'self':
        return await upsertSelf(args, summary, sourceRefs)
      case 'relationship':
        return await upsertRelationship(args, summary, sourceRefs)
      case 'topic':
        return await upsertTopic(args, summary, sourceRefs)
      case 'saved':
        return await upsertSaved(args, summary, sourceRefs, options.savedByUser)
      default:
        return { success: false, content: '', error: `不支持的类型: ${type}` }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[upsert-memory] error (${type}):`, msg)
    return { success: false, content: '', error: msg }
  }
}

// ─── 类型分派 ────────────────────────────────

async function upsertSelf(
  args: Record<string, unknown>,
  summary: string,
  sourceRefs: SourceRef[]
): Promise<ToolResult> {
  const category = args.category as SelfCategory | undefined
  const key = args.key as string | undefined

  if (!category || !key) {
    return { success: false, content: '', error: 'Self Memory 需要 category 和 key' }
  }

  const existing = findSelf(category, key)

  if (existing) {
    await memoryStoreService.update<SelfMemoryItem>('self', existing.id, {
      summary,
      detail: (args.detail as string | undefined) ?? existing.detail,
      confidence: (args.confidence as number | undefined) ?? existing.confidence,
      sourceRefs: mergeSourceRefs(existing.sourceRefs, sourceRefs)
    })
    return {
      success: true,
      content: `已更新 Self Memory [${category}/${key}]: ${summary}`
    }
  }

  await memoryStoreService.create<SelfMemoryItem>({
    type: 'self',
    category,
    key,
    summary,
    detail: args.detail as string | undefined,
    confidence: (args.confidence as number | undefined) ?? 0.8,
    sourceRefs
  })
  return {
    success: true,
    content: `已创建 Self Memory [${category}/${key}]: ${summary}`
  }
}

async function upsertRelationship(
  args: Record<string, unknown>,
  summary: string,
  sourceRefs: SourceRef[]
): Promise<ToolResult> {
  const name = args.name as string | undefined
  const relation = args.relation as string | undefined

  if (!name) {
    return { success: false, content: '', error: 'Relationship Memory 需要 name' }
  }

  const existing = findRelationship(name)

  if (existing) {
    const newFacts = args.facts as string[] | undefined
    const mergedFacts = newFacts
      ? [...new Set([...existing.facts, ...newFacts])]
      : existing.facts

    await memoryStoreService.update<RelationshipMemoryItem>('relationship', existing.id, {
      summary,
      relation: relation ?? existing.relation,
      detail: (args.detail as string | undefined) ?? existing.detail,
      facts: mergedFacts,
      confidence: (args.confidence as number | undefined) ?? existing.confidence,
      sourceRefs: mergeSourceRefs(existing.sourceRefs, sourceRefs)
    })
    return {
      success: true,
      content: `已更新 Relationship Memory [${name}]: ${summary}`
    }
  }

  await memoryStoreService.create<RelationshipMemoryItem>({
    type: 'relationship',
    name,
    relation: relation ?? 'unknown',
    summary,
    detail: args.detail as string | undefined,
    facts: (args.facts as string[] | undefined) ?? [],
    confidence: (args.confidence as number | undefined) ?? 0.8,
    sourceRefs
  })
  return {
    success: true,
    content: `已创建 Relationship Memory [${name}]: ${summary}`
  }
}

async function upsertTopic(
  args: Record<string, unknown>,
  summary: string,
  sourceRefs: SourceRef[]
): Promise<ToolResult> {
  const name = args.name as string | undefined

  if (!name) {
    return { success: false, content: '', error: 'Topic Memory 需要 name' }
  }

  const existing = findTopic(name)

  if (existing) {
    const newConclusions = args.recent_conclusions as string[] | undefined
    const newQuestions = args.open_questions as string[] | undefined

    await memoryStoreService.update<TopicMemoryItem>('topic', existing.id, {
      summary,
      status: (args.status as TopicStatus | undefined) ?? existing.status,
      detail: (args.detail as string | undefined) ?? existing.detail,
      linkedSourceIds: (args.linked_source_ids as string[] | undefined) ?? existing.linkedSourceIds,
      recentConclusions: newConclusions
        ? [...new Set([...existing.recentConclusions, ...newConclusions])]
        : existing.recentConclusions,
      openQuestions: newQuestions
        ? [...new Set([...existing.openQuestions, ...newQuestions])]
        : existing.openQuestions,
      lastActiveAt: new Date().toISOString(),
      sourceRefs: mergeSourceRefs(existing.sourceRefs, sourceRefs)
    })
    return {
      success: true,
      content: `已更新 Topic Memory [${name}]: ${summary}`
    }
  }

  const topicKey = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').slice(0, 60)

  await memoryStoreService.create<TopicMemoryItem>({
    type: 'topic',
    key: topicKey,
    name,
    status: (args.status as TopicStatus | undefined) ?? 'active',
    summary,
    detail: args.detail as string | undefined,
    linkedSourceIds: (args.linked_source_ids as string[] | undefined) ?? [],
    recentConclusions: (args.recent_conclusions as string[] | undefined) ?? [],
    openQuestions: (args.open_questions as string[] | undefined) ?? [],
    lastActiveAt: new Date().toISOString(),
    sourceRefs
  })
  return {
    success: true,
    content: `已创建 Topic Memory [${name}]: ${summary}`
  }
}

async function upsertSaved(
  args: Record<string, unknown>,
  summary: string,
  sourceRefs: SourceRef[],
  savedByUser: boolean
): Promise<ToolResult> {
  const savedKind = args.saved_kind as SavedKind | undefined
  const title = args.title as string | undefined

  if (!savedKind || !title) {
    return { success: false, content: '', error: 'Saved Archive 需要 saved_kind 和 title' }
  }

  await memoryStoreService.create<SavedArchiveItem>({
    type: 'saved',
    savedKind,
    title,
    summary,
    detail: args.detail as string | undefined,
    linkedSourceIds: [],
    linkedTopicIds: [],
    savedByUser,
    savedReason: args.saved_reason as string | undefined,
    sourceRefs
  })
  return {
    success: true,
    content: `已创建 Saved Archive [${title}]: ${summary}`
  }
}

// ─── 语义匹配查找 ────────────────────────────

function findSelf(category: SelfCategory, key: string): SelfMemoryItem | null {
  const items = memoryStoreService.listByType('self') as SelfMemoryItem[]
  return items.find((i) => i.category === category && i.key === key) ?? null
}

function findRelationship(name: string): RelationshipMemoryItem | null {
  const items = memoryStoreService.listByType('relationship') as RelationshipMemoryItem[]
  const nameLower = name.toLowerCase()
  return items.find((i) => i.name.toLowerCase() === nameLower) ?? null
}

function findTopic(name: string): TopicMemoryItem | null {
  const items = memoryStoreService.listByType('topic') as TopicMemoryItem[]
  const nameLower = name.toLowerCase()
  return items.find((i) => i.name.toLowerCase() === nameLower) ?? null
}

// ─── 辅助 ──────────────────────────────────

/** 合并 source_refs，去重（按 kind+date+sourceId 判断） */
function mergeSourceRefs(existing: SourceRef[], incoming: SourceRef[]): SourceRef[] {
  const merged = [...existing]
  for (const ref of incoming) {
    const dup = merged.some(
      (e) => e.kind === ref.kind && e.date === ref.date && e.sourceId === ref.sourceId
    )
    if (!dup) merged.push(ref)
  }
  return merged
}
