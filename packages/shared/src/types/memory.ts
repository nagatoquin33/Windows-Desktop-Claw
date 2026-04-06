// ─── Memory System Schema ────────────────────
// B1: 六类记忆对象的 TypeScript 类型定义
// 设计依据：PLAN-Memory-System.md

// ─── B1.1 统一基础接口 ──────────────────────

/** 记忆对象类型标识 */
export type MemoryType =
  | 'source'
  | 'self'
  | 'relationship'
  | 'topic'
  | 'saved'

/** 来源引用：追溯到原始对话或文件 */
export interface SourceRef {
  /** 来源类型 */
  kind: 'conversation' | 'file' | 'user_input'
  /** 原始对话日期（YYYY-MM-DD），kind=conversation 时使用 */
  date?: string
  /** 原始消息索引或片段标识 */
  messageIndex?: number
  /** 文件 source id，kind=file 时使用 */
  sourceId?: string
  /** 简要说明这条引用的上下文 */
  note?: string
}

/** 所有 memory 对象的公共基础接口 */
export interface MemoryObjectBase {
  /** 唯一标识（UUID） */
  id: string
  /** 对象类型 */
  type: MemoryType
  /** 创建时间 ISO */
  createdAt: string
  /** 最后更新时间 ISO */
  updatedAt: string
  /** 来源追溯 */
  sourceRefs: SourceRef[]
}

// ─── B1.2 Source / File Record ───────────────

/** Source 存储模式 */
export type SourceMode = 'reference-only' | 'reference+extracted' | 'snapshot'

/** Source 状态 */
export type SourceStatus = 'active' | 'stale' | 'deleted'

/** 快速指纹：path + mtime + size */
export interface FastFingerprint {
  path: string
  mtimeMs: number
  size: number
}

/** Source / File Record */
export interface SourceRecord extends MemoryObjectBase {
  type: 'source'

  /** 文件名或资料标题 */
  name: string
  /** 文件路径或 URL */
  path: string
  /** 文件 MIME 类型或简要类型描述（如 'pdf', 'markdown', 'url'） */
  fileType: string
  /** 存储模式 */
  mode: SourceMode
  /** 当前状态 */
  status: SourceStatus

  // ── 指纹与哈希 ──

  /** 快速指纹（用于变更检测） */
  fastFingerprint?: FastFingerprint
  /** 内容哈希（SHA-256），reference+extracted 或 snapshot 时优先生成 */
  contentHash?: string

  // ── 提取文本（MVP 预留扩展位，第一版不启用持久化） ──

  /** extracted text 文件路径（预留） */
  extractedTextPath?: string
  /** 提取状态（预留） */
  extractionStatus?: 'pending' | 'done' | 'failed' | 'skipped'

  // ── 快照 ──

  /** 快照文件路径（mode=snapshot 时使用） */
  snapshotPath?: string

  // ── 关联 ──

  /** 关联的 topic id 列表 */
  linkedTopicIds: string[]
  /** LLM 提取 / 用户提供的简要摘要 */
  summary: string
  /** 关键词标签 */
  keywords: string[]
}

// ─── B1.3 Self Memory ────────────────────────

/** Self Memory 分类 */
export type SelfCategory =
  | 'identity'
  | 'preference'
  | 'communication_style'
  | 'working_style'

/** Self Memory 条目 */
export interface SelfMemoryItem extends MemoryObjectBase {
  type: 'self'

  /** 分类 */
  category: SelfCategory
  /** 简短标识键（如 'name', 'language_preference', 'thinking_style'） */
  key: string
  /** 一句话摘要 */
  summary: string
  /** 详细描述（可选） */
  detail?: string
  /** 置信度 0-1（LLM 自评） */
  confidence: number
}

// ─── B1.4 Relationship Memory ────────────────

/** Relationship Memory 条目 */
export interface RelationshipMemoryItem extends MemoryObjectBase {
  type: 'relationship'

