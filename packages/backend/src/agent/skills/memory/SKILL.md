---
name: memory
description: >
  查询、保存、纠正和遗忘记忆。当用户问「你还记得吗」「之前提过的 XX」或说「记住这个」
  「帮我记一下」「你记错了」「忘掉这个」时使用此技能。
  支持索引查询、详情获取、原始归档搜索、主动保存、纠正和删除。
---

# 记忆技能（Memory Skill）

## 概述

此技能让你能够**查询**已有的结构化记忆，应用户要求**保存**新记忆，以及**纠正**或**遗忘**错误记忆。

记忆体系分为两层：
1. **结构化记忆**（索引 + 记忆对象）：经过提取的 Self / Relationship / Topic / Saved 四种类型
2. **原始归档**（日归档 JSON）：按天存储的原始对话 summary / diary / facts

## 记忆类型说明

| 类型 | 含义 | 匹配键 |
|------|------|--------|
| `self` | 用户自身属性（姓名、偏好、习惯等） | `category` + `key` |
| `relationship` | 人际关系（家人、同事、朋友） | `name` |
| `topic` | 话题/项目（正在进行的事） | `name` |
| `saved` | 通用存档（用户明确要求记住的内容） | 总是新建 |

## 可用工具

### 1. save_memory（直接调用）

用户明确要求保存信息时使用。直接作为工具调用，无需通过 `run_skill_script`。

```json
{
  "type": "saved",
  "summary": "用户喜欢在早上 9 点开始工作",
  "title": "工作时间偏好",
  "saved_kind": "text_note",
  "saved_reason": "用户要求记住",
  "source_refs": [{ "kind": "conversation", "date": "2026-04-01" }]
}
```

**saved_kind 选项**：`conversation_ref`（对话引用）、`source_ref`（文件引用）、`text_note`（文本笔记）、`arrangement`（日程安排）

也可保存其他类型（self / relationship / topic），系统自动判断新建或合并更新。

**纠正记忆**：用户说「你记错了，我不是 XX，是 YY」时，直接用 save_memory 覆盖对应条目。例如纠正职业：
```json
{
  "type": "self",
  "category": "identity",
  "key": "career_status",
  "summary": "用户是游戏客户端开发工程师"
}
```
系统会自动匹配 category+key 找到旧记录并更新。

### 2. forget_memory（直接调用）

用户明确要求遗忘/删除某条记忆时使用。需要先用 query_index 查到要删除的 type 和 id。

```json
{
  "type": "self",
  "id": "abc-123",
  "reason": "用户说这条不准确"
}
```

- `type`（必填）：记忆类型
- `id`（必填）：记忆 ID（从 query_index 结果获取）
- `reason`（可选）：删除原因

**注意**：删除不可撤销。删除后 USER.md / CONTEXT.md 会自动重新编译。

### 3. query_index.ts（通过 run_skill_script）

**推荐的首选查询方式**。在结构化记忆索引中搜索关键词。

```json
参数：{ "query": "搜索关键词", "types": ["self", "topic"], "limit": 20 }
```

- `query`（必填）：搜索关键词
- `types`（可选）：限定搜索的记忆类型
- `limit`（可选）：最多返回条目数，默认 20

返回匹配的索引条目（含 id、label、summary），可据此用 get_memory 获取详情。

### 4. get_memory.ts（通过 run_skill_script）

读取单个记忆对象的完整内容。

```json
参数：{ "type": "topic", "id": "abc-123" }
```

- `type`（必填）：记忆类型（source / self / relationship / topic / saved）
- `id`（必填）：记忆对象 ID（从 query_index 结果中获取）

### 5. recall_raw.ts（通过 run_skill_script）

搜索原始日归档（结构化记忆不够时的回退手段）。

```json
参数：{ "query": "关键词", "startDate": "2026-03-20", "endDate": "2026-03-25", "limit": 10 }
```

- `query`（可选）：关键词搜索
- `startDate` / `endDate`（可选）：日期范围（YYYY-MM-DD）
- `limit`（可选）：最多返回天数，默认 10
- 至少需要 query 或 startDate/endDate 之一

## 查询策略（推荐流程）

```
1. 先查索引 → query_index.ts（快速定位）
2. 按需取详情 → get_memory.ts（获取完整对象）
3. 索引无结果 → recall_raw.ts（回退到原始归档）
```

### 典型场景

**场景 A**：用户问「之前我们讨论过的 XX 项目进展到哪了？」
1. `query_index` query="XX 项目" types=["topic"]
2. 找到条目 → `get_memory` type="topic" id=找到的 ID
3. 返回完整项目记忆

**场景 B**：用户问「上周三我们聊了什么？」
1. `recall_raw` startDate="2026-03-26" endDate="2026-03-26"
2. 直接返回当天的摘要/日记/事实

**场景 C**：用户说「帮我记住，下周要交报告」
1. 直接调用 `save_memory` type="saved" saved_kind="arrangement" title="下周交报告"

**场景 D**：用户说「你记错了，我不是做前端的，我是做游戏客户端的」
1. 直接调用 `save_memory` type="self" category="identity" key="career_status" summary="用户是游戏客户端开发工程师"
2. 系统自动匹配并覆盖更新，回复确认「好的，已经改过来了」

**场景 E**：用户说「忘掉我之前的面试记录」
1. `query_index` query="面试" types=["self", "topic", "saved"]
2. 找到相关条目 → 确认是哪条 → `forget_memory` type=对应类型 id=对应 ID
3. 回复确认「已经忘掉了」

**场景 F**：用户说「这个不对，删掉」（指代上文提到的某条记忆）
1. 根据上下文确定要删除的记忆 → `forget_memory`
2. 回复确认「好的，已经删掉了」

## 记忆层次

你的记忆来源有三层（从内化到原始）：
1. **CONTEXT.md**（已在 System Prompt 中）：跨天精华，日常闲聊够用
2. **结构化记忆**（query_index + get_memory）：索引化的记忆对象
3. **原始归档**（recall_raw）：完整的日归档，极端情况下使用

大多数情况下 CONTEXT.md + 结构化记忆即可满足需求。

## 纠错与遗忘指南

### 识别纠错意图

用户可能用以下方式表达纠错：
- 「你记错了，我不是 XX，是 YY」→ 用 `save_memory` 覆盖更新
- 「不对，应该是 XX」→ 用 `save_memory` 覆盖更新
- 「更新一下，我现在 XX 了」→ 用 `save_memory` 覆盖更新

**纠正流程**：不需要先删再建。直接用 `save_memory` 传入正确信息，系统按语义匹配自动覆盖旧值。

### 识别遗忘意图

用户可能用以下方式表达遗忘请求：
- 「忘掉这个」「删掉这条」「别记这个了」
- 「这个不对，删了吧」
- 「把 XX 的记录清掉」

**遗忘流程**：
1. 先用 `query_index` 找到要删除的记忆条目（获取 type 和 id）
2. 确认后调用 `forget_memory` 删除
3. 用自然语言确认「已经忘掉了」「好的，已经删掉了」

### 注意事项

- 纠正优先于删除：如果用户说「这个不对」但给出了正确信息，应纠正（save_memory）而非删除
- 遗忘不可撤销：删除前如果用户意图不明确，先确认再操作
- 回复保持自然：不要说「已调用 forget_memory 工具删除」，说「好的，已经忘掉了」
