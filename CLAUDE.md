# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

AI 实践内容创作的工作区。管理从素材收集、选题规划到内容发布的完整流程。不是代码项目。

定位：AI 实践者视角的深度解读，不是新闻搬运。

## Platforms

- 公众号：长文，每周 1 篇，2000-4000 字
- X (Twitter)：短观察，每天 1-3 条

## Structure

```
inbox/index.md              # 素材收集区
topics/
  index.md                  # 选题总表
  _template/topic.md        # 选题模板
  <topic-slug>/topic.md     # 具体选题
posts/
  index.md                  # X/Twitter 帖子汇总
  YYYY-MM-DD-<slug>.md      # 单条帖子
playbook/
  positioning.md            # 内容定位
  platforms.md              # 平台规则
  workflow.md               # 工作节奏
  review-log.md             # 月度复盘
```

## Topic Lifecycle

`captured` → `planned` → `drafting` → `ready` → `published`（或 `dropped`）

状态变更时同步更新 topic 文件和 `topics/index.md`。

## Content Pillars

1. **实测对比**（核心，高频）：基于真实使用的工具对比
2. **工作流拆解**（常规）：AI 完成具体任务的完整过程
3. **趋势判断**（低频）：有立场的行业判断

## Key Rules

- 默认中文交流，git commit 用英文
- 每篇内容必须有可被质疑的核心观点
- 实测类必须基于真实使用，不能基于官方宣传
- 素材先进 inbox，不直接建 topic
- 追加式记录，不覆盖历史
