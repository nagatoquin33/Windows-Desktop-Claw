/**
 * recall_raw 脚本 — 原始归档检索
 *
 * 当结构化记忆（索引 + 记忆对象）不足以回答问题时，回退到原始日归档搜索。
 * 支持按日期范围和/或关键词搜索。
 *
 * 输入（JSON via process.argv[2]）：
 *   { "query": "关键词", "startDate": "2026-03-20", "endDate": "2026-03-25", "limit": 5 }
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
  const startDate = (input.startDate as string || '').trim()
  const endDate = (input.endDate as string || '').trim()
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 30)

  if (!query && !startDate && !endDate) {
    output({ success: false, error: '至少需要 query 或 startDate/endDate 之一' })
    return
  }

  // 日期格式校验
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (startDate && !dateRe.test(startDate)) {
    output({ success: false, error: `startDate 格式错误: ${startDate}，请使用 YYYY-MM-DD` })
    return
  }
  if (endDate && !dateRe.test(endDate)) {
    output({ success: false, error: `endDate 格式错误: ${endDate}，请使用 YYYY-MM-DD` })
    return
  }

  let dates = listArchiveDates()

  // 按日期范围过滤
  if (startDate) dates = dates.filter((d) => d >= startDate)
  if (endDate) dates = dates.filter((d) => d <= endDate)

  // 无关键词时按日期范围查，有关键词时按最新优先搜索
  if (query) {
    dates = dates.reverse() // 最新在前
  }

  const queryLower = query.toLowerCase()
  const sections: string[] = []
  let count = 0

  for (const date of dates) {
    if (count >= limit) break

    const archive = readArchive(date)
    if (!archive) continue

    // 如果有关键词，做内容匹配过滤
    if (query) {
      const snippets: string[] = []

      if (archive.summary && archive.summary.toLowerCase().includes(queryLower)) {
        snippets.push(`**摘要**：${archive.summary}`)
      }
      if (archive.diary && archive.diary.toLowerCase().includes(queryLower)) {
        snippets.push(`**日记**：${archive.diary}`)
      }
      if (archive.facts) {
        const matched = archive.facts.filter((f) => f.toLowerCase().includes(queryLower))
        if (matched.length > 0) {
          snippets.push(`**事实**：${matched.join('；')}`)
        }
      }

      if (snippets.length > 0) {
        sections.push(`## ${date}\n${snippets.join('\n')}`)
        count++
      }
    } else {
      // 无关键词：返回该日期的全部摘要信息
      if (!archive.summary && !archive.diary && !archive.facts) continue

      const parts: string[] = [`## ${date}`]
      if (archive.diary) parts.push(`**日记**：${archive.diary}`)
      if (archive.summary) parts.push(`**摘要**：${archive.summary}`)
      if (archive.facts && archive.facts.length > 0) {
        parts.push(`**事实**：\n${archive.facts.map((f) => `- ${f}`).join('\n')}`)
      }
      sections.push(parts.join('\n'))
      count++
    }
  }

  if (sections.length === 0) {
    const desc = query ? `与「${query}」相关的` : ''
    const range = startDate || endDate
      ? ` (${startDate || '...'}~${endDate || '...'})`
      : ''
    output({ success: true, content: `未找到${desc}原始记忆归档${range}。` })
    return
  }

  output({
    success: true,
    content: sections.join('\n\n')
  })
}

main()
