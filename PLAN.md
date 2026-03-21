# Desktop-Claw 内部开发计划

> **用途说明**：本文档为内部开发工作文档，不对外公开。记录详细任务拆解、开发节奏、脚手架步骤、技术决策日志。对外公开动态请更新 DEVLOG.md。

- 文档状态：持续更新
- 技术参考：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 产品参考：[PRD.md](./PRD.md)
- 当前阶段：Milestone B（记忆 + 人格 + 稳定性）
- 最后更新：2026-03-21

---

## 一、开发节奏约定

1. **一次只做一个 Milestone 的任务**，不超前开发。
2. **每个模块写完后，先跑通最小验证**，再继续下一个。
3. **遇到技术选择分叉点，记录在"决策日志"章节**，不反复纠结。
4. **每个 Milestone 完成后更新 DEVLOG.md**，保持对外同步。
5. **与 AI 协作时，始终携带 ARCHITECTURE.md 的对应章节作为上下文**。

---

## 二、里程碑总览

| 里程碑 | 代号 | 核心目标 | 参考架构章节 |
|--------|------|----------|------------|
| M0 | 脚手架 | 项目结构初始化、开发环境搭建 | §13 |
| Milestone A | 能跑 | 悬浮球显示 + 基础聊天通路 + 文件读写 | §3, §4, §5 |
| Milestone B | 能留 | 记忆归档 + 人格体系 + 断线重连 + 可观测性 | §4.4, §Companion, §11.2 |
| Milestone C | 能扩 | 扩展位预留 + 测试基线 | §11.3 |

---

## 三、M0：脚手架搭建（当前阶段）

### 目标
初始化整个项目结构，让"空壳子能跑起来"。完成后应能：
- `npm run dev` 启动 Electron 窗口（显示 Hello World）
- 主进程可以打印日志，渲染进程可以显示 React 组件
- 基本 IPC 通信通路验证通过（renderer → main → 打印）

### 任务清单

#### 0.1 初始化 Monorepo
- [x] 创建项目根目录 `desktop-claw/`
- [x] 初始化根 `package.json`（name: `desktop-claw`, private: true）
- [x] 配置 pnpm workspaces（`pnpm-workspace.yaml`）
- [x] 创建 `.gitignore`（node_modules, dist, data/, .env，PLAN.md，Hello-Claw学习笔记.md）
- [x] 初始化 git 仓库，连接远程 `git@github.com:DjTaNg-404/Desktop-Claw.git`，提交首个 commit（"chore: init monorepo"）并推送

#### 0.2 创建目录骨架
按照 ARCHITECTURE.md §13 的结构，一次性创建好目录（空目录可用 `.gitkeep` 占位）：
```
apps/desktop/src/main/
apps/desktop/src/renderer/components/FloatingBall/
apps/desktop/src/renderer/components/ChatPanel/
apps/desktop/src/renderer/pages/
apps/desktop/src/preload/
packages/backend/src/gateway/
packages/backend/src/task-coordinator/
packages/backend/src/agent/skills/
packages/backend/src/llm/
packages/backend/src/memory/
packages/shared/types/
packages/shared/utils/
data/memory/
data/db/
data/files/
```
- [x] 目录创建完毕，提交 commit（"chore: add directory skeleton"）并推送（data/ 由 .gitignore 屏蔽，本地存在但不入库）

#### 0.3 Electron 主进程 & 渲染进程
- [x] `apps/desktop/package.json` 配置依赖（electron 34, electron-vite 2.3, react 18, typescript 5.9）
- [x] 配置 `electron.vite.config.ts`（main + preload externalize，renderer React 插件）
- [x] 配置 `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json`
- [x] 写最简 `main/index.ts`：创建 BrowserWindow，dev 加载 Vite URL，prod 加载 HTML 文件
- [x] 写最简 `renderer/App.tsx`：显示 "Hello, Claw 🐾"，暗色背景样式
- [x] 配置 `preload/index.ts`（contextBridge 暴露 `electronAPI` 占位）
- [x] 跑通 `pnpm dev`，Electron 窗口正常显示（验证：主进程 + GPU 进程 + 渲染进程均启动）
- [x] 提交 commit（"feat(desktop): electron main + renderer hello world"）并推送

