# 每日 AI 信息简报 — 执行手册

## 目标

每天自动生成一份 AI 领域信息简报，筛选高价值内容，提交到仓库 `digests/` 目录。作为 inbox 的上游输入，供人工浏览后决定哪些值得转入选题。

简报的核心目标不是“罗列链接”，而是帮助阅读者在 1~3 分钟内判断：今天哪些内容真的值得点开阅读全文，哪些可以直接跳过。因此每条入选内容都必须提供足够具体的中文总结与判断依据，避免只写“值得关注”“值得快速扫一眼”这类空话。

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
   - **不要只依赖 doctor 结果做最终判断**：某些环境下 doctor 可能报 Extension 未连接，但浏览器模式命令仍然可以正常返回数据
   - 建议额外做 1~2 个浏览器源抽样探测（如 `opencli reddit subreddit MachineLearning --limit 1 -f json`、`opencli twitter search "from:karpathy" --limit 1 -f json`）
   - 如果 doctor 失败且抽样命令也失败 → 标记所有浏览器模式源为"跳过"，仅执行公开 API 源
   - **CDP 降级**：对于关键的浏览器模式源（Reddit、Twitter），可通过 web-access skill 使用 CDP 协议直接操作 Chrome 浏览器采集，不依赖 opencli Browser Bridge
3. 对照数据源清单中的命令，确认子命令存在（`opencli <site> --help`）
   - 如果某命令不存在（opencli 版本差异）→ 优先尝试本地插件兼容命令、官方替代命令或 WebFetch / WebSearch

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
- **建议采集顺序**：先并行执行所有公开 API 源，再并行执行浏览器模式源。避免浏览器源超时阻塞整体进度

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
| GitHub | stars today（页面解析） | `min(stars / 10, 100)` |
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

**多样性约束**：精选 5 条必须来自 **至少 3 个不同数据源类型**（如 HackerNews、GitHub、Reddit、Twitter 各算一类）。如果 top 5 按纯分数排列后不满足此条件，将分数最低的同源条目替换为下一个不同源的最高分条目。

**摘要质量要求（强制）**：
- 所有摘要默认用中文撰写，即使原文是英文。
- 不能只写“值得关注”“值得一看”“可快速扫一眼”这类空泛评价，必须明确说明“它讲了什么 / 新在哪 / 为什么值得或不值得花时间”。
- 精选条目每条至少包含两层信息：
  1. **内容摘要**：用 1~2 句中文概括核心信息、主张、发布内容或争议点。
  2. **阅读判断**：再用 1 句说明为什么值得点开全文，或更适合谁看。
- 分类条目至少提供 1 句具体中文摘要；如果是新闻类，要点出事件本身；如果是论文/项目类，要点出方法、能力或使用价值；如果是社区讨论类，要点出争议焦点或实际启发。
- 遇到信息不足、标题党、纯转述、低信噪比条目时，宁可不收录，也不要用空洞摘要硬凑数量。

**优先保留的条目类型**：
- 能直接影响工具选择、工作流设计、内容选题判断的内容
- 带有明确新信息、新能力、新数据、新案例或强争议的内容
- 能帮助用户判断“是否值得稍后深入阅读”的原始材料

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
arXiv cs.AI/CL/LG、HuggingFace、r/MachineLearning、r/LocalLLaMA、r/ChatGPTCoding、r/MLOps、r/deeplearning、r/LanguageTechnology、关注的 X/Twitter 用户、AI 实验室博客（Anthropic/OpenAI/DeepMind/HuggingFace）

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
| Reddit r/singularity | `opencli reddit subreddit singularity --limit 10 -f json` | 浏览器 | 热帖 |
| Reddit r/ClaudeAI | `opencli reddit subreddit ClaudeAI --limit 10 -f json` | 浏览器 | 热帖 |
| Reddit r/OpenAI | `opencli reddit subreddit OpenAI --limit 10 -f json` | 浏览器 | 热帖 |
| Reddit r/ChatGPTCoding | `opencli reddit subreddit ChatGPTCoding --limit 15 -f json` | 浏览器 | 全部保留 |
| Reddit r/StableDiffusion | `opencli reddit subreddit StableDiffusion --limit 10 -f json` | 浏览器 | 热帖 |
| Reddit r/MLOps | `opencli reddit subreddit MLOps --limit 10 -f json` | 浏览器 | 全部保留 |
| Reddit r/deeplearning | `opencli reddit subreddit deeplearning --limit 10 -f json` | 浏览器 | 全部保留 |
| Reddit r/LanguageTechnology | `opencli reddit subreddit LanguageTechnology --limit 10 -f json` | 浏览器 | 全部保留 |
| Lobsters | `opencli lobsters hot -f json` | 公开 | AI 相关 |

