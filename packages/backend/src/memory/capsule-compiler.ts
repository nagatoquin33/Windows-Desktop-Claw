/**
 * Capsule Compiler — B5.1
 *
 * 从结构化 memory 编译生成 USER.md 和 CONTEXT.md（prompt capsule）。
 *
 * 设计原则：
 *   - 确定性模板拼装，不调用 LLM
 *   - USER.md = 记忆地图 + 核心用户画像 + memory 技能引导
 *   - CONTEXT.md = 近期活跃主题 + 重要人物提示
 *   - 渐进迁移：结构化记忆为空时 fallback 到旧逻辑（不覆盖已有内容）
 */
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getPersonaDir } from '../paths'
import { memoryIndexService } from './memory-index-service'
import type {
  SelfIndexEntry,
  TopicIndexEntry,
  RelationshipIndexEntry
} from '@desktop-claw/shared'

// ─── 配置 ────────────────────────────────────

/** USER.md 中核心画像最多展示几条 Self Memory */
const SELF_TOP_N = 6

/** CONTEXT.md 中活跃主题最多展示几条 */
const TOPIC_TOP_N = 5

/** CONTEXT.md 中人物关系最多展示几条 */
const RELATIONSHIP_TOP_N = 3

// ─── 编译逻辑 ────────────────────────────────

/**
 * 检查结构化记忆是否足够接管 USER.md 的编译。
 * 用于 internalize() 判断是否跳过 LLM 调用。
 */
export function canCompileUserMd(): boolean {
  const selfEntries = memoryIndexService.getEntries<SelfIndexEntry>('self')
  return selfEntries.length > 0
}

/**
 * 检查结构化记忆是否足够接管 CONTEXT.md 的编译。
 * 用于 internalize() 判断是否跳过 LLM 调用。
 */
export function canCompileContextMd(): boolean {
  const topicEntries = memoryIndexService.getEntries<TopicIndexEntry>('topic')
  const relationshipEntries = memoryIndexService.getEntries<RelationshipIndexEntry>('relationship')
  return topicEntries.length > 0 || relationshipEntries.length > 0
}

/**
 * 编译 USER.md — 记忆地图 + 核心用户画像
 *
 * 结构：
 *   # 用户画像
 *   ## 记忆系统概况
 *   ## 核心画像
 *   ## 引导
 */
