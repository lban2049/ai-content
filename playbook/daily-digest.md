# 每日 AI 信息简报 — 执行手册

## 目标

每天自动生成一份 AI 领域信息简报，筛选高价值内容，提交到仓库 `digests/` 目录。作为 inbox 的上游输入，供人工浏览后决定哪些值得转入选题。

## 执行环境

远程 Agent（如 OpenClaw、Claude Code 等）拉取本仓库，按本手册执行采集、分析、提交流程。

**可用工具：**

- **`opencli`**（主力）— 把网站变成命令行的工具，复用 Chrome 登录态，零 LLM 成本，结构化输出
- **WebSearch** — 通用搜索补充
- **WebFetch** — 抓取 opencli 未覆盖的网页

### opencli 说明

[OpenCLI](https://github.com/jackwener/opencli) 将任何网站变成命令行接口，覆盖 50+ 站点（HackerNews、Reddit、Twitter/X、arXiv、HuggingFace、GitHub 等）。

**安装**：`npm install -g @jackwener/opencli`（需要 Node.js >= 20）

**依赖**：opencli 有两种运行模式：
- **公开 API 模式**（无需浏览器）：hackernews、arxiv、hf、lobsters、devto、google、producthunt、bluesky 等
- **浏览器模式**（需要 Chrome + Browser Bridge 扩展 + 目标站点已登录）：twitter、reddit、medium、substack、bilibili 等

**诊断**：`opencli doctor` 检查扩展和 daemon 连通性

**输出格式**：所有命令支持 `-f json`（`--format json` 的缩写，推荐用于采集）、`table`（默认）、`yaml`、`md`、`csv`

**退出码**（用于判断采集结果）：
- `0` — 成功
- `66` — 无数据（命令返回空结果）
- `69` — Browser Bridge 未连接
- `77` — 未登录目标网站
- `75` — 超时，可重试

**发现更多命令**：`opencli list` 查看所有可用命令

---

## 执行流程

```
环境检查 → 采集（各数据源并行）→ 合并去重 → 评分筛选 → 分类整理 → 生成简报 → 提交仓库
```

### Step 0: 环境检查

采集前先验证工具可用性：

1. 运行 `opencli list -f json` 确认 opencli 已安装且可用
2. 运行 `opencli doctor` 检查 Browser Bridge 连通性
   - 如果 Bridge 不可用 → 标记所有浏览器模式源为"跳过"，仅执行公开 API 源
3. 对照数据源清单中的命令，确认子命令存在（`opencli <site> --help`）
   - 如果某命令不存在（opencli 版本差异）→ 跳过该源，尝试备选命令或 WebSearch

### Step 1: 数据采集

按下方"数据源清单"逐一采集，统一使用 `-f json` 获取结构化输出。可将独立的源并行执行。

**降级策略**：
- 某个源命令退出码非 0 → 根据退出码判断原因，跳过该源，继续其余采集
  - 退出码 69（Bridge 未连接）或 77（未登录）→ 该源所有浏览器模式命令均跳过
  - 退出码 75（超时）→ 重试一次，仍失败则跳过
  - 退出码 66（无数据）→ 正常，视为该源今日无相关内容
- 在最终简报的"采集状态"中注明每个源的结果
- **高优先级源**全部失败 → 放弃本次执行，不生成空简报
  - 高优先级源清单：HackerNews Top、HackerNews Show、Lobsters、GitHub Trending、HuggingFace Top Papers

### Step 2: 合并去重

- **时效性过滤**：只保留 48 小时内发布的内容。以 UTC 时间为基准，将各源的发布时间统一转换为 UTC 后比较（无法判断发布时间的条目保留）
- **去重**：
  - 相同 URL → 只保留一条
  - 标题相似度判断：将标题统一转为小写，去除标点，按空格分词（中文标题按字符分割），计算两个词集合的 Jaccard 相似度（交集/并集）。相似度 > 0.8 时视为重复，保留**归一化热度分**（见 Step 3）更高的那条

### Step 3: 评分筛选

为每条内容计算综合分数，用于排序。

**评分公式**：`总分 = 归一化热度分 + 关键词加分 + 内容相关性加分`

**归一化热度分**（将各平台指标映射到 0-100）：

| 平台 | JSON 字段 | 归一化公式 |
|------|----------|-----------|
| HackerNews | `.score` | `min(score / 5, 100)` |
| Reddit | `.upvotes` | `min(upvotes / 10, 100)` |
| GitHub | stars today（页面解析） | `min(stars * 2, 100)` |
| arXiv | 无实时指标 | 固定 40 分 |
| HuggingFace | `.upvotes` | `min(upvotes / 2, 100)` |
| Lobsters | `.score` | `min(score / 3, 100)` |
| Twitter | `.likes` + `.retweets` | `min((likes + retweets) / 5, 100)` |
| Product Hunt | `.upvotes` | `min(upvotes / 3, 100)` |
| Google News | 无热度指标 | 固定 30 分 |
| Substack/Medium/RSS | 无热度指标 | 固定 30 分 |
| DevTo | `.reactions` | `min(reactions / 5, 100)` |

> 注意：JSON 字段名基于 opencli 当前版本验证。如果实际输出的字段名不同，以 `opencli <site> <cmd> --limit 1 -f json` 的实际输出为准。

**关键词加分**（标题或摘要中命中即加分，多个关键词可叠加，上限 50）：

| 优先级 | 关键词 | 加分 |
|--------|-------|------|
| 高 | Claude, GPT-5, Gemini, DeepSeek, o3, o4 | +30 |
| 中 | GPT, LLaMA, Qwen, Mistral, agent, reasoning, multimodal | +20 |
| 低 | diffusion, transformer, fine-tuning, RLHF, RAG | +10 |

**内容创作相关性加分**（+15）：标题或摘要涉及以下场景之一即可——工具对比/评测、AI 工作流/自动化、行业趋势预判/格局变化。

### Step 4: 分类整理

按分数排序后，分配到 5 个主题分类：

| 分类 | 说明 | 上限 |
|------|------|------|
| 研究 (Research) | 论文、学术成果 | 8 |
| 工具与模型 (Tools & Models) | 开源项目、模型发布、开发工具 | 10 |
| 行业动态 (Industry) | 产品发布、融资、行业分析 | 8 |
| 社区讨论 (Community) | HN/Reddit/X 热门讨论 | 5 |
| 中文资讯 (Chinese) | 中文 AI 新闻 | 5 |

**总输出上限：40 条** = 5 条精选 + 各分类合计最多 35 条。精选从全局 top 5 中选出后，剩余条目再分配到各分类（各分类上限之和为 36，但受 35 条总量约束，先到先得）。

**最少输出**：如果去重筛选后不足 10 条，仍然生成简报，精选取实际条数的前 1/3（至少 1 条）。

### Step 5: 生成简报

从所有条目中取 **top 5** 作为精选 Highlights（跨分类），这 5 条不在分类中重复出现。

输出文件：`digests/YYYY-MM-DD.md`

格式模板见下方"输出格式"。

### Step 6: 提交仓库

1. 确定输出文件名：
   - 检查 `digests/YYYY-MM-DD.md` 是否已存在
   - 已存在 → 使用 `digests/YYYY-MM-DD-v2.md`（依次递增 v3, v4...）
   - 不存在 → 使用 `digests/YYYY-MM-DD.md`
2. 写入文件后提交：`git add digests/ && git commit -m "Add daily digest for YYYY-MM-DD"`
3. `git push`
4. 如果 push 因冲突失败 → `git pull --rebase` 后重试一次，仍失败则放弃并输出错误信息

---

## "AI 相关"筛选标准

采集 HackerNews、GitHub Trending 等通用源后，需判断哪些条目与 AI 相关。命中以下任一条件即保留：

**必选关键词**（标题或描述中包含，不区分大小写）：
`AI`, `artificial intelligence`, `machine learning`, `ML`, `deep learning`, `neural network`, `LLM`, `large language model`, `GPT`, `Claude`, `Gemini`, `transformer`, `diffusion`, `computer vision`, `NLP`, `natural language`, `reinforcement learning`, `generative`, `foundation model`, `fine-tuning`, `inference`, `embedding`, `vector`, `RAG`, `agent`, `copilot`, `coding assistant`

**来源直接相关**（以下源的全部内容默认保留，不需二次筛选）：
arXiv cs.AI/CL/LG、HuggingFace、r/MachineLearning、r/LocalLLaMA、关注的 X/Twitter 用户

---

## 数据源清单

> 扩展方式：直接在对应区域追加条目即可。
> 标注 `公开` 的无需浏览器，标注 `浏览器` 的需要 Chrome + Browser Bridge。

### 社区热点（高优先级）

| 数据源 | 采集命令 | 模式 | 筛选规则 |
|--------|---------|------|---------|
| HackerNews Top | `opencli hackernews top --limit 30 -f json` | 公开 | AI 相关（见筛选标准），score > 50 |
| HackerNews Show | `opencli hackernews show --limit 10 -f json` | 公开 | AI 相关项目 |
| Reddit r/MachineLearning | `opencli reddit subreddit MachineLearning --limit 15 -f json` | 浏览器 | 全部保留 |
| Reddit r/LocalLLaMA | `opencli reddit subreddit LocalLLaMA --limit 15 -f json` | 浏览器 | 全部保留 |
| Reddit r/artificial | `opencli reddit subreddit artificial --limit 10 -f json` | 浏览器 | 热帖 |
| Lobsters | `opencli lobsters hot -f json` | 公开 | AI 相关 |

### 开源与工具（高优先级）

| 数据源 | 采集命令 | 模式 | 筛选规则 |
|--------|---------|------|---------|
| GitHub Trending | 插件 `opencli-plugin-github-trending` 或 WebFetch `https://github.com/trending` | 公开 | AI 相关（见筛选标准） |
| HuggingFace Top Papers | `opencli hf top -f json` | 公开 | 全部保留 |
| Product Hunt | `opencli producthunt leaderboard -f json` | 公开 | AI 相关 |

### 学术论文（中优先级）

> 注意：arXiv API 有频率限制，多次搜索之间间隔 3 秒以避免 429 错误。如遇 429，等待 30 秒后重试一次。

| 数据源 | 采集命令 | 模式 | 筛选规则 |
|--------|---------|------|---------|
| arXiv AI | `opencli arxiv search "artificial intelligence" --limit 10 -f json` | 公开 | 全部保留 |
| arXiv LLM | `opencli arxiv search "large language model" --limit 10 -f json` | 公开 | 全部保留 |
| arXiv Agent | `opencli arxiv search "AI agent" --limit 10 -f json` | 公开 | 全部保留 |

### X/Twitter 关注用户（中优先级）

> 追加方式：添加一行 `@username | 采集命令 | 说明`

| 用户 | 采集命令 | 说明 |
|------|---------|------|
| @_akhaliq | `opencli twitter search "from:_akhaliq" --limit 10 -f json` | 每日论文速递 |
| @karpathy | `opencli twitter search "from:karpathy" --limit 5 -f json` | AI 技术观点 |
| @swyx | `opencli twitter search "from:swyx" --limit 5 -f json` | AI 工程实践 |

> 注意：Twitter 命令为浏览器模式，需要 Chrome 已登录 Twitter/X。

### Newsletter / 博客（中优先级）

> 追加方式：添加 feed URL 或 Substack publication URL 行

| 数据源 | 采集命令 | 模式 | 说明 |
|--------|---------|------|------|
| Substack AI 热门 | `opencli substack search "AI" --limit 10 -f json` | 浏览器 | AI 相关 newsletter |
| Medium AI | `opencli medium search "artificial intelligence" --limit 10 -f json` | 浏览器 | 热门 AI 文章 |
| Simon Willison's Blog | WebFetch `https://simonwillison.net/atom/everything/` | — | 独立开发者视角 |
| DevTo AI | `opencli devto top -f json` | 公开 | AI 相关文章 |

### 中文资讯（低优先级）

| 数据源 | 采集命令 | 模式 | 备选命令 |
|--------|---------|------|---------|
| 量子位 | `opencli google news "量子位 AI" -f json` | 公开 | WebSearch `site:qbitai.com AI` |
| 机器之心 | `opencli google news "机器之心 AI" -f json` | 公开 | WebSearch `site:jiqizhixin.com` |

### 兜底搜索

| 数据源 | 采集命令 | 说明 |
|--------|---------|------|
| Google News | `opencli google news "AI" -f json` | 公开，补充上述遗漏的重大新闻 |
| 通用搜索 | WebSearch `AI news today {date}` | 最终兜底 |

---

## 输出格式

文件路径：`digests/YYYY-MM-DD.md`

```markdown
# AI Daily Digest — YYYY-MM-DD

> 采集时间: HH:MM UTC | 数据源: N/M 成功 | 本期: X 条

## 今日精选

### 1. [标题](URL)
**来源**: HackerNews · score 320
一句话摘要，说明为什么值得关注。

### 2. [标题](URL)
...

（共 5 条精选，不足 5 条时取实际数量）

---

## 研究 (Research)

- [标题](URL) — 一句话摘要 `arXiv` `score: 85`
- ...

## 工具与模型 (Tools & Models)

- [标题](URL) — 一句话摘要 `GitHub` `⭐ 230 today`
- ...

## 行业动态 (Industry)

- [标题](URL) — 一句话摘要 `来源`
- ...

## 社区讨论 (Community)

- [标题](URL) — 一句话摘要 `Reddit` `↑ 450`
- ...

## 中文资讯 (Chinese)

- [标题](URL) — 一句话摘要 `来源`
- ...

---

## 采集状态

| 数据源 | 状态 | 条目数 | 备注 |
|--------|------|--------|------|
| HackerNews Top | ✅ | 12 | |
| Reddit r/MachineLearning | ✅ | 8 | |
| Twitter @_akhaliq | ❌ | 0 | 退出码 77: 未登录 |
| ... | ... | ... | ... |

*Generated by AI Daily Digest Agent*
```

---

## 与现有工作流的衔接

1. **digest → inbox**：每天浏览简报（对应 workflow.md "信息输入 15 min"），将值得深入的条目手动追加到 `inbox/index.md`
2. **inbox → topics**：周一 review inbox 时从中选题
3. **追加原则**：digest 文件生成后不修改，每天一份独立文件

---

## 定时任务配置参考

在任意支持定时触发的 Agent 平台（OpenClaw、Claude Code Schedule 等）中配置：

- **触发时间建议**：每天北京时间 08:00（UTC 00:00），确保前一天的内容已充分发布
- **Cron 表达式**：`0 0 * * *`
- **Git 源**：本仓库的 GitHub URL
- **Agent prompt**：`请按照 playbook/daily-digest.md 执行今日的信息简报采集，日期为 {today}`
- **所需能力**：文件读写、Bash 执行（运行 opencli）、WebSearch、WebFetch、Git 操作

---

## 扩展指南

### 添加 X/Twitter 用户

在"X/Twitter 关注用户"表格追加一行：
```
| @username | `opencli twitter search "from:username" --limit 5 -f json` | 描述 |
```

### 添加 Reddit 频道

在"社区热点"表格追加：
```
| Reddit r/name | `opencli reddit subreddit name --limit 10 -f json` | 浏览器 | 筛选规则 |
```

### 添加 RSS/Newsletter

在"Newsletter / 博客"表格追加：
```
| 名称 | WebFetch `https://feed-url/rss.xml` | — | 描述 |
```
或 Substack：
```
| 名称 | `opencli substack publication <url> -f json` | 浏览器 | 描述 |
```

### 添加新平台

运行 `opencli list` 查看所有可用命令和模式（公开/浏览器），然后在对应分类追加条目。也可安装社区插件：`opencli plugin install github:user/plugin-name`。

### 修改关键词偏好

编辑 Step 3 中的"关键词加分"表格和"AI 相关筛选标准"中的关键词列表。
