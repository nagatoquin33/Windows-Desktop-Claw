/**
 * query_index 脚本 — 搜索记忆索引
 *
 * 按关键词在 memory indexes 中搜索，返回匹配的索引条目。
 * 这是记忆查询的推荐入口：先查索引，再按需用 get_memory 获取详情。
 *
 * 输入（JSON via process.argv[2]）：
 *   { "query": "关键词", "types": ["self", "topic"] }
 *
 * 输出（JSON via stdout）：
 *   { "success": true, "content": "..." }
 *   { "success": false, "error": "错误信息" }
 */
import {
  readManifest,
  readIndexEntries,
  type IndexEntry
} from '../memory-utils'

function output(result: { success: boolean; content?: string; error?: string }) {
  process.stdout.write(JSON.stringify(result))
}

function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const query = (input.query as string || '').trim()
  const types = input.types as string[] | undefined
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50)

  if (!query) {
    output({ success: false, error: '缺少 query 参数' })
    return
  }

  const manifest = readManifest()
  if (manifest.indexes.length === 0) {
    output({ success: true, content: '记忆索引为空，尚无结构化记忆。' })
    return
  }

  const queryLower = query.toLowerCase()
  const targetTypes = types && types.length > 0
    ? manifest.indexes.filter((idx) => types.includes(idx.type))
    : manifest.indexes

  const matches: Array<{ type: string; entry: IndexEntry }> = []

  for (const idx of targetTypes) {
    if (idx.count === 0) continue
    const entries = readIndexEntries(idx.type)
    for (const entry of entries) {
      if (matches.length >= limit) break
      // 在 label + summary 中做关键词匹配
      const text = `${entry.label} ${entry.summary}`.toLowerCase()
      if (text.includes(queryLower)) {
        matches.push({ type: idx.type, entry })
      }
    }
    if (matches.length >= limit) break
  }

  if (matches.length === 0) {
    output({ success: true, content: `未在索引中找到与「${query}」相关的记忆。` })
    return
  }

  const sections: string[] = []
  // 按类型分组显示
  const grouped = new Map<string, IndexEntry[]>()
  for (const m of matches) {
    const list = grouped.get(m.type) ?? []
    list.push(m.entry)
    grouped.set(m.type, list)
  }

  for (const [type, entries] of grouped) {
    const lines = entries.map((e) => `- [${e.id}] ${e.label}: ${e.summary}`)
    sections.push(`## ${type} (${entries.length} 条匹配)\n${lines.join('\n')}`)
  }

  output({
    success: true,
    content: `找到 ${matches.length} 条相关记忆：\n\n${sections.join('\n\n')}\n\n提示：使用 get_memory 脚本传入 type 和 id 可获取完整记忆详情。`
  })
}

main()
