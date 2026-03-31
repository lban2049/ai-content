# Inbox

素材收集区。AI 助手和用户都可以往这里追加。定期清理：有价值的转入 topics，其余删除。

格式：日期 + 来源 + 一句话说明为什么值得关注。

---

## 2026-03-30

### 潜在选题

- **Claude Code vs Codex 实测对比** — 用户同时深度使用两者，可以用同一个真实任务做对比（代码重构、项目搭建、bug 修复等），这是第一篇公众号文章的强候选。栏目：实测对比
- **我的 AI 辅助工作流全景** — 拆解自己日常如何组合使用 Claude Code、Codex、OpenClaw 等工具，哪个环节用什么，为什么。栏目：工作流拆解
- **AI Coding Agent 到底到什么水平了** — 基于实际使用 Claude Code 和 Codex 的体感，给出"当前 AI coding 能做到什么、做不到什么"的判断。栏目：趋势判断
- **用 AI 自动化信息收集流程** — 把搭建本内容项目的信息聚合管道过程本身写成一篇内容，展示 AI 在自动化工作流中的实际效果。栏目：工作流拆解
- **OpenClaw 深度使用体验** — 如果这个工具足够有特色，可以做一篇单独的深度测评，面向不了解它的受众。栏目：实测对比
- **"工作流成瘾"：搭建 AI 工作流的爽感陷阱** — 亲身经历：搭建工作流的过程有即时满足感，但产出物没有真实使用场景。以日报工作流为例，跑了几天发现生成的内容并没有被真正消费。核心观点：需求倒置——应该先有痛点再搭工作流，而不是因为 AI 能搭所以去搭。检验标准：停掉一周是否影响实际产出。可以延伸为公众号长文（趋势判断）或 X 系列帖。栏目：趋势判断 / 实践碎片

## 2026-03-31

### Folo (formerly Follow) 深度调研

调研目标：评估 Folo 作为 AI agent 信息聚合管道的可行性，特别是对闭合平台的支持和程序化访问能力。

#### 1. Folo 与 RSSHub 的技术关系

- **Folo 依赖 RSSHub 作为核心基础设施**，但 RSSHub 并非内嵌/捆绑在 Folo 中。Folo 通过 `rsshub://` 协议链接对 RSSHub 做了专门的内部优化支持（如 `rsshub://bilibili/user/video/508452265`）。
- Folo 内置了多个**社区共享的 RSSHub 公共实例**，用户可在 app 内一键浏览、切换。这些实例仅供 Folo 内部使用，不兼容外部阅读器。
- 用户可以添加自定义 RSSHub 实例，但**必须是公网可访问的**——不支持局域网实例（[Issue #4318](https://github.com/RSSNext/Folo/issues/4318)）。
- Folo 的服务端不开源，团队明确表示**不计划支持自建部署**（[Issue #4164](https://github.com/RSSNext/Folo/issues/4164)），社区对此有 paywall 担忧。
- 来源：[异次元软件评测](https://www.iplaysoft.com/follow-app.html), [Axi's Blog](https://axi404.github.io/blog/folo/), [DeepWiki](https://deepwiki.com/RSSNext/Folo)

#### 2. 闭合平台支持情况

**Twitter/X：**
- Folo 通过 RSSHub 路由支持 X/Twitter 订阅，**不是自有方法**。
- RSSHub 的 Twitter 路由需要自建实例 + 配置 `TWITTER_AUTH_TOKEN` 和 `TWITTER_COOKIE`（从浏览器提取 session cookie）。公共实例一般不提供 Twitter 路由。
- **可靠性差**：2025 年多次出现 403 Forbidden、空内容、token 失效等问题。2025 年 6 月一次大规模故障持续约 9 天后恢复（[Issue #19420](https://github.com/DIYgod/RSSHub/issues/19420)）。需要多账号 token 轮换、定期刷新。
- HN 用户评价："It is unnecessarily annoying / difficult to just get a daily digest of tweets you're interested in"。对于需要提供 session cookie 给第三方服务这件事，用户也表示安全顾虑。

**微信公众号：**
- 异次元软件评测明确指出：**微信公众号不支持**。原因是微信缺乏开放 Web 接口且限制严格，"稳定获取内容不可能"。
- RSSHub 有微信路由（通过 WeWe-RSS/Wechat2RSS 等中间服务），但这些是独立项目，需要额外部署，且不稳定。

**Reddit：**
- RSSHub 有 Reddit 路由，Reddit 本身也保留了原生 RSS（在 URL 后加 `.rss`），理论上可用。
- 搜索中未发现 Folo 用户专门反馈 Reddit 订阅问题，推测相对可用。

#### 3. API 与程序化访问能力

**官方 API：**
- Folo 有一个内部 API 服务（`api.folo.is`），所有客户端通过 `@follow-app/client-sdk` 与之通信，提供 feeds、entries、subscriptions、user management 等类型安全的 API 方法。
- **但没有公开的 API 文档**，没有开发者门户，没有官方的第三方接入支持。这是一个内部 API，不是开发者平台。

**MCP Server（第三方）：**
- 存在一个社区开发的 [folo-mcp](https://github.com/hyoban/folo-mcp)（作者 hyoban/Stephen Zhou，Folo 团队成员），提供 4 个工具：
  - `getSubscriptions()` — 获取订阅列表
  - `getFilteredEntries()` — 获取文章，支持过滤和限数
  - `getUnreadCount()` — 未读计数
  - `markAsRead()` — 标记已读
- 认证方式：从浏览器提取 `FOLO_SESSION_TOKEN`，设为环境变量。
- **该仓库已于 2026 年 2 月归档（archived）**，不再维护。
- 不确认是否能获取文章全文内容还是仅元数据。

**数据导出：**
- 支持 OPML 导入/导出（订阅列表级别）。
- 无文章内容、阅读历史等的批量导出功能。

#### 4. 用户真实体验与评价

- Privacy Guides 社区反馈：Folo 发送大量 trackers（被 Brave Shields 拦截）；请求 feed 时不使用正常 user agent（被批评为"恶意 bot 行为"）；AI 功能被视为不必要的 bloat。
- 订阅上限 500 条（对比 Inoreader 免费版 150 条）。
- 需要国际 IP 才能稳定访问（RSSHub 服务器限制）。
- 高级功能需要邀请码或 token 支付。

#### 5. 对我们的评估结论

**作为 AI agent 信息管道的可行性：低**
- Twitter 路由不可靠，需要维护成本高（cookie 轮换、自建 RSSHub）
- 微信公众号基本不可用
- 没有正式的开发者 API，MCP server 已归档
- 服务端不开源、不支持自建，意味着依赖第三方闭源服务

**更现实的方案：**
- Twitter 信息获取：直接用 Twitter API v2（付费）或 Nitter 自建实例
- Reddit：直接用 Reddit 原生 RSS（免费、稳定）
- 微信公众号：WeWe-RSS 或 we-mp-rss 自建
- 如果要用 Folo，仅作为人工阅读器使用，不作为程序化管道