#### 0.4 TypeScript + 构建工具配置
- [x] 根目录 `tsconfig.base.json`（strict, esModuleInterop, declaration, sourceMap）
- [x] `apps/desktop/tsconfig.node.json` 和 `tsconfig.web.json` 继承 base（去除重复的 strict/skipLibCheck）
- [x] `packages/backend/tsconfig.json`（extends base，target: ES2022，CommonJS，node18）
- [x] `packages/shared/tsconfig.json`（extends base，target: ES2022，ESNext，lib 模式）
- [x] `packages/backend/package.json` 和 `packages/shared/package.json` 初始化
- [x] 验证 `tsc --noEmit` 在三个包（desktop / backend / shared）内均无报错

#### 0.5 基础 IPC 通路验证
- [x] `preload/index.ts`：通过 contextBridge 暴露 `electronAPI.ping()`（`ipcRenderer.invoke`）
- [x] `main/index.ts`：`ipcMain.handle('ipc:ping')` 打印日志并回传 `'pong from main 🐾'`
- [x] `renderer/App.tsx`：添加"Ping Main Process"按钮，点击后显示 main 的回传消息
- [x] typecheck 0 报错，`pnpm dev` 验证窗口启动正常、IPC 通路实现
- [x] 提交 commit（"test(ipc): verify basic main<->renderer channel"）并推送

#### 0.6 后端 Service 空壳（进程内嵌）
- [x] `packages/backend/src/index.ts` 导出 `startBackend()` 函数
- [x] `startBackend()` 启动 Fastify 5 监听 `127.0.0.1:3721`（端口可配置）
- [x] 添加 `GET /health` 路由，返回 `{ status: 'ok', timestamp }`
- [x] `apps/desktop/package.json` 添加 `@desktop-claw/backend: workspace:*` 依赖
- [x] `tsconfig.node.json` 添加 project references 指向 backend 包
- [x] `main/index.ts` 调用 `startBackend()`，嵌入 Electron 主进程
- [x] 验证：`pnpm dev` 启动后 `curl http://127.0.0.1:3721/health` 返回 `{"status":"ok",...}`
- [x] 提交 commit（"feat(backend): embed fastify server, /health endpoint"）并推送

### M0 完成标志
- [x] `pnpm dev` 后：Electron 窗口显示，IPC 通，`/health` 可访问（返回 `{"status":"ok"}`）
- [x] 目录结构与 ARCHITECTURE.md §13 完全吻合
- [x] DEVLOG.md 更新 M0 完成记录

---

## 四、Milestone A：能跑（聊天通路 + 文件读写）

> 此阶段开始前先更新本节任务细节。以下为初版规划，待 M0 完成后细化。

### 目标
用户能通过悬浮球打开 Chat Panel，输入消息，AI 给出流式回复，并能 read/write/edit 本地文件。

### 模块开发顺序（推荐）
1. **悬浮球交互完善**（单击轻互动 + 双击 toggle + 右键菜单）
2. **气泡组件**（ChatBubble，3 槽渐变，单击/双击回复共用）
3. **条形输入框**（QuickInput，双击弹出，自适应方向）
4. **完整聊天面板**（ChatPanel，右键打开，消息列表 + Markdown 渲染 + 流式 token）
5. **WebSocket 通路**（renderer ↔ backend，先硬编码 echo 消息）
6. **LLM 接入**（`packages/backend/src/llm/`，OpenAI 流式调用，跑通 streaming）
7. **最小 Agent Loop**（`agent/loop.ts`，单轮 LLM 调用，无工具）
8. **Task Coordinator**（`task-coordinator/`，taskId 分配 + 串行队列）
9. **Gateway 完整版**（WebSocket 消息路由 + 事件分发）
10. **Tool: read**（读文件/记录）
11. **Tool: write**（写记录/待办）
12. **Tool: edit**（修改已有记录）
13. **Companion System Prompt**（§Companion 人格技术层）

