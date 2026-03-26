/**
 * memory skill 共享工具 — 路径解析与归档读取
 *
 * 脚本在子进程中运行，无法访问主进程的 memoryService 单例，
 * 因此需要自行解析 data/memory/ 路径并读取 JSON 归档。
 */
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

// ─── 类型（与 memory-service.ts 保持一致） ──

export interface DayArchive {
  date: string
  sealed: boolean
  messages: unknown[]
  diary: string | null
  summary: string | null
  facts: string[] | null
}

// ─── 路径解析 ────────────────────────────────

/**
 * 从当前文件位置向上逐级查找 data/memory/ 目录
 * 兼容 src 和 dist 两种运行方式
 */
export function resolveMemoryDir(): string {
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'data', 'memory')
    if (existsSync(candidate)) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  // 最终兜底
  return join(process.cwd(), 'data', 'memory')
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
