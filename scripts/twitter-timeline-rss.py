#!/usr/bin/env python3
"""
Twitter Timeline → RSS + GitHub Push
每次运行：抓取 timeline → 写本地 RSS → 推送到 GitHub 仓库。
用法: python3 twitter-timeline-rss.py [--max-pages 5]
"""

import json, subprocess, argparse, time, sys
from pathlib import Path
from datetime import datetime
from typing import Optional

# --- 配置 ---
STATE_FILE   = Path.home() / ".hermes" / "scripts" / ".twitter-rss-state.json"
RSS_FILE     = Path.home() / ".hermes" / "cron"    / "output" / "twitter-timeline-rss.xml"
GIT_LOCK     = Path.home() / ".hermes" / "scripts" / ".twitter-rss-git.lock"
GIT_REPO     = Path.home() / "dev" / "code" / "ai-content"
GIT_BRANCH   = "main"
GIT_RSS_PATH = "rss/twitter-timeline-rss.xml"   # 仓库内的路径


# ─── Git helpers ────────────────────────────────────────────────────────────────

def git_run(args: list, **kw):
    kw.setdefault("cwd", GIT_REPO)
    kw.setdefault("capture_output", True)
    kw.setdefault("text", True)
    kw.setdefault("timeout", 30)
    r = subprocess.run(["git"] + args, **kw)
    if r.returncode != 0:
        print(f"[git] FAIL: {' '.join(args)}", flush=True)
        print(f"[git] stdout: {r.stdout[:300]}", flush=True)
        print(f"[git] stderr: {r.stderr[:300]}", flush=True)
        raise RuntimeError(f"git {' '.join(args)} failed")
    return r.stdout.strip()


def push_rss_to_github(xml_content: str) -> Optional[str]:
    """把 RSS 内容写入仓库路径并推送。返回 raw URL 或 None。"""
    lock = GIT_LOCK
    if lock.exists():
        # 上次推送可能在进行中，等一下
        print("[git] 检测到上次的 push 还在进行，等待 30s...", flush=True)
        time.sleep(30)
        if lock.exists():
            print("[git] 上次 push 仍未完成，跳过本次推送", flush=True)
            return None

    lock.write_text(str(time.time()))
    try:
        # 确认 git identity
        git_run(["config", "user.name", "LBan"])
        git_run(["config", "user.email", "hanxl5123@163.com"])

        # pull --rebase 防冲突
        try:
            git_run(["pull", "--rebase", "origin", GIT_BRANCH])
        except Exception as e:
            print(f"[git] pull --rebase 失败（可能无上游）: {e}", flush=True)

        repo_rss = GIT_REPO / GIT_RSS_PATH
        repo_rss.parent.mkdir(parents=True, exist_ok=True)
        repo_rss.write_text(xml_content, encoding="utf-8")

        # 检查是否有变化
        status = git_run(["status", "--porcelain", GIT_RSS_PATH])
        if not status:
            print("[git] RSS 内容无变化，跳过 commit", flush=True)
            return None

        git_run(["add", GIT_RSS_PATH])
        msg = f"📡 Twitter RSS 更新 {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
        git_run(["commit", "-m", msg])
        git_run(["push", "origin", GIT_BRANCH])

        raw_url = (
            f"https://raw.githubusercontent.com/lban2049/ai-content"
            f"/{GIT_BRANCH}/{GIT_RSS_PATH}"
        )
        print(f"[git] 已推送。订阅地址: {raw_url}", flush=True)
        return raw_url

    finally:
        if lock.exists():
            lock.unlink()


# ─── OpenCLI helpers ──────────────────────────────────────────────────────────