### 任务清单

#### A.1 悬浮球交互体系（三层交互）
- [x] `FloatingBall` 组件：圆形悬浮按钮，can-drag（拖拽移动）
- [x] Electron 窗口配置：`frameless + transparent + alwaysOnTop`
- [x] 单击交互：点击后 Claw 冒出一句随机短话（气泡形式，自动消失）
- [x] 双击交互：双击 toggle 条形输入框的显示/隐藏（替代原来的单击 toggle `isOpen`）
- [x] 右键菜单：右键弹出上下文菜单（打开面板 / 设置 / 退出）

#### A.1.1 ChatBubble 气泡组件
- [x] `ChatBubble` 组件：球上方的消息气泡
- [x] 固定 3 槽机制：新气泡从底部插入，旧气泡向上推移
- [x] 渐变透明效果：最远（最旧）的气泡 opacity 最低（0.4），最近的最实（1.0）
- [x] 超出 3 个时，最远气泡自动裁剪
- [x] Ball Window 扩大渲染区域（220→340）以容纳 3 个气泡
- [x] 双模式布局：收起态窄气泡居中在球上方，展开态宽气泡横跨全宽与 QuickInput 对齐
- [x] 流式气泡：AI 回复开始即创建气泡，文字实时追加，完成后才启动消失倒计时
- [x] 动态停留时间：5s 底 + 50ms/字，上限 15s

#### A.1.2 QuickInput 条形输入框
- [x] `QuickInput` 组件：水平延伸的条形输入框
- [x] 自适应方向：球在屏幕右侧时向左展开，在左侧时向右展开
- [x] 发送后 AI 回复显示为球上方的 ChatBubble（MVP：占位回复）
- [x] 双击球控制显示/隐藏

#### A.1.3 ChatPanel 完整面板
- [x] `ChatPanel` 组件：输入框 + 消息列表（纯 UI，无逻辑）
- [x] 消息气泡：用户消息（右对齐）、AI 消息（左对齐）
- [x] 流式 token 显示：AI 消息边接收边渲染（cursor 动画，待 WebSocket 接入）
- [x] 右键菜单 → “打开面板” 触发，独立窗口
- [x] 面板与 QuickInput 共享同一份对话历史（待 A.2 WebSocket 接入）

#### A.1.4 ContextMenu 右键菜单
- [x] 右键悬浮球弹出菜单：打开面板 / 设置 / 退出
- [x] “退出”调用 `app.quit()`
- [x] “设置”预留入口（MVP 阶段为空面板）

#### A.2 WebSocket 通路
- [x] backend 启动 WS 服务（`ws` 库，port 3722 或复用 3721）
- [x] 定义消息协议（参见 ARCHITECTURE.md §8）
- [x] renderer 通过 preload 连接 WS
- [x] 先实现 echo 模式（backend 原样返回用户输入）验证通路

#### A.3 LLM 流式接入
- [x] `packages/backend/src/llm/client.ts`：封装 OpenAI 兼容 API 调用
- [x] 支持 `stream: true`，逐 token 推送至 WS
- [x] `config.json` 读取 `apiKey`, `baseURL`, `model`
- [x] 异常处理：超时 30s 自动终止，格式错误打印日志

#### A.4 最小 Agent Loop
- [x] `agent/loop.ts`：接收 prompt + history，调用 LLM，返回结果
- [x] 单轮（无工具调用），后续逐步加工具
- [x] 上下文裁剪：超过 10 轮时丢弃最早消息

#### A.5 Task Coordinator
- [x] `task-coordinator/index.ts`：FIFO 队列，taskId 生成（uuid），状态机（pending/running/done/failed）
- [x] 串行执行：前一个 task done 才执行下一个
- [x] 取消接口：`cancelTask(taskId)` → 当前任务标记 cancelled

