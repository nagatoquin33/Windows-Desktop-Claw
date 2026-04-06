/**
 * MemoryStoreService — B3.2
 *
 * 统一入口 + 类型分发的 Memory CRUD 服务。
 *
 * 职责：
 *   1. 统一的 create / read / update / delete 接口
 *   2. 自动生成 id / createdAt / updatedAt
 *   3. 写入后自动更新 index
 *   4. 按 memory 类型分发到对应的落盘 handler
 *
 * 落盘策略（B2 共识）：
 *   - sources/ topics/ — 一个对象一个 JSON 文件
 *   - self/ relationships/ saved/ — 聚合到 items.json
 */
import { randomUUID } from 'crypto'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs'
import {
  getSourcesDir,
  getSelfDir,
  getRelationshipsDir,
  getTopicsDir,
  getSavedDir
} from '../paths'
import { memoryIndexService } from './memory-index-service'
import type {
  MemoryType,
  MemoryObject,
  MemoryObjectBase,
  SourceRecord,
  SelfMemoryItem,
  RelationshipMemoryItem,
  TopicMemoryItem,
  SavedArchiveItem,
  SourceIndexEntry,
  SelfIndexEntry,
  RelationshipIndexEntry,
  TopicIndexEntry,
  SavedIndexEntry
} from '@desktop-claw/shared'

// ─── JSON 读写辅助 ───────────────────────────

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    console.error(`[memory-store] failed to parse ${filePath}`)
    return fallback
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── 聚合文件读写辅助（self / relationships / saved）──

function readAggregated<T extends MemoryObjectBase>(dir: string): T[] {
  const p = join(dir, 'items.json')
  const data = readJson<{ items: T[] }>(p, { items: [] })
  return data.items
}

function writeAggregated<T extends MemoryObjectBase>(dir: string, items: T[]): void {
  const p = join(dir, 'items.json')
  writeJson(p, { items })
}

// ─── 单文件落盘辅助（sources / topics）──

function readSingleFile<T extends MemoryObjectBase>(dir: string, id: string): T | null {
  const p = join(dir, `${id}.json`)
  return readJson<T | null>(p, null)
}

function writeSingleFile<T extends MemoryObjectBase>(dir: string, item: T): void {
  writeJson(join(dir, `${item.id}.json`), item)
}

function deleteSingleFile(dir: string, id: string): boolean {
  const p = join(dir, `${id}.json`)
  if (!existsSync(p)) return false
  unlinkSync(p)
  return true
}

function listSingleFiles<T extends MemoryObjectBase>(dir: string): T[] {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  const items: T[] = []
  for (const f of files) {
    const item = readJson<T | null>(join(dir, f), null)
    if (item) items.push(item)
  }
  return items
}

// ─── Index entry 构建 ────────────────────────

function toSourceIndex(s: SourceRecord): SourceIndexEntry {
  return {
    id: s.id, type: 'source', label: s.name, summary: s.summary,
    updatedAt: s.updatedAt, fileType: s.fileType, mode: s.mode, status: s.status
  }
}

function toSelfIndex(s: SelfMemoryItem): SelfIndexEntry {
  return {
    id: s.id, type: 'self', label: s.key, summary: s.summary,
    updatedAt: s.updatedAt, category: s.category
  }
}

function toRelationshipIndex(r: RelationshipMemoryItem): RelationshipIndexEntry {
  return {
    id: r.id, type: 'relationship', label: r.name, summary: r.summary,
    updatedAt: r.updatedAt, relation: r.relation
  }
}

function toTopicIndex(t: TopicMemoryItem): TopicIndexEntry {
  return {
    id: t.id, type: 'topic', label: t.name, summary: t.summary,
    updatedAt: t.updatedAt, status: t.status
  }
}

function toSavedIndex(s: SavedArchiveItem): SavedIndexEntry {
  return {
    id: s.id, type: 'saved', label: s.title, summary: s.summary,
    updatedAt: s.updatedAt, savedKind: s.savedKind
  }
}

function toIndexEntry(obj: MemoryObject) {
  switch (obj.type) {
    case 'source':       return toSourceIndex(obj)
    case 'self':         return toSelfIndex(obj)
    case 'relationship': return toRelationshipIndex(obj)
    case 'topic':        return toTopicIndex(obj)
    case 'saved':        return toSavedIndex(obj)
  }
}

// ─── Type → Dir 映射 ────────────────────────

function dirForType(type: MemoryType): string {
  switch (type) {
    case 'source':       return getSourcesDir()
    case 'self':         return getSelfDir()
    case 'relationship': return getRelationshipsDir()
    case 'topic':        return getTopicsDir()
    case 'saved':        return getSavedDir()
  }
}

/** 该类型是否使用聚合文件落盘 */
function isAggregated(type: MemoryType): boolean {
  return type === 'self' || type === 'relationship' || type === 'saved'
}

// ─── 写入串行化 mutex（B4.0 工程约束） ────────

