/**
 * delete_file 脚本 — 删除指定路径的文件
 *
 * 输入（JSON via process.argv[2]）：
 *   { "path": "/absolute/path/to/file" }
 *
 * 输出（JSON via stdout）：
 *   { "success": true, "content": "已删除文件: ..." }
 *   { "success": false, "error": "错误信息" }
 */
import { unlinkSync, existsSync } from 'fs'
import { validatePath, getDefaultAllowedRoots } from '../path-security'

function output(result: { success: boolean; content?: string; error?: string }) {
  process.stdout.write(JSON.stringify(result))
}

function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const filePath = input.path as string

  if (!filePath) {
    output({ success: false, error: '缺少 path 参数' })
    return
  }

  const check = validatePath(filePath, getDefaultAllowedRoots())
  if (!check.valid) {
    output({ success: false, error: check.error })
    return
  }

  const resolved = check.resolved

  if (!existsSync(resolved)) {
    output({ success: false, error: `文件不存在: ${resolved}` })
    return
  }

  try {
    unlinkSync(resolved)
    output({ success: true, content: `已删除文件: ${resolved}` })
  } catch (err) {
    output({
      success: false,
      error: `删除失败: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

main()