  /** 人物名称（第一版按用户提及的名字直接记录） */
  name: string
  /** 与用户的关系（如 'colleague', 'friend', 'boss', 'family'） */
  relation: string
  /** 一句话摘要 */
  summary: string
  /** 详细描述（可选） */
  detail?: string
  /** 已知的稳定事实列表 */
  facts: string[]
  /** 置信度 0-1 */
  confidence: number

  // ── 预留扩展位：别名合并 ──
  // aliases?: string[]
}

// ─── B1.5 Topic Memory ──────────────────────

/** Topic 生命周期状态 */
export type TopicStatus = 'active' | 'paused' | 'archived'

/** Topic Memory 条目 */
export interface TopicMemoryItem extends MemoryObjectBase {
  type: 'topic'

  /** 简短标识键（URL-safe slug，如 'emotion-layer-design'） */
  key: string
  /** 主题名称（人可读） */
  name: string
  /** 生命周期状态 */
  status: TopicStatus
  /** 当前摘要 */
  summary: string
  /** 详细描述（可选） */
  detail?: string

  // ── 关联 ──

  /** 关联的 source id 列表 */
  linkedSourceIds: string[]

  // ── 结论与问题 ──

  /** 近期结论 */
  recentConclusions: string[]
  /** 待补 / 开放问题 */
  openQuestions: string[]

  /** 最近一次活跃时间 ISO（有新的讨论或更新时刷新） */
  lastActiveAt: string
}

// ─── B1.6 User-Saved Archive ────────────────

/** Saved 条目类型 */
export type SavedKind =
  | 'conversation_ref'
  | 'source_ref'
  | 'text_note'
  | 'arrangement'

/** User-Saved Archive 条目 */
export interface SavedArchiveItem extends MemoryObjectBase {
  type: 'saved'

  /** 存档类型 */
  savedKind: SavedKind
  /** 标题 */
  title: string
  /** 一句话摘要 */
  summary: string
  /** 详细内容（可选） */
  detail?: string

  // ── 关联 ──

  /** 关联的 source id 列表 */
  linkedSourceIds: string[]
  /** 关联的 topic id 列表 */
  linkedTopicIds: string[]

  // ── 存档元信息 ──

  /** 是否由用户主动存档（第一版固定为 true） */
  savedByUser: boolean
  /** 用户存档原因 / 意图描述 */
  savedReason?: string
}

// ─── 联合类型 ─────────────────────────────

/** 所有 memory 对象的联合类型 */
export type MemoryObject =
  | SourceRecord
  | SelfMemoryItem
  | RelationshipMemoryItem
  | TopicMemoryItem
  | SavedArchiveItem

// ─── Index Entry ─────────────────────────────

/** Index 条目：最小公共字段 */
export interface MemoryIndexEntry {
  /** 对象 id */
  id: string
  /** 对象类型 */
  type: MemoryType
  /** 显示标签（名称 / 标题 / key） */
  label: string
  /** 一句话摘要 */
  summary: string
  /** 最后更新时间 ISO */
  updatedAt: string
}

/** Source Index 扩展条目 */
export interface SourceIndexEntry extends MemoryIndexEntry {
  type: 'source'
  fileType: string
  mode: SourceMode
  status: SourceStatus
}

/** Self Index 扩展条目 */
export interface SelfIndexEntry extends MemoryIndexEntry {
  type: 'self'
  category: SelfCategory
}

/** Relationship Index 扩展条目 */
export interface RelationshipIndexEntry extends MemoryIndexEntry {
  type: 'relationship'
  relation: string
}

/** Topic Index 扩展条目 */
export interface TopicIndexEntry extends MemoryIndexEntry {
  type: 'topic'
  status: TopicStatus
}

/** Saved Index 扩展条目 */
export interface SavedIndexEntry extends MemoryIndexEntry {
  type: 'saved'
  savedKind: SavedKind
}

/** Manifest：index 总入口 */
export interface MemoryManifest {
  /** 最后一次全量重建时间 ISO */
  lastRebuiltAt: string
  /** 各分类 index 的元信息 */
  indexes: {
    type: MemoryType
    path: string
    count: number
    updatedAt: string
  }[]
}