/**
 * Per-file async mutex：同一个文件的写入串行执行，不同文件可并行。
 * 实现原理：用 Map<filePath, Promise> 做链式排队。
 */
const writeLocks = new Map<string, Promise<void>>()

function withWriteLock<T>(lockKey: string, fn: () => T): Promise<T> {
  const prev = writeLocks.get(lockKey) ?? Promise.resolve()
  const next = prev.then(() => fn())
  // 无论成功失败都清理，防止 rejected promise 阻塞后续
  const cleanup = next.then(() => {}, () => {})
  writeLocks.set(lockKey, cleanup)
  return next
}

/** 根据 memory type 获取写锁的 key（聚合类型按 items.json，单文件按 type+id） */
function lockKeyForWrite(type: MemoryType, id?: string): string {
  if (isAggregated(type)) {
    // 聚合类型的所有写操作竞争同一个 items.json
    return join(dirForType(type), 'items.json')
  }
  // 单文件类型按 id 粒度加锁
  return id ? join(dirForType(type), `${id}.json`) : dirForType(type)
}

// ─── Service ────────────────────────────────

class MemoryStoreService {
  // ── Create ──

  /**
   * 创建一个 memory 对象。
   * 自动填充 id / createdAt / updatedAt，写入磁盘并更新 index。
   * 调用方传入除 id / createdAt / updatedAt 外的完整 payload。
   */
  create<T extends MemoryObject>(payload: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T> {
    const type = (payload as unknown as MemoryObjectBase).type
    return withWriteLock(lockKeyForWrite(type), () => {
      const now = new Date().toISOString()
      const obj = {
        ...payload,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
      } as unknown as T

      this._write(obj)
      memoryIndexService.upsertEntry(toIndexEntry(obj))
      return obj
    })
  }

  // ── Read ──

  /** 读取单个 memory 对象 */
  getById(type: MemoryType, id: string): MemoryObject | null {
    const dir = dirForType(type)
    if (isAggregated(type)) {
      const items = readAggregated<MemoryObject>(dir)
      return items.find(i => i.id === id) ?? null
    }
    return readSingleFile<MemoryObject>(dir, id)
  }

  /** 读取指定类型的所有对象 */
  listByType(type: MemoryType): MemoryObject[] {
    const dir = dirForType(type)
    if (isAggregated(type)) {
      return readAggregated<MemoryObject>(dir)
    }
    return listSingleFiles<MemoryObject>(dir)
  }

  // ── Update ──

  /**
   * 部分更新一个 memory 对象。
   * 自动更新 updatedAt，写入磁盘并更新 index。
   */
  update<T extends MemoryObject>(
    type: MemoryType,
    id: string,
    patch: Partial<Omit<T, 'id' | 'type' | 'createdAt'>>
  ): Promise<T | null> {
    return withWriteLock(lockKeyForWrite(type, id), () => {
      const existing = this.getById(type, id)
      if (!existing) return null

      const updated = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString()
      } as T

      this._write(updated)
      memoryIndexService.upsertEntry(toIndexEntry(updated))
      return updated
    })
  }

  // ── Delete ──

  /** 删除一个 memory 对象，同时移除 index entry */
  delete(type: MemoryType, id: string): Promise<boolean> {
    return withWriteLock(lockKeyForWrite(type, id), () => {
      const dir = dirForType(type)
      let deleted = false

      if (isAggregated(type)) {
        const items = readAggregated<MemoryObject>(dir)
        const idx = items.findIndex(i => i.id === id)
        if (idx >= 0) {
          items.splice(idx, 1)
          writeAggregated(dir, items)
          deleted = true
        }
      } else {
        deleted = deleteSingleFile(dir, id)
      }

      if (deleted) {
        memoryIndexService.removeEntry(type, id)
      }
      return deleted
    })
  }

  // ── 批量 ──

  /** 全量重建指定类型的 index（从磁盘文件重新读取） */
  rebuildIndex(type: MemoryType): void {
    const all = this.listByType(type)
    const entries = all.map(obj => toIndexEntry(obj))
    memoryIndexService.rebuild(type, entries)
  }

  /** 全量重建所有类型的 index */
  rebuildAllIndexes(): void {
    const types: MemoryType[] = ['source', 'self', 'relationship', 'topic', 'saved']
    for (const type of types) {
      this.rebuildIndex(type)
    }
    memoryIndexService.markRebuilt()
  }

  // ── 内部写入分发 ──

  private _write(obj: MemoryObject): void {
    const dir = dirForType(obj.type)
    if (isAggregated(obj.type)) {
      const items = readAggregated<MemoryObject>(dir)
      const idx = items.findIndex(i => i.id === obj.id)
      if (idx >= 0) {
        items[idx] = obj
      } else {
        items.push(obj)
      }
      writeAggregated(dir, items)
    } else {
      writeSingleFile(dir, obj)
    }
  }
}

export const memoryStoreService = new MemoryStoreService()
