---
name: memory
description: >
  检索历史记忆。当用户问「上次我们聊了什么」「之前提过的 XX」「你还记得吗」
  或需要回忆过去的对话内容时使用此技能。
---

# 记忆检索技能（MemorySkill）

## 概述

此技能让你能够检索和搜索与用户的历史对话记忆。记忆按天存储在 `data/memory/YYYY-MM-DD.json` 中，每天的归档包含 summary（摘要）、diary（第一人称日记）和 facts（关键事实）。

所有操作通过 `run_skill_script` 工具执行 `scripts/` 目录下的脚本。

## 可用脚本

通过 `run_skill_script` 调用，`skill_name` 始终为 `memory`：

### recall_memory.ts

按日期范围查询记忆，返回对应天数的 summary + diary + facts。

```
参数（JSON）：{ "startDate": "2026-03-20", "endDate": "2026-03-25" }
返回：{ "success": true, "content": "..." }
```

- startDate 和 endDate 均为 YYYY-MM-DD 格式
- 返回该范围内所有有归档记录的天数

### search_memory.ts

按关键词搜索历史记忆，遍历所有归档的 summary/diary/facts 做文本匹配。

```
参数（JSON）：{ "query": "搜索词", "limit": 5 }
返回：{ "success": true, "content": "..." }
```

- query：搜索关键词
- limit（可选）：最多返回几天的结果，默认 5

## 使用指南

### 何时使用 recall_memory.ts

- 用户问到特定时间段的对话（"上周我们聊了什么"）
- 需要回顾某几天的完整记忆
- 你在 CONTEXT.md 中看到了某天的线索，想了解更多细节

### 何时使用 search_memory.ts

- 用户提到某个话题但不确定是哪天聊的（"之前说过的那个项目叫什么"）
- 需要跨多天搜索特定内容
- 模糊匹配场景

### 记忆层次说明

你的记忆来源有三层：
1. **CONTEXT.md**（已在 System Prompt 中注入）：内化后的跨天精华，日常闲聊够用
2. **recall_memory / search_memory**（本技能）：查档案，按需调用
3. **read_file 读原始 JSON**（file 技能）：极端情况下读完整归档获取精确细节

大多数情况下 CONTEXT.md + 本技能即可满足需求。