#### A.6 Skill 层（read/write/edit）

> 每项原子能力 = **一个自包含的 Skill 文件夹**（SKILL.md 行为指南 + tool .ts 可执行代码）

- [x] 工具类型定义：`packages/shared/types/tool.ts`（ToolSchema / ToolResult / ToolDefinition / ToolCall）
- [x] `skills/file/read_file.ts`：读本地文件（限用户主动授权目录，防路径穿越）+ .pdf/.docx/.xlsx 文本提取
- [x] `skills/file/write_file.ts`：写 .md / .txt 文件，递归创建父目录
- [x] `skills/file/edit_file.ts`：字符串精确替换修改文件
- [x] 安全边界：`path-security.ts` — allowedRoots 校验 + 敏感路径拦截 + 符号链接逃逸检测
- [x] `skill-primitives.ts`：`loadSkillsFromDir()` + `formatSkillsForPrompt()` + `extractFrontmatter()` + `collectToolSchemas()`
- [x] `skill-manager.ts`：`SkillManager` 类，扫描 skills/ 目录，每个子文件夹为一个 Skill，合并 SKILL.md + 收集 tools[]
- [x] `skills/file/SKILL.md`：FileSkill — 告诉模型 read/write/edit 的使用时机与边界
- [x] Agent Loop 集成：完整 ReAct 循环 — SkillManager 加载 → system prompt + tools → tool_calls → executeTool → tool_result → 继续迭代
- [x] `llm/client.ts`：升级支持 Function Calling（tools 请求参数 + SSE tool_calls 流式累积 + onToolCalls 回调）
- [x] `ChatMessageData` 扩展：支持 `role: 'tool'`、`tool_calls`、`tool_call_id` 字段

### Milestone A 完成标志
- [x] 能发消息 → AI 流式回复（DeepSeek deepseek-chat 验证通过）
- [x] 能读本地文件并在对话中引用（read_file 端到端验证通过）
- [x] 能写/修改本地文件（write_file + edit_file 端到端验证通过）
- [x] 悬浮球能拖拽、展开/折叠
- [x] DEVLOG.md 更新 Milestone A 完成记录

---

## 五、Milestone B：能留（记忆 + 人格 + 稳定性）

### 目标
让用户感知到"这是同一个 Claw"——重启不失忆、人格稳定、交互按天归档可回顾；网络/任务异常能优雅恢复，不丢失状态。

### 模块开发顺序（推荐）

| 编号 | 标题 | 一句话定位 |
|------|------|-----------|
| B.1 | Companion 人格体系 — SOUL.md + System Prompt 组装 | 让 Claw 每次对话都"是同一个 Claw"，而不是裸模型 |
| B.2 | Memory Service — 按天归档基础设施 | `data/memory/YYYY-MM-DD.json` 读写，当日交互落盘 |
| B.3 | 当日记忆注入 + 对话摘要压缩 | 重启不失忆 + 20 轮阈值自动摘要，解决上下文膨胀 |
| B.4 | BOOTSTRAP 首次引导 + USER.md 用户画像 | 初次见面仪式 → 收集称呼/背景/偏好 → 写入 USER.md |
| B.5 | 断线重连 + 流式异常兜底 | WS 指数退避重连，streaming 中断时气泡降级，不挂死 |
| B.6 | Context 精细管理 — token-aware 裁剪 | 按 token 预算裁剪历史，老 tool_result 摘要化，保护 tool_calls 序列完整 |
| B.7 | 可观测性 — token 用量 + 任务耗时 | 记录每次 LLM 调用的 token_in/out，任务耗时日志，费用可感知 |
| B.8 | 日历视图 — 按天回顾历史对话 | 面板新增 CalendarView，点击某天可查看当日对话摘要与记录 |

### 任务清单

> 各任务细节待逐项讨论后填写。

#### B.1 Companion 人格体系
- [ ] 待讨论

#### B.2 Memory Service — 按天归档
- [ ] 待讨论

