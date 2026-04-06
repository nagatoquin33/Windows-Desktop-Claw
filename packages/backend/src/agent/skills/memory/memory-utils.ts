/**
 * memory skill 共享工具 — 路径解析与归档/索引读取
 *
 * 脚本在子进程中运行，无法访问主进程的 memoryService 单例，
 * 因此需要自行解析 data/memory/ 路径并读取 JSON 归档。
 */
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

// ─── 类型（与 memory-service.ts / memory-index-service.ts 保持一致） ──

export interface DayArchive {
  date: string
  sealed: boolean
  messages: unknown[]
  diary: string | null
  summary: string | null
  facts: string[] | null
}

export interface ManifestIndex {
  type: string
  path: string
  count: number
  updatedAt: string
}

export interface Manifest {
  lastRebuiltAt: string
  indexes: ManifestIndex[]
}

export interface IndexEntry {
  id: string
  type: string
  label: string
  summary: string
  updatedAt: string
  [key: string]: unknown
}

// ─── 路径解析 ────────────────────────────────

/**
 * 解析 data/memory/ 目录
 * 优先通过统一 paths.ts 获取；脚本独立运行时 fallback 到目录探测
 */
export function resolveMemoryDir(): string {
  // 优先从环境变量获取（子进程由 skill-manager 注入 DATA_DIR）
  if (process.env.DATA_DIR) {
    return join(process.env.DATA_DIR, 'memory')
  }
  try {
    const { getMemoryDir } = require('../../../paths')
    return getMemoryDir()
  } catch {
    // fallback: 脚本独立运行（子进程 CLI），向上逐级查找
    let dir = __dirname
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, 'data', 'memory')
      if (existsSync(candidate)) return candidate
      const parent = resolve(dir, '..')
      if (parent === dir) break
      dir = parent
    }
    return join(process.cwd(), 'data', 'memory')
  }
}

/** 解析 data/memory/indexes/ 目录 */
export function resolveIndexesDir(): string {
  return join(resolveMemoryDir(), 'indexes')
}

// ─── 通用 JSON 读取 ─────────────────────────

/** 安全读取 JSON 文件，不存在或解析失败返回 fallback */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

// ─── 索引读取 ────────────────────────────────

/** 索引文件名映射（type → 文件名） */
const INDEX_FILES: Record<string, string> = {
  source: 'source-index.json',
  self: 'self-index.json',
  relationship: 'relationship-index.json',
  topic: 'topic-index.json',
  saved: 'saved-index.json'
}

/** 记忆子目录映射（type → 子目录名） */
const MEMORY_SUBDIRS: Record<string, string> = {
  source: 'sources',
  self: 'self',
  relationship: 'relationships',
  topic: 'topics',
  saved: 'saved'
}

/** 使用聚合文件（items.json）的类型 */
const AGGREGATED_TYPES = new Set(['self', 'relationship', 'saved'])

/** 读取 manifest.json */
export function readManifest(): Manifest {
  return readJsonFile(join(resolveIndexesDir(), 'manifest.json'), {
    lastRebuiltAt: '',
    indexes: []
  })
}

/** 读取某个类型的完整索引（磁盘格式 { entries: [] }） */
export function readIndexEntries(type: string): IndexEntry[] {
  const filename = INDEX_FILES[type]
  if (!filename) return []
  const data = readJsonFile<{ entries: IndexEntry[] }>(join(resolveIndexesDir(), filename), { entries: [] })
  return data.entries
}

/** 获取索引文件路径 */
export function getIndexFilePath(type: string): string {
  return join(resolveIndexesDir(), INDEX_FILES[type] ?? `${type}-index.json`)
}

// ─── 记忆对象读取 ────────────────────────────

/** 获取某类型的记忆子目录路径 */
export function getMemorySubdir(type: string): string {
  return join(resolveMemoryDir(), MEMORY_SUBDIRS[type] ?? type)
}

/** 判断是否为聚合存储类型 */
export function isAggregatedType(type: string): boolean {
  return AGGREGATED_TYPES.has(type)
}

/** 读取单个记忆对象（自动处理聚合 vs 单文件） */
export function readMemoryObject(type: string, id: string): unknown | null {
  const subdir = getMemorySubdir(type)

  if (isAggregatedType(type)) {
    // 聚合类型：从 items.json 中查找（磁盘格式 { items: [] }）
    const data = readJsonFile<{ items: Array<{ id: string }> }>(join(subdir, 'items.json'), { items: [] })
    return data.items.find((item) => item.id === id) ?? null
  }

  // 单文件类型：直接读取 <id>.json
  return readJsonFile(join(subdir, `${id}.json`), null)
}

// ─── 归档读取 ────────────────────────────────

/** 读取指定日期的归档 JSON，不存在或解析失败返回 null */
export function readArchive(date: string): DayArchive | null {
  const p = join(resolveMemoryDir(), `${date}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** 列出 data/memory/ 下所有归档日期（升序） */
export function listArchiveDates(): string[] {
  const dir = resolveMemoryDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace('.json', ''))
    .sort()
}
