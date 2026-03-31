---
date: 2026-03-31
status: final
topic: Agent 获取数据的最优解不是 RSS，是分层策略
tags: [AI Agent, RSS, 数据获取, 浏览器自动化, 实践验证]
---

想让 AI Agent 自己去获取信息，最好的方式是什么？

我最初的直觉是 RSS。结构化数据、无反爬、轻量，看起来完美。

花了一天验证，结论翻转了。

RSS 在开放平台确实能用，HackerNews、Medium、博客、Newsletter，数据干净，零成本。但我日常最多的场景是让 Agent 去盯 X 和 Reddit 上的动态，这两个平台都封杀了 RSS。

RSS 桥接能不能用？RSSHub 有 5000 多个公共实例，Folo 号称全平台订阅。实测下来公共实例大面积 403，Twitter 路由需要自建加 cookie 轮换还经常挂，Folo 的 MCP server 已经归档停维了。RSS3 的 AgentData 说是为 Agent 打造的互联网数据源，翻开文档 95% 是区块链数据。

还有一个发现是，对于那些支持 RSS 的开放站点，直接 WebFetch 抓网页效果一样好。有 AI 做提取层之后 HTML 和 RSS 的差距被抹平了，RSS 在 Agent 场景下几乎没有额外价值。

真正的瓶颈不是用什么协议，是平台让不让你拿数据。

目前我自己在用的分层策略是这样的。开放站点直接 WebFetch 就够了。封闭平台像 X 和 Reddit 用本地浏览器适配器，OpenCLI 或者 BB Browser，复用自己的登录态拿结构化数据。需要操作的场景比如自动发帖或者回复再上通用浏览器控制。

大部分人把所有场景都交给浏览器去做，这才是真正低效的地方。
