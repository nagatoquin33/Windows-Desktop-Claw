/**
 * MemoryIndexService — B3.3
 *
 * 维护 memory index 文件，提供"先看地图"的检索入口。
 * - manifest.json — 总入口（各 index 路径、条目数、更新时间）
 * - 5 个分类索引 — source / self / relationship / topic / saved
 *
 * 职责：
 *   1. 增量 upsert / remove index entry
 *   2. 按类型、关键词、时间范围过滤
 *   3. 全量 rebuild（对账用）
 *   4. 读取 manifest 供 prompt 注入
 */
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { getIndexesDir } from '../paths'
import type {
  MemoryType,
  MemoryManifest,
  MemoryIndexEntry,
  SourceIndexEntry,
  SelfIndexEntry,
  RelationshipIndexEntry,
  TopicIndexEntry,
  SavedIndexEntry
} from '@desktop-claw/shared'

// ─── 文件名映射 ─────────────────────────────

const INDEX_FILE: Record<MemoryType, string> = {
  source: 'source-index.json',
  self: 'self-index.json',
  relationship: 'relationship-index.json',
  topic: 'topic-index.json',
  saved: 'saved-index.json'
}

type AnyIndexEntry =
  | SourceIndexEntry
  | SelfIndexEntry
  | RelationshipIndexEntry
  | TopicIndexEntry
  | SavedIndexEntry

// ─── JSON 读写辅助 ───────────────────────────

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    console.error(`[memory-index] failed to parse ${filePath}`)
    return fallback
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Service ────────────────────────────────

class MemoryIndexService {
  // ── Manifest ──

  /** 读取 manifest 总入口 */
  getManifest(): MemoryManifest {
    const p = join(getIndexesDir(), 'manifest.json')
    return readJson<MemoryManifest>(p, {
      lastRebuiltAt: new Date().toISOString(),
      indexes: []
    })
  }

  /** 写入 manifest */
  private _writeManifest(manifest: MemoryManifest): void {
    writeJson(join(getIndexesDir(), 'manifest.json'), manifest)
  }

  // ── 分类索引读写 ──

  /** 读取指定类型的 index 条目列表 */
  getEntries<T extends AnyIndexEntry = AnyIndexEntry>(type: MemoryType): T[] {
    const p = join(getIndexesDir(), INDEX_FILE[type])
    const data = readJson<{ entries: T[] }>(p, { entries: [] })
    return data.entries
  }

  /** 写入指定类型的完整 index 文件 */
  private _writeEntries(type: MemoryType, entries: AnyIndexEntry[]): void {
    const p = join(getIndexesDir(), INDEX_FILE[type])
    writeJson(p, { entries })
    this._touchManifest(type, entries.length)
  }

  /** 更新 manifest 中某个 index 的 count 和 updatedAt */
  private _touchManifest(type: MemoryType, count: number): void {
    const manifest = this.getManifest()
    const now = new Date().toISOString()
    const idx = manifest.indexes.findIndex(i => i.type === type)
    if (idx >= 0) {
      manifest.indexes[idx].count = count
      manifest.indexes[idx].updatedAt = now
    } else {
      manifest.indexes.push({
        type,
        path: INDEX_FILE[type],
        count,
        updatedAt: now
      })
    }
    this._writeManifest(manifest)
  }

  // ── Upsert / Remove ──

  /** 增量更新或插入一条 index entry */
  upsertEntry(entry: AnyIndexEntry): void {
    const entries = this.getEntries(entry.type)
    const idx = entries.findIndex(e => e.id === entry.id)
    if (idx >= 0) {
      entries[idx] = entry
    } else {
      entries.push(entry)
    }
    this._writeEntries(entry.type, entries)
  }

  /** 删除一条 index entry */
  removeEntry(type: MemoryType, id: string): boolean {
    const entries = this.getEntries(type)
    const idx = entries.findIndex(e => e.id === id)
    if (idx < 0) return false
    entries.splice(idx, 1)
    this._writeEntries(type, entries)
    return true
  }

  // ── 查询 ──

  /** 按类型列出所有 index 条目 */
  listByType(type: MemoryType): AnyIndexEntry[] {
    return this.getEntries(type)
  }

  /** 按关键词在 label 和 summary 中搜索（大小写不敏感） */
  search(keyword: string, types?: MemoryType[]): AnyIndexEntry[] {
    const targetTypes = types ?? (['source', 'self', 'relationship', 'topic', 'saved'] as MemoryType[])
    const kw = keyword.toLowerCase()
    const results: AnyIndexEntry[] = []
    for (const type of targetTypes) {
      const entries = this.getEntries(type)
      for (const entry of entries) {
        if (entry.label.toLowerCase().includes(kw) || entry.summary.toLowerCase().includes(kw)) {
          results.push(entry)
        }
      }
    }
    return results
  }

  /** 按时间范围过滤（inclusive） */
  filterByTimeRange(type: MemoryType, after?: string, before?: string): AnyIndexEntry[] {
    const entries = this.getEntries(type)
    return entries.filter(e => {
      if (after && e.updatedAt < after) return false
      if (before && e.updatedAt > before) return false
      return true
    })
  }

  // ── 全量重建 ──

  /** 用给定的完整条目列表替换指定类型的 index（对账用） */
  rebuild(type: MemoryType, entries: AnyIndexEntry[]): void {
    this._writeEntries(type, entries)
  }

  /** 更新 manifest 的 lastRebuiltAt 时间戳 */
  markRebuilt(): void {
    const manifest = this.getManifest()
    manifest.lastRebuiltAt = new Date().toISOString()
    this._writeManifest(manifest)
  }
}

export const memoryIndexService = new MemoryIndexService()
