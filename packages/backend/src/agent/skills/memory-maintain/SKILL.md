---
name: memory-maintain
description: >
  记忆系统每日维护。seal day 完成后自动执行：索引重建、过时标记、文件失效检测。
  后续将增加 LLM 驱动的 topic 合并和 self 冲突检测能力。
---

# 记忆维护技能（Memory Maintain）

> 本 Skill 目前由系统自动触发，不在对话 agent loop 中使用。
> 后续增加 LLM 维护能力时，将通过 `backgroundAgentLoop()` 执行。

## 概述

记忆系统的健康维护 skill，对应 Karpathy LLM Wiki 的 `lint` 循环。
每日 seal day（归档封存）完成后自动执行，确保记忆系统数据一致、陈旧内容被合理标记。

## 当前维护任务（确定性，无需 LLM）

### 1. 索引重建（rebuildIndexes）

全量重建所有 5 类索引：source / self / relationship / topic / saved。
作用：对账。确保索引与实际磁盘上的 memory 对象完全一致，修复增量更新可能遗漏的不一致。

### 2. 过时标记（markStale）

#### Topic 生命周期推进

按 `lastActiveAt` 判断 topic 活跃度：
- 超过 **14 天**未活跃的 active topic → 标为 `paused`
- 超过 **60 天**未活跃的 topic → 标为 `archived`

#### Confidence 衰减

Self Memory 和 Relationship Memory 中，超过 **30 天**未更新的条目：
- confidence 每次衰减 0.05
- 最低衰减至 0.3（不会降至 0）

衰减的意义：让长期未被验证的记忆逐渐弱化，优先使用近期确认过的记忆。

### 3. Source 文件检测（checkSources）

遍历所有 active / stale 的 source：
- 文件不存在 → 标记 `deleted`
- 指纹变化（mtime / size 不同）→ 标记 `stale`，更新指纹
- URL 类型暂不检测

## 后续 LLM 维护任务（待实现）

以下任务需要 LLM 判断力，将在 MVP 之后通过 `backgroundAgentLoop()` 增加：

### Topic 合并

给 LLM 所有 active/paused topic 的索引条目，识别语义重叠可合并的 topic。
合并后保留更完整的那个，将另一个标记为 archived 并在 detail 中注明合并信息。

### Self 冲突检测

给 LLM 同 category 的所有 Self Memory items，识别相互矛盾的条目。
例如：一条说"用户偏好早起"，另一条说"用户习惯晚睡"，LLM 判断是否矛盾并建议保留哪条。

## 触发时机

- **每日 seal day 完成后**：自动调用 `runMaintenance()`
- **App 启动时**：不自动触发（boot 流程只处理未 sealed 的归档，不做维护）
- **手动触发**：后续可通过管理接口手动触发（待 C 阶段）
