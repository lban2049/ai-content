# X Following Filter — 执行手册

## 目标

基于本地浏览器登录态，定时读取 X 的 `following timeline`，经过两轮过滤后生成一份高信号阅读清单，减少手动刷流时间。

这不是一个发帖机器人，也不是一个社交监听系统。目标只有一个：

- 从你真实会看的关注流里，筛出值得读的内容

## 适用范围

- 输入源：X 首页的 `Following` 时间线
- 模式：对 X 平台只读，本地允许写文件
- 环境：本地浏览器登录 X，`opencli` 可用，Browser Bridge 正常
- 输出：结构化候选数据 + `selected-posts/` 下的人类可读阅读文件

## 执行前提

这份手册按以下环境验证过：

- `opencli >= 1.5.5`
- Chrome/Chromium 浏览器
- Browser Bridge 已连接
- X 已在同一浏览器 profile 中登录

如果环境不同，先做最小探测，不要直接进入定时任务。

## 默认原则

- MVP 不维护 follow 列表，直接以 `following timeline` 作为唯一输入源
- 对 X 平台不做任何写操作：不点赞、不转发、不回复、不关注、不发帖
- 不追求抓全站内容，只追求抓到你自己的高价值关注流
- 先保守运行，再逐步提高频率

---

## 执行流程

```text
环境检查 → 定时抓取 following timeline → 去重入库 → 第一轮内容过滤
→ 候选延迟队列 → 4 小时后二次回查互动 → 生成阅读清单 → 输出 digest
```

## Step 0: 环境检查

每次启动前先检查：

1. `opencli doctor`
2. `opencli twitter timeline --type following --limit 3 -f json`

只有在以下条件同时满足时才允许进入采集：

- Browser Bridge 正常
- 当前浏览器 profile 已登录 X
- `timeline` 命令能返回非空 JSON
- JSON 至少包含 `id`、`author`、`text`、`created_at`、`url`

出现以下情况时直接停止本轮任务：

- 出现验证码、登录校验、异常设备验证
- 连续 3 次返回空结果
- 连续 3 次超时
- 返回内容明显不是 `Following` 时间线

### 最小数据契约

`opencli twitter timeline --type following -f json` 的单条记录，至少要能映射出以下字段：

- `tweet_id`: 由 `id` 映射
- `author`
- `text`
- `created_at`
- `url`

以下字段允许为空，但字段缺失时必须写入 `null`，不能让 agent 自行猜默认值：

- `views`
- `likes`
- `retweets`
- `replies`

如果 `thread` 或 `article` 子命令不可用，允许降级为“只保留列表页原文 + 标记 `needs_manual_check`”，但不能中断整轮任务。

---

## Step 1: 抓取策略

### 输入源

固定使用：

```bash
opencli twitter timeline --type following --limit 40 -f json
```

默认每轮抓 40 条。MVP 不做深翻页，不主动扫作者主页。

只有在以下情况才允许补抓一次：

- 距离上次成功抓取超过 60 分钟
- 本轮新增帖子少于 5 条，但最近 2 小时本应是活跃时段
- 上一轮处理过程中发现多条候选内容被截断

补抓方式：

- 再执行一次 `timeline`，将 `limit` 提高到 `80`
- 或在浏览器中向下滚动一次后再执行抓取

每轮最多补抓 1 次，避免高频重复访问。

### 时间间隔

默认按两个时段执行：

- `08:30-23:30`：每 `22-38` 分钟随机执行一次
- `23:30-08:30`：每 `90-150` 分钟随机执行一次，或直接暂停

不要使用固定的 15 分钟、30 分钟整点节奏。每轮都要重新抽样随机间隔。

推荐随机规则：

- 工作时段：基础值 `28 min`，抖动 `±10 min`
- 夜间：基础值 `120 min`，抖动 `±30 min`

额外抖动：

- 4 小时后二次回查时，再增加 `±12 min` 随机偏移

### 单日上限

为了控制风控和噪音，建议设置硬上限：

- 每日时间线抓取不超过 `45` 轮
- 每轮详情补抓不超过 `5` 条
- 每日详情补抓不超过 `80` 条
- 每日最终入选不超过 `30` 条

---

## Step 2: 数据存储

建议将运行数据放在本地运行目录，不直接提交到 Git：

```text
.runtime/x-following-filter/
  state/
    cursor.json
    health.json
  raw/
    YYYY-MM-DD/
      timeline-<timestamp>.json
      detail-<tweet_id>.json
  queue/
    candidates.jsonl
    recheck.jsonl
  outputs/
    YYYY-MM-DD.md
```

### 状态文件

`cursor.json`

- `recent_seen_ids`: 最近已处理的 tweet id 集合
- `last_success_at`
- `last_run_at`
- `consecutive_failures`

`health.json`

- `bridge_ok`
- `login_ok`
- `last_empty_runs`
- `last_timeout_runs`
- `risk_flags`

### 原始数据

`raw/YYYY-MM-DD/timeline-<timestamp>.json`

