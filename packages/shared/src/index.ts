// Shared 公共类型与工具
export type {
  WsEnvelope,
  WsMessageType,
  ClientMessageType,
  ServerMessageType,
  TaskCreatePayload,
  TaskAckPayload,
  TaskTokenPayload,
  TaskDonePayload,
  TaskErrorPayload,
  ChatMessageData,
  ConversationHistoryPayload,
  FileAttachment
} from './types/ws'

export type {
  ToolSchema,
  ToolResult,
  ToolDefinition,
  ToolCall
} from './types/tool'

export type {
  EmotionState,
  EmotionSnapshot
} from './types/emotion'

export {
  EMOTION_PRIORITY,
  EMOTION_MIN_HOLD_MS,
  EMOTION_DEBOUNCE_MS
} from './types/emotion'

// ─── Memory System ───────────────────────────

export type {
  MemoryType,
  SourceRef,
  MemoryObjectBase,
  SourceMode,
  SourceStatus,
  FastFingerprint,
  SourceRecord,
  SelfCategory,
  SelfMemoryItem,
  RelationshipMemoryItem,
  TopicStatus,
  TopicMemoryItem,
  SavedKind,
  SavedArchiveItem,
  MemoryObject,
  MemoryIndexEntry,
  SourceIndexEntry,
  SelfIndexEntry,
  RelationshipIndexEntry,
  TopicIndexEntry,
  SavedIndexEntry,
  MemoryManifest
} from './types/memory'
