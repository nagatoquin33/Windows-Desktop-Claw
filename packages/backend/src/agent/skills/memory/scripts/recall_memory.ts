/**
 * recall_memory 脚本 — 按日期范围检索历史记忆
 *
 * 输入（JSON via process.argv[2]）：
 *   { "startDate": "2026-03-20", "endDate": "2026-03-25" }
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
  const startDate = input.startDate as string
  const endDate = input.endDate as string

  if (!startDate || !endDate) {
    output({ success: false, error: '缺少 startDate 或 endDate 参数（格式：YYYY-MM-DD）' })
    return
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    output({ success: false, error: '日期格式错误，请使用 YYYY-MM-DD' })
    return
  }

  const dates = listArchiveDates().filter((d) => d >= startDate && d <= endDate)

  if (dates.length === 0) {
    output({ success: true, content: `${startDate} 至 ${endDate} 期间没有找到记忆归档。` })
    return
  }

  const sections: string[] = []
  for (const date of dates) {
    const archive = readArchive(date)
    if (!archive || (!archive.summary && !archive.diary && !archive.facts)) continue

    const parts: string[] = [`## ${date}`]
    if (archive.diary) parts.push(`**日记**：${archive.diary}`)
    if (archive.summary) parts.push(`**摘要**：${archive.summary}`)
    if (archive.facts && archive.facts.length > 0) {
      parts.push(`**事实**：\n${archive.facts.map((f) => `- ${f}`).join('\n')}`)
    }
    sections.push(parts.join('\n'))
  }

  if (sections.length === 0) {
    output({ success: true, content: `${startDate} 至 ${endDate} 期间有归档但尚未生成摘要。` })
    return
  }

  output({ success: true, content: sections.join('\n\n') })
}

main()