### 开源与工具（高优先级）

| 数据源 | 采集命令 | 模式 | 筛选规则 |
|--------|---------|------|---------|
| GitHub Trending | `opencli github trending -f json`（兼容命令，底层可由本地插件提供）或 WebFetch `https://github.com/trending` | 浏览器 | AI 相关（见筛选标准） |
| HuggingFace Top Papers | `opencli hf top -f json` | 公开 | 全部保留 |
| Product Hunt | `opencli producthunt leaderboard -f json`（兼容命令，当前环境默认映射到 `today` feed） | 公开 | AI 相关 |

### 学术论文（低优先级，备选）

> **实测经验**：arXiv API 频繁 429 限流（即使间隔 30 秒重试也经常失败），且 HuggingFace Top Papers 已覆盖当日高影响力论文并附带社区投票信号。arXiv 搜索作为补充，仅在 HuggingFace 结果不足 5 条时启用。

| 数据源 | 采集命令 | 模式 | 筛选规则 |
|--------|---------|------|---------|
| arXiv AI | `opencli arxiv search "artificial intelligence" --limit 10 -f json` | 公开 | 全部保留 |
| arXiv LLM | `opencli arxiv search "large language model" --limit 10 -f json` | 公开 | 全部保留 |
| arXiv Agent | `opencli arxiv search "AI agent" --limit 10 -f json` | 公开 | 全部保留 |

> 如需启用：多次搜索之间间隔 **10 秒**（3 秒不够）。如遇 429，等待 **60 秒**后重试一次，仍失败则放弃。

### X/Twitter 关注用户（中优先级）

> 追加方式：添加一行 `@username | 采集命令 | 说明`

| 用户 | 采集命令 | 说明 |
|------|---------|------|
| @_akhaliq | `opencli twitter search "from:_akhaliq" --limit 10 -f json` | 每日论文速递 |
| @karpathy | `opencli twitter search "from:karpathy" --limit 5 -f json` | AI 技术观点 |
| @swyx | `opencli twitter search "from:swyx" --limit 5 -f json` | AI 工程实践 |
| @dair_ai | `opencli twitter search "from:daboromir" --limit 10 -f json` | AI 研究教育，论文解读 |
| @rasbt | `opencli twitter search "from:rasbt" --limit 5 -f json` | LLM 原理、训练技术 |
| @ylecun | `opencli twitter search "from:ylecun" --limit 5 -f json` | AI 方向争论、反炒作 |
| @DrJimFan | `opencli twitter search "from:DrJimFan" --limit 5 -f json` | 具身 AI、机器人 |
| @lilianweng | `opencli twitter search "from:lilianweng" --limit 5 -f json` | Agent 架构、深度研究 |
| @simonw | `opencli twitter search "from:simonw" --limit 10 -f json` | LLM 实测、工具评测 |
| @emollick | `opencli twitter search "from:emollick" --limit 10 -f json` | AI 对工作/教育影响 |
| @mattshumer_ | `opencli twitter search "from:mattshumer_" --limit 5 -f json` | AI 产品开发、能力评估 |
| @TheRundownAI | `opencli twitter search "from:TheRundownAI" --limit 10 -f json` | 每日 AI 新闻聚合 |
| @AlphaSignalAI | `opencli twitter search "from:AlphaSignalAI" --limit 10 -f json` | 热门 GitHub 项目、新模型 |
| @ClementDelangue | `opencli twitter search "from:ClementDelangue" --limit 5 -f json` | 开源模型发布、HF 生态 |
| @hardmaru | `opencli twitter search "from:hardmaru" --limit 5 -f json` | 创意 AI、非主流方向 |
| @AnthropicAI | `opencli twitter search "from:AnthropicAI" --limit 5 -f json` | Claude 更新、安全研究 |
| @OpenAI | `opencli twitter search "from:OpenAI" --limit 5 -f json` | GPT 生态更新 |
| @GoogleDeepMind | `opencli twitter search "from:GoogleDeepMind" --limit 5 -f json` | Gemini、研究突破 |
| @MetaAI | `opencli twitter search "from:MetaAI" --limit 5 -f json` | Llama 系列、开源发布 |