#### B.3 当日记忆注入 + 摘要压缩
- [ ] 待讨论

#### B.4 BOOTSTRAP 首次引导 + USER.md
- [ ] 待讨论

#### B.5 断线重连 + 流式异常兜底
- [ ] 待讨论

#### B.6 Context 精细管理
- [ ] 待讨论

#### B.7 可观测性
- [ ] 待讨论

#### B.8 日历视图
- [ ] 待讨论

### Milestone B 完成标志
- [ ] Claw 有稳定人格（SOUL.md 注入），重启后风格一致
- [ ] 当日对话按天落盘，重启后能续上今天的上下文
- [ ] 超过 20 轮自动摘要压缩，不爆上下文
- [ ] 首次使用有引导仪式，USER.md 记录用户偏好
- [ ] WS 断线自动重连，流式中断不挂死
- [ ] 面板可按日历查看历史对话
- [ ] DEVLOG.md 更新 Milestone B 完成记录

---

## 六、Milestone C：能扩（扩展位预留 + 测试）

> 细节待 Milestone B 完成后填写。

### 目标
预留多泳道扩展位（不开启），预留 exec 接入设计（不实现），建立最小测试用例集。

---

## 七、技术决策日志

> 记录每次有争议或分叉的技术决策，方便未来复盘。

| 日期 | 决策点 | 选择 | 理由 | 备选方案 |
|------|--------|------|------|---------|
| 2026-03-18 | 桌面框架 | Electron | TypeScript 全栈，AI 辅助编码友好，生态成熟 | Tauri（学习成本高，需 Rust，MVP 不适合）|
| 2026-03-18 | 后端语言 | TypeScript + Node.js | 单语言 monorepo，Vibe Coding 效率高 | FastAPI（Python）打包复杂，运行时体积大 |
| 2026-03-18 | 架构模式 | Gateway + 最小 Command Queue + Agent Loop | 来自 OpenClaw/Hello-Claw 实践，已验证可行 | 纯同步请求-响应（忽略并发/超时问题）|
| 2026-03-18 | 记忆策略 | Day-bucket（按天归档 JSON） | 实现简单，符合"日历式陪伴"产品形态 | 向量数据库检索（过度设计，MVP 不需要）|
| 2026-03-18 | 会话模型 | 单主对话（无多会话 UI） | 桌宠不需要多会话，内部 taskId 保留并发控制位 | 多 Tab 会话（增加 UI 复杂度，违反简洁原则）|

---

## 八、待解决技术问题（Open Questions）

> 遇到暂时没有答案的技术问题，先记在这里，不阻塞主流程。

| # | 问题 | 优先级 | 预计决策时机 |
|---|------|--------|------------|
| TQ1 | Electron IPC 与嵌入式 Fastify 之间是否需要走实际 HTTP 端口，还是用 in-process function call？ | 高 | M0 验证阶段确定 |
| TQ2 | `preload/contextBridge` 如何安全地暴露 WS 连接，避免渲染进程直接访问 Node.js API？ | 高 | Milestone A.2 阶段 |
| TQ3 | 悬浮球拖拽时窗口大小与坐标如何持久化（重启后恢复位置）？ | 中 | Milestone A.1 阶段 |
| TQ4 | 流式 token 在 React 状态更新时是否有性能瓶颈（频繁 setState）？ | 中 | Milestone A.3 阶段验证 |
| TQ5 | `data/` 目录在开发环境和生产环境路径不同（dev 用项目内，prod 用 ~/Library/...），如何统一切换？ | 中 | M0 阶段建立约定 |

---

## 九、常用命令速查

> 待 M0 环境搭好后填写实际命令。

```bash
# 启动开发模式
pnpm run dev

# 仅启动 backend（调试用）
pnpm --filter @desktop-claw/backend run dev

# 类型检查（全包）
pnpm run typecheck

# 打包
pnpm run build

# 查看 data 目录
ls ~/Library/Application\ Support/desktop-claw/
```