- 保留每轮原始抓取结果
- 用于回放、比对、调试打分问题

`raw/YYYY-MM-DD/detail-<tweet_id>.json`

- 保留详情页、thread、article 的补抓结果

### 队列数据

`candidates.jsonl`

每条记录至少包含：

- `tweet_id`
- `url`
- `author`
- `text`
- `created_at`
- `views`
- `likes`
- `retweets`
- `replies`
- `captured_at`
- `approved_at`
- `quality_score`
- `quality_reason`
- `needs_detail_fetch`
- `needs_manual_check`
- `recheck_at`
- `status`

`recheck.jsonl`

- 只存等待 4 小时二次回查的候选

---

## Step 3: 去重与新帖判断

MVP 使用以下规则：

- 相同 `tweet_id` 视为同一条
- 已进入 `candidates` 或 `outputs` 的内容，本日内不重复处理
- 只要 `tweet_id` 不在 `recent_seen_ids` 中，就允许进入处理
- 不依赖 tweet id 严格单调递增
- 即使一条帖子比最近处理过的 id 更旧，只要此前没见过且仍在观察窗口内，仍然处理

观察窗口默认：

- 只处理 `72` 小时内的帖子
- `recent_seen_ids` 至少保留最近 `1000` 个 id

这样可以减少 following timeline 重新浮现旧帖时的漏帖问题。

---

## Step 4: 第一轮内容过滤

目标不是判断“火不火”，而是判断“值不值得读”。

### 直接丢弃

命中以下任一情况直接丢弃：

- 纯生活记录
- 纯情绪吐槽
- 只有一句态度，没有信息增量
- 只有转发或贴链接，没有补充判断
- 明显广告、抽奖、推广
- 低信息量玩梗

### 优先保留

命中以下任一情况优先保留：

- 明确的一手使用体验
- 工具对比和取舍判断
- 工作流拆解
- 失败复盘
- 对新能力、新模型的实测反馈
- 有方法、有案例、有结论

### 评分规则

给每条内容打 `0.0-5.0` 分，步进为 `0.5`：

- `5.0`: 必读，有明确判断和实践信息，值得沉淀
- `4.0-4.5`: 有明显信息价值，建议进入候选
- `3.0-3.5`: 有一点价值，但需要更多上下文
- `2.0-2.5`: 信息弱
- `1.0-1.5`: 几乎无信息
- `0.0-0.5`: 噪音

默认阈值：

- `>= 4.0`：直接进入候选池
- `= 3.5`：进入“待补抓”队列，允许补抓一次详情后重新评分
- `<= 3.0`：默认不进入候选池
- `<= 2`：直接丢弃

### 详情补抓规则

满足以下任一条件时，允许补抓详情：

- 列表页文本明显被截断
- 怀疑是 thread
- 怀疑是 article
- 第一轮分数在 `3.5-4.5` 之间，需要补充上下文

处理路径：

- `4.0-4.5`：已是候选，可补抓详情以提升信息完整度
- `3.5`：先进入“待补抓”队列，补抓后重打分；只有提升到 `>= 4.0` 才进入候选池

补抓优先级：

1. `opencli twitter thread <tweet-id> -f json`
2. `opencli twitter article <tweet-id> -f md`
3. 打开详情页重新抓取

不要对全部帖子补抓详情，只对候选或 `3.5` 分的“待补抓”条目做补抓。

---

## Step 5: 第二轮互动过滤

第一轮通过后，不立即输出，先进入等待队列。

### 回查时间锚点

- 调度基准默认使用 `captured_at`
- `created_at` 只用于计算帖子年龄，不直接作为调度唯一基准

### 回查规则

- 如果首次抓到时，帖子年龄 `< 4 小时`：在 `captured_at + (4 小时 ± 12 分钟)` 回查
- 如果首次抓到时，帖子年龄 `>= 4 小时`：在当前轮立即进入第二轮回查
- 如果 `created_at` 缺失：按 `captured_at` 处理，不阻塞流程

### 回查目的

- 更新互动数据
- 判断这条内容是否真的被市场验证

### 默认互动分

```text
interaction_score = likes + 3 * retweets + 2 * replies
```

### 默认通过条件

满足以下任一条件即可保留：

- `quality_score >= 4.5`
- `interaction_score >= 20`
- `views >= 500` 且 `quality_score >= 4`

以下情况默认淘汰：

- `views < 100` 且 `interaction_score < 5` 且 `quality_score < 4.5`

### 备注

这组阈值只适合 MVP。先跑一段时间，观察最终保留下来的数量和质量，再决定是否调整。

### 通过时间与落盘日期

- 帖子真正进入 `selected-posts/` 的时间记为 `approved_at`
- `selected-posts/YYYY-MM-DD.md` 按 `approved_at` 的日期落盘
- 不按 `created_at` 或 `captured_at` 的日期落盘

这样可以保证你每天看到的是“当天实际通过二轮过滤的帖子”。

---

## Step 6: 输出模板