> 注意：Twitter 命令为浏览器模式，需要 Chrome 已登录 Twitter/X。
> **实测经验**：`opencli twitter search` 返回结果不按时间排序且可能包含数周前的推文。采集后必须按 `created_at` 字段过滤 48 小时窗口，不能依赖结果顺序判断时效。

### Newsletter / 博客（中优先级）

> 追加方式：添加 feed URL 或 Substack publication URL 行

| 数据源 | 采集命令 | 模式 | 说明 |
|--------|---------|------|------|
| Substack AI 热门 | `opencli substack search "AI" --limit 10 -f json` | 浏览器 | AI 相关 newsletter |
| Medium AI | `opencli medium search "artificial intelligence" --limit 10 -f json` | 浏览器 | 热门 AI 文章 |
| Simon Willison's Blog | WebFetch `https://simonwillison.net/atom/everything/` | — | 独立开发者视角 |
| DevTo AI | `opencli devto top -f json` | 公开 | AI 相关文章 |

#### AI 实验室/公司博客

| 数据源 | 采集命令 | 模式 | 说明 |
|--------|---------|------|------|
| OpenAI Blog | WebFetch `https://openai.com/news/rss.xml` | — | 模型发布、产品更新 |
| Google DeepMind Blog | WebFetch `https://deepmind.google/blog/rss.xml` | — | 前沿研究（Gemini、AlphaFold 等）|
| Google Research Blog | WebFetch `https://research.google/blog/rss/` | — | Google 全线 AI 研究 |
| HuggingFace Blog | WebFetch `https://huggingface.co/blog/feed.xml` | — | 开源模型、库更新、教程 |
| Anthropic Blog | WebFetch `https://www.anthropic.com/research` 检查新内容 | — | Claude 更新、安全/对齐研究（无原生 RSS，每次采集时抓取页面比对标题）|
| fast.ai | WebFetch `https://www.fast.ai/index.xml` | — | Jeremy Howard 的实用 DL 观点 |

#### 个人研究者/实践者博客

