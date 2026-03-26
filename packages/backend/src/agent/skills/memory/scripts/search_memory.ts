/**
 * search_memory 脚本 — 按关键词搜索历史记忆
 *
 * 输入（JSON via process.argv[2]）：
 *   { "query": "关键词", "limit": 5 }
 *
 * 输出（JSON via stdout）：
 *   { "success": true, "content": "..." }
 *   { "success": false, "error": "错误信息" }
 */
import { readArchive, listArchiveDates } from '../memory-utils'

function output(result: { success: boolean; content?: string; error?: string }) {
  process.stdout.write(JSON.stringify(result))
}

function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const query = (input.query as string || '').trim()
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20)

  if (!query) {
    output({ success: false, error: '缺少 query 参数' })
    return
  }

  const queryLower = query.toLowerCase()
  const dates = listArchiveDates().reverse() // 最新的在前

  const matches: Array<{ date: string; snippets: string[] }> = []

  for (const date of dates) {
    if (matches.length >= limit) break

    const archive = readArchive(date)
    if (!archive) continue

    const snippets: string[] = []

    if (archive.summary && archive.summary.toLowerCase().includes(queryLower)) {
      snippets.push(`摘要：${archive.summary}`)
    }

    if (archive.diary && archive.diary.toLowerCase().includes(queryLower)) {
      snippets.push(`日记：${archive.diary}`)
    }

    if (archive.facts) {
      const matched = archive.facts.filter((f) => f.toLowerCase().includes(queryLower))
      if (matched.length > 0) {
        snippets.push(`事实：${matched.join('；')}`)
      }
    }

    if (snippets.length > 0) {
      matches.push({ date, snippets })
    }
  }

  if (matches.length === 0) {
    output({ success: true, content: `未找到与「${query}」相关的记忆。` })
    return
  }

  const sections = matches.map((m) => `## ${m.date}\n${m.snippets.join('\n')}`)
  output({
    success: true,
    content: `找到 ${matches.length} 天的相关记忆：\n\n${sections.join('\n\n')}`
  })
}

main()
