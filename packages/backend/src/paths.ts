/**
 * 统一数据目录路径管理
 *
 * 两种模式：
 * - 开发模式（pnpm dev）: 项目根目录下的 data/
 * - 生产模式（打包安装后）:
 *     macOS:   ~/Library/Application Support/Desktop-Claw/
 *     Windows: %LOCALAPPDATA%/Desktop-Claw/
 *     Linux:   ~/.config/Desktop-Claw/
 *   （由 Electron app.getPath('userData') 自动处理平台差异）
 *
 * 由 main 进程在启动 backend 时通过 initDataDir() 注入路径；
 * 若未注入（backend 单独运行），则 fallback 到开发模式路径探测。
 */
import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'fs'

// ─── 单例路径 ────────────────────────────────

let _dataDir: string | null = null

/**
 * 初始化数据目录路径（由 main 进程调用一次）
 * 生产环境同时会创建必要的子目录结构并复制初始模板
 */
export function initDataDir(dir: string): void {
  _dataDir = dir
  ensureDataStructure(dir)
}

/**
 * 获取数据根目录
 * - 已初始化 → 返回注入的路径
 * - 未初始化 → 开发模式 fallback 探测
 */
export function getDataDir(): string {
  if (_dataDir) return _dataDir

  // fallback: 开发模式路径探测（兼容 backend 单独运行）
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'data'),   // from out/main or src
    join(__dirname, '..', '..', 'data'),                // from packages/backend/src
    join(process.cwd(), 'data')                         // fallback
  ]

  for (const dir of candidates) {
    if (existsSync(dir)) {
      _dataDir = dir
      return dir
    }
  }

  _dataDir = candidates[0]
  return _dataDir
}

/** 获取 persona/ 子目录 */
export function getPersonaDir(): string {
  return join(getDataDir(), 'persona')
}

/** 获取 memory/ 子目录 */
export function getMemoryDir(): string {
  return join(getDataDir(), 'memory')
}

// ─── Memory System 子目录 ────────────────────

/** data/memory/sources/ — 一个 source 一个 JSON */
export function getSourcesDir(): string {
  return join(getMemoryDir(), 'sources')
}

/** data/memory/self/ — 聚合 items.json */
export function getSelfDir(): string {
  return join(getMemoryDir(), 'self')
}

/** data/memory/relationships/ — 聚合 items.json */
export function getRelationshipsDir(): string {
  return join(getMemoryDir(), 'relationships')
}

/** data/memory/topics/ — 一个 topic 一个 JSON */
export function getTopicsDir(): string {
  return join(getMemoryDir(), 'topics')
}

/** data/memory/saved/ — 聚合 items.json */
export function getSavedDir(): string {
  return join(getMemoryDir(), 'saved')
}

/** data/memory/indexes/ — manifest + 分类索引 */
export function getIndexesDir(): string {
  return join(getMemoryDir(), 'indexes')
}

/** 获取 config.json 路径 */
export function getConfigPath(): string {
  return join(getDataDir(), 'config.json')
}

// ─── 目录结构初始化 ──────────────────────────

/** 确保数据目录子结构存在 */
function ensureDataStructure(dir: string): void {
  const subdirs = ['persona', 'memory', 'db', 'files']
  for (const sub of subdirs) {
    const p = join(dir, sub)
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true })
    }
  }

  // Memory System 子目录
  const memoryDir = join(dir, 'memory')
  const memorySubdirs = ['sources', 'self', 'relationships', 'topics', 'saved', 'indexes']
  for (const sub of memorySubdirs) {
    const p = join(memoryDir, sub)
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true })
    }
  }

  // 初始化空的聚合文件与索引
  ensureMemoryFiles(memoryDir)
}

/**
 * 初始化 Memory System 的聚合文件与索引
 * 仅在文件不存在时创建，不覆盖已有数据
 */
function ensureMemoryFiles(memoryDir: string): void {
  const now = new Date().toISOString()

  // 聚合 items.json — self / relationships / saved
  const aggregatedDirs = ['self', 'relationships', 'saved']
  for (const sub of aggregatedDirs) {
    const itemsPath = join(memoryDir, sub, 'items.json')
    if (!existsSync(itemsPath)) {
      writeFileSync(itemsPath, JSON.stringify({ items: [] }, null, 2), 'utf-8')
    }
  }

  // Indexes — manifest + 5 类分类索引
  const indexesDir = join(memoryDir, 'indexes')

  const manifestPath = join(indexesDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    const manifest = {
      lastRebuiltAt: now,
      indexes: [
        { type: 'source', path: 'source-index.json', count: 0, updatedAt: now },
        { type: 'self', path: 'self-index.json', count: 0, updatedAt: now },
        { type: 'relationship', path: 'relationship-index.json', count: 0, updatedAt: now },
        { type: 'topic', path: 'topic-index.json', count: 0, updatedAt: now },
        { type: 'saved', path: 'saved-index.json', count: 0, updatedAt: now }
      ]
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  }

  const indexFiles = [
    'source-index.json',
    'self-index.json',
    'relationship-index.json',
    'topic-index.json',
    'saved-index.json'
  ]
  for (const file of indexFiles) {
    const p = join(indexesDir, file)
    if (!existsSync(p)) {
      writeFileSync(p, JSON.stringify({ entries: [] }, null, 2), 'utf-8')
    }
  }
}

/**
 * 生产环境首次启动时，将内置模板复制到用户数据目录
 * @param builtinPersonaDir extraResources 中的 persona 模板目录
 */
export function copyInitialTemplates(builtinPersonaDir: string): void {
  const targetDir = getPersonaDir()

  // SOUL.md 始终需要（不覆盖已有）
  const soulTarget = join(targetDir, 'SOUL.md')
  const soulSource = join(builtinPersonaDir, 'SOUL.md')
  if (!existsSync(soulTarget) && existsSync(soulSource)) {
    copyFileSync(soulSource, soulTarget)
  }

  // BOOTSTRAP.md 仅在引导未完成时复制：
  // 如果 USER.md 已有实质内容（>200 字节，非空模板），说明引导已完成，不再复制
  const userMdPath = join(targetDir, 'USER.md')
  const bootstrapTarget = join(targetDir, 'BOOTSTRAP.md')
  const bootstrapSource = join(builtinPersonaDir, 'BOOTSTRAP.md')
  const bootstrapCompleted = existsSync(userMdPath)
    && readFileSync(userMdPath, 'utf-8').length > 200
  if (!bootstrapCompleted && !existsSync(bootstrapTarget) && existsSync(bootstrapSource)) {
    copyFileSync(bootstrapSource, bootstrapTarget)
  }

  // USER.md 和 CONTEXT.md 如果不存在，创建空模板
  ensureEmptyTemplate(join(targetDir, 'USER.md'), '# 用户画像\n\n> Claw 会在对话中逐步了解你，并更新这里的内容。\n')
  ensureEmptyTemplate(join(targetDir, 'CONTEXT.md'), '# 动态认知\n\n> 这里记录 Claw 从日常对话中内化的认知。\n')
}

function ensureEmptyTemplate(filePath: string, defaultContent: string): void {
  if (!existsSync(filePath)) {
    const { mkdirSync, writeFileSync } = require('fs')
    const dir = join(filePath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, defaultContent, 'utf-8')
  }
}
