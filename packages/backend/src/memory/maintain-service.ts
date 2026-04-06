/**
 * MaintainService — B4.3
 *
 * 记忆系统健康维护服务（↔ Karpathy lint）。
 * 每日 seal day 完成后自动执行，做三项确定性维护：
 *
 *   1. rebuildIndexes — 全量重建所有 index（对账）
 *   2. markStaleTopics — 按 lastActiveAt 标记过时 topic，降低长期未引用记忆的 confidence
 *   3. checkSources — 检测文件是否还存在，标记失效 source
 *
 * MVP 阶段只做确定性维护。LLM 部分（topic 合并、self 冲突检测）后续增加。
 */
import { existsSync, statSync } from 'fs'
import { memoryStoreService } from './memory-store-service'
import type {
  TopicMemoryItem,
  SelfMemoryItem,
  RelationshipMemoryItem,
  SourceRecord
} from '@desktop-claw/shared'

// ─── 配置阈值 ────────────────────────────────

/** Topic: 超过多少天没活跃就标为 paused */
const TOPIC_PAUSE_DAYS = 14
/** Topic: 超过多少天没活跃就标为 archived */
const TOPIC_ARCHIVE_DAYS = 60
/** Self/Relationship: 超过多少天没更新就降低 confidence */
const CONFIDENCE_DECAY_DAYS = 30
/** confidence 每次衰减量 */
const CONFIDENCE_DECAY_AMOUNT = 0.05
/** confidence 最低值（不再继续衰减） */
const CONFIDENCE_FLOOR = 0.3

// ─── 公开接口 ────────────────────────────────

export interface MaintainResult {
  indexesRebuilt: boolean
  topicsMarked: { paused: number; archived: number }
  confidenceDecayed: number
  sourcesChecked: { total: number; stale: number; deleted: number }
}

/**
 * 执行一次完整的维护流程。
 * 由 memory-service.ts 的 seal day 完成后调用。
 */
export async function runMaintenance(): Promise<MaintainResult> {
  console.log('[maintain] starting maintenance...')

  const result: MaintainResult = {
    indexesRebuilt: false,
    topicsMarked: { paused: 0, archived: 0 },
    confidenceDecayed: 0,
    sourcesChecked: { total: 0, stale: 0, deleted: 0 }
  }

  // 1. 全量重建索引
  try {
    rebuildIndexes()
    result.indexesRebuilt = true
  } catch (err) {
    console.error('[maintain] rebuildIndexes failed:', err)
  }

  // 2. 标记过时 topic + 衰减 confidence
  try {
    const staleResult = await markStale()
    result.topicsMarked = staleResult.topicsMarked
    result.confidenceDecayed = staleResult.confidenceDecayed
  } catch (err) {
    console.error('[maintain] markStale failed:', err)
  }

  // 3. 检测 source 文件是否存在
  try {
    result.sourcesChecked = await checkSources()
  } catch (err) {
    console.error('[maintain] checkSources failed:', err)
  }

  console.log(
    `[maintain] done: indexes=${result.indexesRebuilt}, ` +
    `topics(paused=${result.topicsMarked.paused}, archived=${result.topicsMarked.archived}), ` +
    `confidenceDecayed=${result.confidenceDecayed}, ` +
    `sources(total=${result.sourcesChecked.total}, stale=${result.sourcesChecked.stale}, deleted=${result.sourcesChecked.deleted})`
  )

  return result
}

// ─── 1. 全量重建索引 ────────────────────────

function rebuildIndexes(): void {
  memoryStoreService.rebuildAllIndexes()
  console.log('[maintain] indexes rebuilt')
}

// ─── 2. 标记过时 + 衰减 confidence ──────────

interface StaleResult {
  topicsMarked: { paused: number; archived: number }
  confidenceDecayed: number
}