def run_opencli(args: list) -> list:
    cmd = ["opencli"] + args
    print(f"[opencli] {' '.join(cmd)}", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print(f"[opencli] STDERR: {r.stderr}", flush=True)
        raise RuntimeError(f"opencli failed: {r.stderr}")
    text = r.stdout.strip()
    s, e = text.find('['), text.rfind(']') + 1
    if s == -1 or e == 0:
        raise RuntimeError(f"Cannot find JSON array: {text[:200]}")
    return json.loads(text[s:e])


def tweet_ts(created_at: str) -> float:
    return datetime.strptime(created_at, "%a %b %d %H:%M:%S +0000 %Y").timestamp()


# ─── 核心逻辑 ─────────────────────────────────────────────────────────────────

def fetch_new_tweets(since_ts: Optional[float], max_pages: int) -> list:
    all_tweets, seen = [], set()
    for page in range(max_pages):
        tweets = run_opencli([
            "twitter", "timeline",
            "--type", "following",
            "--limit", "200",
            "--format", "json",
        ])
        if not tweets:
            break
        tweets_sorted = sorted(tweets, key=lambda t: tweet_ts(t["created_at"]))
        for t in tweets_sorted:
            if since_ts and tweet_ts(t["created_at"]) <= since_ts:
                continue
            if t["id"] not in seen:
                seen.add(t["id"])
                all_tweets.append(t)
        print(f"[opencli] 第 {page+1} 页: {len(tweets)} 条，新增 {len([t for t in tweets_sorted if t['id'] in seen])} 条", flush=True)
        if since_ts and tweets_sorted and tweet_ts(tweets_sorted[0]["created_at"]) <= since_ts:
            print(f"[opencli] 已到达锚点，停止翻页", flush=True)
            break
    all_tweets.reverse()
    return all_tweets


def make_rss(new_tweets: list) -> str:
    if not new_tweets:
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Twitter Timeline RSS</title>
    <link>https://x.com</link>
    <description>你的 Twitter Following Timeline（via opencli）</description>
    <language>zh-cn</language>
    <lastBuildDate>{datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")}</lastBuildDate>
  </channel>
</rss>"""

    items = ""
    for t in new_tweets:
        dt = datetime.strptime(t["created_at"], "%a %b %d %H:%M:%S +0000 %Y")
        pub = dt.strftime("%a, %d %b %Y %H:%M:%S +0000")
        text = (t["text"]
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))
        items += f"""
    <item>
      <title>{text[:100]}{'...' if len(text) > 100 else ''}</title>
      <link>{t["url"]}</link>
      <guid isPermaLink="false">{t["id"]}</guid>
      <pubDate>{pub}</pubDate>
      <description><![CDATA[{text}

---
@{t["author"]} | ❤️ {t.get("likes",0)} | 🔁 {t.get("retweets",0)} | 💬 {t.get("replies",0)} | 👁 {t.get("views",0)}]]></description>
      <author>@{t["author"]}</author>
    </item>"""

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Twitter Timeline RSS</title>
    <link>https://x.com</link>
    <description>你的 Twitter Following Timeline（via opencli）</description>
    <language>zh-cn</language>
    <lastBuildDate>{datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")}</lastBuildDate>
    <atom:link href="https://raw.githubusercontent.com/lban2049/ai-content/{GIT_BRANCH}/{GIT_RSS_PATH}" rel="self" type="application/rss+xml"/>{items}
  </channel>
</rss>"""


# ─── 主流程 ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-pages", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    state = load_state()
    since_ts = state.get("last_run_ts")

    if since_ts:
        dt = datetime.utcfromtimestamp(since_ts)
        print(f"[main] 锚点: {dt.strftime('%Y-%m-%d %H:%M:%S')} UTC", flush=True)

    tweets = fetch_new_tweets(since_ts, args.max_pages)
    print(f"[main] 本次新增 {len(tweets)} 条", flush=True)

    if tweets:
        print(f"[main] 最新: {[(t['author'], t['id']) for t in tweets[:2]]}", flush=True)
        print(f"[main] 最旧: {[(t['author'], t['id']) for t in tweets[-1:]]}", flush=True)

    if args.dry_run:
        for t in tweets:
            dt = datetime.strptime(t["created_at"], "%a %b %d %H:%M:%S +0000 %Y")
            print(f"  [{dt.strftime('%H:%M')}] @{t['author']}: {t['text'][:60]}...")
        return

    # 更新状态
    new_ids = [t["id"] for t in tweets]
    state["seen_ids"] = (state.get("seen_ids", []) + new_ids)[-500:]
    if tweets:
        # 必须用本批最新推文的时间戳作为锚点，这样下次只取更新的推文
        state["last_run_ts"] = max(tweet_ts(t["created_at"]) for t in tweets)
    state["last_run"] = datetime.utcnow().isoformat()
    save_state(state)

    # 生成 RSS（本地 + GitHub）
    rss_xml = make_rss(tweets)
    RSS_FILE.parent.mkdir(parents=True, exist_ok=True)
    RSS_FILE.write_text(rss_xml, encoding="utf-8")
    raw_url = push_rss_to_github(rss_xml)

    # 最终摘要（这一行会被 cron 结果摘要使用）
    print(f"📡 Twitter RSS 更新 | 新推文 {len(tweets)} 条 | 累计追踪 {len(state['seen_ids'])} 条 | {'✅ GitHub 已推送' if raw_url else '⚠️ 无变化或推送失败'}")


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"seen_ids": [], "last_run_ts": None, "last_run": None}


def save_state(state: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