| 数据源 | 采集命令 | 模式 | 说明 |
|--------|---------|------|------|
| Lilian Weng (Lil'Log) | WebFetch `https://lilianweng.github.io/index.xml` | — | Agent/RLHF 等主题权威长文 |
| Sebastian Raschka (Ahead of AI) | WebFetch `https://magazine.sebastianraschka.com/feed` | — | LLM 论文深度解读，150K+ 订阅 |
| Nathan Lambert (Interconnects) | WebFetch `https://www.interconnects.ai/feed` | — | RLHF、开源模型、对齐研究 |
| Jay Alammar | WebFetch `https://jalammar.github.io/feed.xml` | — | 最佳 ML 可视化解释 |
| BAIR Blog (Berkeley AI) | WebFetch `https://bair.berkeley.edu/blog/feed.xml` | — | Berkeley 前沿研究通俗解读 |

#### 策展型 Newsletter

| 数据源 | 采集命令 | 模式 | 说明 |
|--------|---------|------|------|
| Import AI (Jack Clark) | WebFetch `https://importai.substack.com/feed` | — | Anthropic 联合创始人策展，AI 政策+研究 |
| Latent Space (swyx) | WebFetch `https://www.latent.space/feed` | — | AI 工程实践、工具、基础设施 |
| Last Week in AI | WebFetch `https://lastweekin.ai/feed` | — | 每周 AI 新闻综述 |
| The Gradient | WebFetch `https://thegradientpub.substack.com/feed` | — | 学术级长文分析、研究者访谈 |
| Ben's Bites | WebFetch `https://www.bensbites.com/feed` | — | AI 工具/产品/商业应用，150K+ 订阅 |

#### 聚合/研究 Feed

| 数据源 | 采集命令 | 模式 | 说明 |
|--------|---------|------|------|
| HF Daily Papers (社区维护) | WebFetch `https://jamesg.blog/hf-papers.xml` | — | AK 在 HuggingFace 策展的每日论文 |
| arXiv cs.AI+CL+LG 合并 | WebFetch `https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.LG` | — | 三类合并 feed（量大，作为 arXiv 搜索的替代方案）|

### 中文资讯（低优先级）

| 数据源 | 采集命令 | 模式 | 说明 |
|--------|---------|------|------|
| 36氪 AI | WebSearch `site:36kr.com AI 2026` | — | 中文科技媒体 |
| 即刻 AI 圈 | 浏览器访问 `https://web.okjike.com/topic/AI` 或 WebSearch | 浏览器 | 中文 AI 社区 |

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
**中文摘要**：这篇内容主要讲了什么，核心信息或核心观点是什么。
**为什么值得看**：它解决了什么问题、提供了什么新信息，或者为什么会影响工具选择 / 工作流判断。

### 2. [标题](URL)
...

（共 5 条精选，不足 5 条时取实际数量）

---

## 研究 (Research)

- [标题](URL) — 中文摘要：这篇论文/研究提出了什么方法、结果或数据，为什么值得你花时间判断是否细读。 `arXiv` `score: 85`
- ...

## 工具与模型 (Tools & Models)

- [标题](URL) — 中文摘要：这个项目/模型的核心能力、适用场景与值得关注的原因。 `GitHub` `⭐ 230 today`
- ...

## 行业动态 (Industry)

- [标题](URL) — 中文摘要：事件是什么、涉及哪些公司/资金/产品，以及它为什么值得留意。 `来源`
- ...

## 社区讨论 (Community)

- [标题](URL) — 中文摘要：讨论焦点是什么，赞成或质疑点在哪里，能带来什么启发。 `Reddit` `↑ 450`
- ...

## 中文资讯 (Chinese)

- [标题](URL) — 中文摘要：核心信息与是否值得进一步打开原文。 `来源`
- ...

---

## 推送预览

- 这部分不是“3~5 条精选通知”，而是给外部通知/定时任务消息直接复用的“完整预览版”。
- 推送消息应尽量覆盖 digest 里的全部入选内容：包含标题、链接、来源和中文总结；至少要把“今日精选 + 各分类条目”完整带出去，而不是只挑 3~5 条。
- digest 文件的职责是归档、沉淀、后续回查；推送消息的职责是让人直接在聊天窗口完成第一轮筛选。因此二者用途不同，但信息应尽量等价，不能让推送版只剩一个缩水摘要。
- 如果当天整体信噪比较低，也要在推送开头明确写出“今天整体一般，可只快速扫标题与摘要”，帮助用户节省注意力。
- 若消息长度接近平台上限，可优先保留：标题 + 链接 + 中文总结；缩短元信息，不要删掉条目本身。

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

- **触发时间建议**：每天北京时间 07:00（UTC 23:00，前一日），确保前一天的内容已充分发布
- **Cron 表达式**：`0 23 * * *`
- **重复策略**：永久执行，不设置 7 天/30 天之类的次数上限
- **Git 源**：本仓库的 GitHub URL
- **Agent prompt**：除执行采集外，还应在开始时先同步远程仓库最新变更；结束时向用户推送“报告路径 + digest 中全部入选内容的完整预览（含标题、链接、来源、中文总结）”的简报消息，而不是只汇报任务成功/失败或只推 3~5 条。
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