async function markStale(): Promise<StaleResult> {
  const result: StaleResult = {
    topicsMarked: { paused: 0, archived: 0 },
    confidenceDecayed: 0
  }

  const now = Date.now()

  // 2a. Topic: 按 lastActiveAt 标记 paused / archived
  const topics = memoryStoreService.listByType('topic') as TopicMemoryItem[]
  for (const topic of topics) {
    if (topic.status === 'archived') continue // 已归档的不再处理

    const lastActive = new Date(topic.lastActiveAt).getTime()
    const daysSinceActive = (now - lastActive) / (1000 * 60 * 60 * 24)

    if (daysSinceActive >= TOPIC_ARCHIVE_DAYS) {
      await memoryStoreService.update<TopicMemoryItem>('topic', topic.id, { status: 'archived' })
      result.topicsMarked.archived++
      console.log(`[maintain] topic archived: ${topic.name} (${Math.floor(daysSinceActive)}d inactive)`)
    } else if (daysSinceActive >= TOPIC_PAUSE_DAYS && topic.status === 'active') {
      await memoryStoreService.update<TopicMemoryItem>('topic', topic.id, { status: 'paused' })
      result.topicsMarked.paused++
      console.log(`[maintain] topic paused: ${topic.name} (${Math.floor(daysSinceActive)}d inactive)`)
    }
  }

  // 2b. Self + Relationship: 长期未更新的记忆降低 confidence
  const selfItems = memoryStoreService.listByType('self') as SelfMemoryItem[]
  const relItems = memoryStoreService.listByType('relationship') as RelationshipMemoryItem[]

  for (const item of [...selfItems, ...relItems]) {
    const lastUpdated = new Date(item.updatedAt).getTime()
    const daysSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60 * 24)

    if (daysSinceUpdate >= CONFIDENCE_DECAY_DAYS && item.confidence > CONFIDENCE_FLOOR) {
      const newConfidence = Math.max(CONFIDENCE_FLOOR, item.confidence - CONFIDENCE_DECAY_AMOUNT)
      if (newConfidence < item.confidence) {
        if (item.type === 'self') {
          await memoryStoreService.update<SelfMemoryItem>('self', item.id, { confidence: newConfidence })
        } else {
          await memoryStoreService.update<RelationshipMemoryItem>('relationship', item.id, { confidence: newConfidence })
        }
        result.confidenceDecayed++
      }
    }
  }

  return result
}

// ─── 3. 检测 source 文件失效 ────────────────

async function checkSources(): Promise<{ total: number; stale: number; deleted: number }> {
  const sources = memoryStoreService.listByType('source') as SourceRecord[]
  const result = { total: sources.length, stale: 0, deleted: 0 }

  for (const source of sources) {
    // 跳过已标记为 deleted 的
    if (source.status === 'deleted') continue

    // URL 类型暂不检测
    if (source.path.startsWith('http://') || source.path.startsWith('https://')) continue

    if (!existsSync(source.path)) {
      // 文件不存在 → 标记 deleted
      await memoryStoreService.update<SourceRecord>('source', source.id, { status: 'deleted' })
      result.deleted++
      console.log(`[maintain] source deleted (file missing): ${source.name}`)
      continue
    }

    // 检测指纹变化
    if (source.fastFingerprint) {
      try {
        const stat = statSync(source.path)
        const fp = source.fastFingerprint
        if (fp.mtimeMs !== stat.mtimeMs || fp.size !== stat.size) {
          await memoryStoreService.update<SourceRecord>('source', source.id, {
            status: 'stale',
            fastFingerprint: { path: source.path, mtimeMs: stat.mtimeMs, size: stat.size }
          })
          result.stale++
          console.log(`[maintain] source stale (file changed): ${source.name}`)
        }
      } catch {
        // stat 失败视为文件不可访问
        await memoryStoreService.update<SourceRecord>('source', source.id, { status: 'deleted' })
        result.deleted++
      }
    }
  }

  return result
}
