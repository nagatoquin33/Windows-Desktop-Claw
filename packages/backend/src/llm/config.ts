import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface LLMConfig {
  apiKey: string
  baseURL: string
  model: string
  /** 模型上下文窗口大小（token 数），用于裁剪预算计算。默认 64000 */
  contextWindow: number
}

/**
 * 从 config.json 读取 LLM 配置
 * dev: 项目根 data/config.json; prod: app userData（但后端单独运行时回退到 cwd）
 */
export function loadLLMConfig(): LLMConfig | null {
  // 尝试多个可能路径（优先项目内 data/）
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'data', 'config.json'),   // from out/main or src
    join(__dirname, '..', '..', 'data', 'config.json'),               // from packages/backend/src
    join(process.cwd(), 'data', 'config.json')                        // fallback
  ]

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
        if (raw?.llm?.apiKey) {
          return {
            apiKey: raw.llm.apiKey,
            baseURL: raw.llm.baseURL || 'https://api.openai.com/v1',
            model: raw.llm.model || 'gpt-4o',
            contextWindow: raw.llm.contextWindow || 115000
          }
        }
      } catch {
        console.error(`[llm] failed to parse config at ${configPath}`)
      }
    }
  }

  return null
}
