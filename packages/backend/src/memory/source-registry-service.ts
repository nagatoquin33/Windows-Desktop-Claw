/**
 * SourceRegistryService — B3.1
 *
 * Source / File Record 的专用门面，封装 MemoryStoreService 的 source 相关操作。
 *
 * 职责：
 *   1. 注册新 source（文件或 URL）
 *   2. 通过路径 / id 查询 source
 *   3. 被动变更检测（基于 fast_fingerprint）
 *   4. 更新 source 状态
 *
 * MVP 约定：
 *   - 不做主动文件系统 watch
 *   - 仅在 source 被再次访问或显式刷新时做被动变化检测
 *   - extracted text 持久化暂缓，只保留扩展位
 */
import { statSync } from 'fs'
import { memoryStoreService } from './memory-store-service'
import type {
  SourceRecord,
  SourceMode,
  FastFingerprint
} from '@desktop-claw/shared'

// ─── 辅助 ─────────────────────────────────

/** 从磁盘文件生成快速指纹 */
function buildFingerprint(filePath: string): FastFingerprint | null {
  try {
    const stat = statSync(filePath)
    return { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}

// ─── Service ────────────────────────────────

class SourceRegistryService {
  /**
   * 注册一个新 source。如果同 path 已存在，返回已有记录（不重复创建）。
   */
  async register(opts: {
    name: string
    path: string
    fileType: string
    mode?: SourceMode
    summary?: string
    keywords?: string[]
    linkedTopicIds?: string[]
  }): Promise<SourceRecord> {
    // 查重：同 path 已注册则直接返回
    const existing = this.getByPath(opts.path)
    if (existing) return existing

    const fp = buildFingerprint(opts.path)

    return memoryStoreService.create<SourceRecord>({
      type: 'source',
      name: opts.name,
      path: opts.path,
      fileType: opts.fileType,
      mode: opts.mode ?? 'reference-only',
      status: 'active',
      fastFingerprint: fp ?? undefined,
      linkedTopicIds: opts.linkedTopicIds ?? [],
      summary: opts.summary ?? '',
      keywords: opts.keywords ?? [],
      sourceRefs: []
    })
  }

  /** 通过 id 获取 source */
  getById(id: string): SourceRecord | null {
    return memoryStoreService.getById('source', id) as SourceRecord | null
  }

  /** 通过文件路径查找 source（精确匹配） */
  getByPath(filePath: string): SourceRecord | null {
    const all = memoryStoreService.listByType('source') as SourceRecord[]
    return all.find(s => s.path === filePath) ?? null
  }

  /** 获取所有 source */
  listAll(): SourceRecord[] {
    return memoryStoreService.listByType('source') as SourceRecord[]
  }

  /** 按状态过滤 */
  listByStatus(status: SourceRecord['status']): SourceRecord[] {
    return this.listAll().filter(s => s.status === status)
  }

  /**
   * 被动变更检测：比较当前磁盘指纹与已记录的 fast_fingerprint。
   * 返回 'unchanged' | 'changed' | 'missing'（文件不存在）。
   * 如果检测到变化，自动更新指纹并将状态标记为 stale。
   */
  async checkFreshness(id: string): Promise<'unchanged' | 'changed' | 'missing'> {
    const source = this.getById(id)
    if (!source) return 'missing'

    const currentFp = buildFingerprint(source.path)
    if (!currentFp) {
      // 文件已不存在
      await memoryStoreService.update<SourceRecord>('source', id, { status: 'deleted' })
      return 'missing'
    }

    const prevFp = source.fastFingerprint
    if (
      prevFp &&
      prevFp.mtimeMs === currentFp.mtimeMs &&
      prevFp.size === currentFp.size
    ) {
      return 'unchanged'
    }

    // 文件有变化 → 更新指纹, 标 stale
    await memoryStoreService.update<SourceRecord>('source', id, {
      fastFingerprint: currentFp,
      status: 'stale'
    })
    return 'changed'
  }

  /** 更新 source 的部分字段 */
  update(id: string, patch: Partial<Pick<
    SourceRecord,
    'name' | 'summary' | 'keywords' | 'mode' | 'status' | 'linkedTopicIds' | 'contentHash'
  >>): Promise<SourceRecord | null> {
    return memoryStoreService.update<SourceRecord>('source', id, patch)
  }

  /** 删除一个 source */
  delete(id: string): Promise<boolean> {
    return memoryStoreService.delete('source', id)
  }
}

export const sourceRegistryService = new SourceRegistryService()