function compileUserMd(): string | null {
  const manifest = memoryIndexService.getManifest()
  const selfEntries = memoryIndexService.getEntries<SelfIndexEntry>('self')

  // 与 canCompileUserMd() 保持一致：必须有真实 Self Memory 才编译
  if (selfEntries.length === 0) {
    return null
  }

  const parts: string[] = []

  parts.push('# 用户画像')
  parts.push('')
  parts.push('> 此文件由记忆系统自动编译，基于结构化 Self Memory 生成。')
  parts.push('')

  // ── 记忆系统概况 ──
  parts.push('## 记忆系统概况')
  parts.push('')
  if (manifest.indexes.length > 0) {
    for (const idx of manifest.indexes) {
      const label = INDEX_TYPE_LABEL[idx.type] ?? idx.type
      parts.push(`- ${label}：${idx.count} 条`)
    }
  } else {
    parts.push('- 暂无结构化记忆')
  }
  parts.push('')

  // ── 核心画像（按 category 分组） ──
  if (selfEntries.length > 0) {
    parts.push('## 核心画像')
    parts.push('')

    // 按 confidence 降序排列，取 Top N
    const sorted = [...selfEntries].sort((a, b) => {
      // selfEntries 没有 confidence 字段（index entry 只有公共字段 + category）
      // 按 updatedAt 降序作为次选排序
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    const top = sorted.slice(0, SELF_TOP_N)

    // 按 category 分组输出
    const grouped = groupBy(top, (e) => e.category)
    for (const [cat, entries] of Object.entries(grouped)) {
      const catLabel = SELF_CATEGORY_LABEL[cat] ?? cat
      parts.push(`**${catLabel}**`)
      for (const entry of entries) {
        parts.push(`- ${entry.label}：${entry.summary}`)
      }
      parts.push('')
    }
  }

  // ── 引导语 ──
  parts.push('---')
  parts.push('')
  parts.push('如需回忆更详细的用户信息、关系、主题或存档，请激活 memory 技能进行查询。')

  return parts.join('\n')
}

/**
 * 编译 CONTEXT.md — 近期活跃上下文
 *
 * 结构：
 *   # 动态认知
 *   ## 近期活跃主题
 *   ## 重要人物
 */
function compileContextMd(): string | null {
  const topicEntries = memoryIndexService.getEntries<TopicIndexEntry>('topic')
  const relationshipEntries = memoryIndexService.getEntries<RelationshipIndexEntry>('relationship')

  // 如果没有任何 topic 和 relationship，返回 null（fallback 到旧逻辑）
  if (topicEntries.length === 0 && relationshipEntries.length === 0) {
    return null
  }

  const parts: string[] = []

  parts.push('# 动态认知')
  parts.push('')
  parts.push('> 此文件由记忆系统自动编译，基于 Topic Memory 和 Relationship Memory 生成。')
  parts.push('')

  // ── 近期活跃主题 ──
  const activeTopics = topicEntries
    .filter((t) => t.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, TOPIC_TOP_N)

  if (activeTopics.length > 0) {
    parts.push('## 近期活跃主题')
    parts.push('')
    for (const topic of activeTopics) {
      parts.push(`- **${topic.label}**：${topic.summary}`)
    }
    parts.push('')
  }

  // ── 暂停中的主题（如果有，简要提及） ──
  const pausedTopics = topicEntries.filter((t) => t.status === 'paused')
  if (pausedTopics.length > 0) {
    parts.push(`> 另有 ${pausedTopics.length} 个暂停中的主题，如需查看请使用 memory 技能。`)
    parts.push('')
  }

  // ── 重要人物 ──
  if (relationshipEntries.length > 0) {
    const topRelationships = [...relationshipEntries]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, RELATIONSHIP_TOP_N)

    parts.push('## 重要人物')
    parts.push('')
    for (const rel of topRelationships) {
      parts.push(`- **${rel.label}**（${rel.relation}）：${rel.summary}`)
    }
    parts.push('')
  }

  return parts.join('\n')
}

// ─── 公共 API ────────────────────────────────

export interface CompileResult {
  userMdCompiled: boolean
  contextMdCompiled: boolean
}

/**
 * 编译 prompt capsule（USER.md + CONTEXT.md）。
 *
 * 渐进迁移策略：
 *   - 如果结构化记忆不为空 → 用编译结果覆盖文件
 *   - 如果结构化记忆为空 → 不动文件，保留旧内化逻辑写入的内容
 */
export async function compileCapsules(): Promise<CompileResult> {
  const personaDir = getPersonaDir()
  const result: CompileResult = {
    userMdCompiled: false,
    contextMdCompiled: false
  }

  // ── USER.md ──
  const userContent = compileUserMd()
  if (userContent !== null) {
    const userPath = join(personaDir, 'USER.md')
    writeFileSync(userPath, userContent.trim() + '\n', 'utf-8')
    result.userMdCompiled = true
    console.log(`[capsule] compiled USER.md (${userContent.length} chars)`)
  } else {
    console.log('[capsule] skip USER.md — no structured memory, fallback to legacy')
  }

  // ── CONTEXT.md ──
  const contextContent = compileContextMd()
  if (contextContent !== null) {
    const contextPath = join(personaDir, 'CONTEXT.md')
    writeFileSync(contextPath, contextContent.trim() + '\n', 'utf-8')
    result.contextMdCompiled = true
    console.log(`[capsule] compiled CONTEXT.md (${contextContent.length} chars)`)
  } else {
    console.log('[capsule] skip CONTEXT.md — no structured memory, fallback to legacy')
  }

  return result
}

// ─── 辅助 ────────────────────────────────────

const INDEX_TYPE_LABEL: Record<string, string> = {
  source: 'Source / 文件记录',
  self: 'Self / 用户画像',
  relationship: 'Relationship / 人物关系',
  topic: 'Topic / 主题记忆',
  saved: 'Saved / 用户存档'
}

const SELF_CATEGORY_LABEL: Record<string, string> = {
  identity: '身份',
  preference: '偏好',
  communication_style: '沟通风格',
  working_style: '工作方式'
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {}
  for (const item of arr) {
    const key = keyFn(item)
    if (!map[key]) map[key] = []
    map[key].push(item)
  }
  return map
}
