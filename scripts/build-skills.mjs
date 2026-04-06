/**
 * 跨平台 skill 资源复制脚本
 * 替代 build:skills 中的 mkdir -p / cp 等 Unix-only 命令
 *
 * tsc 编译 .ts → .js 到 resources/skills/ 后，
 * 本脚本将 SKILL.md、references/ 等非 TS 资源复制到同一目录。
 */
import { cpSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const src = join(root, 'packages', 'backend', 'src', 'agent', 'skills')
const dest = join(root, 'apps', 'desktop', 'resources', 'skills')

// 清理旧文件，避免已删除/重命名的 skill 残留
rmSync(dest, { recursive: true, force: true })

// file skill
mkdirSync(join(dest, 'file', 'references'), { recursive: true })
cpSync(join(src, 'file', 'SKILL.md'), join(dest, 'file', 'SKILL.md'))
cpSync(join(src, 'file', 'references', 'format-details.md'), join(dest, 'file', 'references', 'format-details.md'))

// memory skill
mkdirSync(join(dest, 'memory'), { recursive: true })
cpSync(join(src, 'memory', 'SKILL.md'), join(dest, 'memory', 'SKILL.md'))

// memory-interpret skill (后台记忆提取 prompt)
mkdirSync(join(dest, 'memory-interpret'), { recursive: true })
cpSync(join(src, 'memory-interpret', 'SKILL.md'), join(dest, 'memory-interpret', 'SKILL.md'))

// memory-maintain skill (记忆维护文档)
mkdirSync(join(dest, 'memory-maintain'), { recursive: true })
cpSync(join(src, 'memory-maintain', 'SKILL.md'), join(dest, 'memory-maintain', 'SKILL.md'))
