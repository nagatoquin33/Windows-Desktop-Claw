/**
 * get_memory 脚本 — 读取完整记忆对象
 *
 * 给定 type 和 id，读取对应的完整记忆对象 JSON。
 * 通常在 query_index 返回索引条目后，按需获取详情时使用。
 *
 * 输入（JSON via process.argv[2]）：
 *   { "type": "topic", "id": "abc-123" }
 *
 * 输出（JSON via stdout）：
 *   { "success": true, "content": "..." }
 *   { "success": false, "error": "错误信息" }
 */
import { readMemoryObject } from '../memory-utils'

function output(result: { success: boolean; content?: string; error?: string }) {
  process.stdout.write(JSON.stringify(result))
}

const VALID_TYPES = ['source', 'self', 'relationship', 'topic', 'saved']

function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const type = (input.type as string || '').trim()
  const id = (input.id as string || '').trim()

  if (!type || !VALID_TYPES.includes(type)) {
    output({ success: false, error: `无效的 type: ${type}，有效值: ${VALID_TYPES.join(', ')}` })
    return
  }
  if (!id) {
    output({ success: false, error: '缺少 id 参数' })
    return
  }

  const obj = readMemoryObject(type, id)

  if (!obj) {
    output({ success: true, content: `未找到 ${type} 类型、id=${id} 的记忆对象。` })
    return
  }

  output({
    success: true,
    content: JSON.stringify(obj, null, 2)
  })
}

main()