本地运行结果放到：

```text
.runtime/x-following-filter/outputs/YYYY-MM-DD.md
```

两轮过滤都通过后，自动写入：

```text
selected-posts/YYYY-MM-DD.md
```

这条流与 `inbox`、每日日报无关，是一条独立的阅读输入线。

### `selected-posts/` 写入规则

- 采用追加式写法，不覆盖历史
- 每天一个文件：`YYYY-MM-DD.md`
- 一条内容只追加一次
- 只保留真正通过两轮过滤的帖子

### 单条记录模板

```md
## @username — YYYY-MM-DD HH:mm

链接：<tweet-url>

原文：
> 原始帖子内容

中文翻译：
> 如果原文是英文，提供中文翻译；如果原文是中文，可省略本段

AI 总结：
- 这条在说什么
- 为什么值得读
- 可关注的信息点

人工复核：
- `yes/no`
```

### 输出格式

```md
# Selected Posts — YYYY-MM-DD

## 运行状态
- 抓取轮次：
- 成功轮次：
- 失败轮次：
- 详情补抓：
- 候选总数：
- 最终保留：

## Selected

### @username — YYYY-MM-DD HH:mm
链接：

原文：
> ...

中文翻译：
> ...

AI 总结：
- 这条在说什么
- 为什么值得读
- 可关注的信息点

人工复核：
- `yes/no`
```

### 记录要求

每条最终保留内容必须包含：

- `原帖链接`
- `原始内容`
- `英文内容的中文翻译`
- `AI 总结`

### 翻译规则

- 原文是英文：必须提供中文翻译
- 原文是中文：不重复翻译
- 原文中夹杂链接、emoji、用户名时，翻译时保留关键信息，不强行逐字符直译

### 降级规则

- 翻译失败：保留原文，写入 `翻译失败，待人工补充`，并标记 `needs_manual_check = true`
- AI 总结失败：写入 `总结失败，待人工补充`，并标记 `needs_manual_check = true`
- 详情抓取失败：允许用列表页原文继续写入，但必须标记 `needs_manual_check = true`

---

## 风控规则

### 必须遵守

- 对 X 平台只读，不做任何互动或写入动作
- 允许写本地文件：`.runtime/` 和 `selected-posts/`
- 固定浏览器 profile
- 固定设备环境
- 固定网络环境，不频繁切 IP
- 不同时开多个自动化会话
- 不在异常弹窗出现时继续执行

### 频率控制

- 不使用固定间隔
- 不在短时间内连续刷新首页
- 不连续大量打开详情页
- 不一次性深翻很多屏

### 触发停止条件

出现以下任一情况，立即停止当日任务：

- 验证码
- 风险提示
- 登录失效
- 页面异常跳转
- timeline 命令连续失败 3 次

停止后只记录日志，不做自动重试风暴。

### 停机优先级

- `跳过单条`：某一条详情抓取或翻译失败
- `跳过本轮`：当前轮 timeline 超时 2 次或返回异常页面
- `停止当日任务`：验证码、登录失效、风险提示，或 timeline 连续失败 3 次

---

## 异常处理

### 空结果

可能原因：

- 当前 following timeline 本身没有新内容
- 浏览器状态异常
- 命令命中了错误页面

处理方式：

- 第 1 次：等待随机 `8-15` 分钟后重试
- 连续 3 次：停止本轮，标记异常

### 超时

处理方式：

- 仅重试 1 次
- 第二次仍超时，跳过本轮

### 详情抓取失败

处理方式：

- 保留列表页内容
- 标记 `needs_manual_check = true`

---

## 推荐迭代顺序

### V1

- 只抓 `following timeline`
- 只做两轮过滤
- 只输出每日 `selected-posts`

### V2

- 加入 thread 自动补全
- 优化第二轮互动阈值

### V3

- 将高质量条目自动映射到栏目：实测对比 / 工作流拆解 / 趋势判断
- 生成更稳定的 `selected-posts/` 摘要格式

---

## 实践验证闸门

`selected-posts/` 是阅读输入，不是可直接发布的写作素材池。

进入 `selected-posts/` 只代表：

- 值得你读
- 值得你观察
- 可能值得你后续验证

但不代表：

- 可以直接写成观点输出
- 可以直接进入 `inbox`
- 可以直接作为趋势判断依据

如果后续要把其中内容转入 `inbox`、topic 或文章草稿，必须额外补上至少一项你自己的实践：

- 自己复现
- 自己对比
- 自己试用
- 自己验证其结论是否成立

---

## Agent 执行摘要

如果由 agent 执行，默认遵守以下摘要：

- 采集源固定为 X `following timeline`
- 日间随机 `22-38` 分钟抓取一次
- 候选延迟 `4 小时 ± 12 分钟` 二次回查
- 所有操作只读
- 遇到风险提示立即停止
- 最终通过两轮过滤的内容自动写入 `selected-posts/YYYY-MM-DD.md`
- `selected-posts/` 仅供阅读，不直接进入写作漏斗
