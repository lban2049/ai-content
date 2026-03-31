#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const runtimeRoot = path.join(repoRoot, ".runtime", "x-following-filter");
const stateDir = path.join(runtimeRoot, "state");
const logDir = path.join(runtimeRoot, "logs");
const rawDir = path.join(runtimeRoot, "raw");
const queueDir = path.join(runtimeRoot, "queue");
const selectedPostsDir = path.join(repoRoot, "selected-posts");
const stateFile = path.join(stateDir, "schedule.json");
const lockFile = path.join(stateDir, "runner.lock");
const promptFile = path.join(repoRoot, "scripts", "prompts", "x-following-filter.txt");
const selectedPostsPromptFile = path.join(
  repoRoot,
  "scripts",
  "prompts",
  "x-following-selected-posts.txt",
);
const nodeBin = "/Users/lban/.nvm/versions/node/v22.14.0/bin/node";
const codexEntry =
  "/Users/lban/.nvm/versions/node/v22.14.0/lib/node_modules/@openai/codex/bin/codex.js";
const claudeBin = "/Users/lban/.local/bin/claude";
const opencliEntry =
  "/Users/lban/.nvm/versions/node/v22.14.0/lib/node_modules/@jackwener/opencli/dist/main.js";
const timezone = "Asia/Shanghai";
const codexTimeoutMs = 8 * 60 * 1000;
const claudeTimeoutMs = 8 * 60 * 1000;
const opencliTimeoutMs = 60 * 1000;
const bridgeMissingRetryMinutes = 60;

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const dryRun = args.has("--dry-run");
const backend = args.has("--claude") ? "claude" : "codex";

const ACTIVE_WINDOW = {
  startMinutes: 8 * 60 + 30,
  endMinutes: 23 * 60 + 30,
  minDelayMinutes: 22,
  maxDelayMinutes: 38,
};

const QUIET_WINDOW = {
  minDelayMinutes: 90,
  maxDelayMinutes: 150,
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowInTimezone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function minutesSinceMidnight(parts) {
  return parts.hour * 60 + parts.minute;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function computeNextDelayMinutes(now = new Date()) {
  const local = nowInTimezone(now);
  const minutes = minutesSinceMidnight(local);
  const isActive =
    minutes >= ACTIVE_WINDOW.startMinutes && minutes < ACTIVE_WINDOW.endMinutes;

  if (isActive) {
    return randomInt(ACTIVE_WINDOW.minDelayMinutes, ACTIVE_WINDOW.maxDelayMinutes);
  }

  return randomInt(QUIET_WINDOW.minDelayMinutes, QUIET_WINDOW.maxDelayMinutes);
}

function detectOpencliCaptureFailure(capture) {
  const parts = [
    capture?.result?.stdout ?? "",
    capture?.result?.stderr ?? "",
    capture?.parseError ?? "",
  ]
    .join("\n")
    .toLowerCase();

  if (
    parts.includes("browser bridge not connected") ||
    parts.includes("extension is not connected") ||
    parts.includes("extension ✗ not connected") ||
    parts.includes("please install and enable the opencli browser bridge extension")
  ) {
    return {
      status: "failed_bridge_disconnected",
      retryMinutes: bridgeMissingRetryMinutes,
      message: "opencli browser bridge not connected",
    };
  }

  return {
    status: "failed_capture",
    retryMinutes: computeNextDelayMinutes(new Date()),
    message: "timeline capture failed",
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath, items) {
  const lines = items.map((item) => JSON.stringify(item));
  fs.writeFileSync(filePath, `${lines.join("\n")}${lines.length ? "\n" : ""}`, "utf8");
}

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(path.join(logDir, "runner.log"), line, "utf8");
}

function processAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  const existing = readJson(lockFile, null);
  if (existing?.pid && processAlive(existing.pid)) {
    appendLog(`skip: lock held by pid=${existing.pid}`);
    process.stdout.write(`skip: lock held by pid=${existing.pid}\n`);
    process.exit(0);
  }

  writeJson(lockFile, {
    pid: process.pid,
    acquired_at: new Date().toISOString(),
  });
}

function releaseLock() {
  try {
    const existing = readJson(lockFile, null);
    if (existing?.pid === process.pid) {
      fs.unlinkSync(lockFile);
    }
  } catch {}
}

function isoAfterMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function loadPrompt() {
  return fs.readFileSync(promptFile, "utf8").trim();
}

function loadSelectedPostsPrompt() {
  return fs.readFileSync(selectedPostsPromptFile, "utf8").trim();
}

function commandFailed(result) {
  return Boolean(result?.error) || Boolean(result?.signal) || result?.status !== 0;
}

function rawCapturePath(date = new Date()) {
  const parts = nowInTimezone(date);
  const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const dayDir = path.join(rawDir, day);
  ensureDir(dayDir);
  return path.join(dayDir, `timeline-${stamp}.json`);
}

function captureTimeline() {
  const result = spawnSync(
    nodeBin,
    [opencliEntry, "twitter", "timeline", "--type", "following", "--limit", "40", "-f", "json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: opencliTimeoutMs,
    },
  );

  if (commandFailed(result) || !result.stdout) {
    return { ok: false, result };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) {
      return { ok: false, result, parseError: "timeline JSON is not an array" };
    }

    const filePath = rawCapturePath();
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    return { ok: true, result, parsed, filePath };
  } catch (error) {
    return {
      ok: false,
      result,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function readJsonl(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) {
      return [];
    }

    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function dueRechecks(now = new Date()) {
  const recheckFile = path.join(queueDir, "recheck.jsonl");
  const items = readJsonl(recheckFile);
  return items.filter((item) => item.recheck_at && new Date(item.recheck_at) <= now);
}

function captureThread(tweetId) {
  return spawnSync(
    nodeBin,
    [opencliEntry, "twitter", "thread", String(tweetId), "-f", "json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: opencliTimeoutMs,
    },
  );
}

function captureDueRechecks(entries) {
  if (!entries.length) {
    return null;
  }

  const manifest = [];
  for (const entry of entries) {
    const result = captureThread(entry.tweet_id);
    if (result.status !== 0 || !result.stdout) {
      appendLog(`recheck capture failed for ${entry.tweet_id}`);
      continue;
    }

    try {
      const parsed = JSON.parse(result.stdout);
      const filePath = rawCapturePath().replace("timeline-", `recheck-${entry.tweet_id}-`);
      fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      manifest.push({
        tweet_id: entry.tweet_id,
        recheck_at: entry.recheck_at,
        file_path: filePath,
      });
    } catch (error) {
      appendLog(
        `recheck parse failed for ${entry.tweet_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!manifest.length) {
    return null;
  }

  const manifestPath = rawCapturePath().replace("timeline-", "recheck-manifest-");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function runCodexPrompt(prompt) {
  return spawnSync(
    nodeBin,
    [
      codexEntry,
      "exec",
      "-C",
      repoRoot,
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      prompt,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: codexTimeoutMs,
    },
  );
}

function runClaudePrompt(prompt) {
  return spawnSync(
    claudeBin,
    [
      "-p",
      "--dangerously-skip-permissions",
      "--no-chrome",
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep,Bash",
    ],
    {
      input: prompt,
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: claudeTimeoutMs,
    },
  );
}

function runPrompt(prompt) {
  return backend === "claude" ? runClaudePrompt(prompt) : runCodexPrompt(prompt);
}

function runCodexOnce(captureFilePath) {
  const prompt = `${loadPrompt()}\n\n本轮原始抓取文件：\`${captureFilePath}\`\n\n要求补充：\n- 直接读取这份原始 JSON，作为本轮唯一 timeline 输入源\n- 本轮不要再调用 opencli 获取 timeline\n- 本轮不要处理 recheck 队列\n- 如果这份 JSON 为空数组，按“本轮无新内容”处理并正常结束`;
  return runPrompt(prompt);
}

function evaluateDueRechecks(recheckManifestPath) {
  if (!recheckManifestPath) {
    return null;
  }

  const manifest = readJson(recheckManifestPath, []);
  if (!Array.isArray(manifest) || !manifest.length) {
    return null;
  }

  const candidatesFile = path.join(queueDir, "candidates.jsonl");
  const recheckFile = path.join(queueDir, "recheck.jsonl");
  const candidates = readJsonl(candidatesFile);
  const pending = readJsonl(recheckFile);
  const candidateById = new Map(candidates.map((item) => [String(item.tweet_id), item]));
  const dueIds = new Set(manifest.map((item) => String(item.tweet_id)));
  const readyItems = [];

  for (const item of manifest) {
    const thread = readJson(item.file_path, []);
    if (!Array.isArray(thread) || !thread.length) {
      continue;
    }

    const root =
      thread.find((entry) => String(entry.id) === String(item.tweet_id)) ?? thread[0];
    const candidate = candidateById.get(String(item.tweet_id));
    if (!candidate) {
      continue;
    }

    const replies = Math.max(
      0,
      thread.filter((entry) => String(entry.in_reply_to ?? "") === String(item.tweet_id)).length,
    );
    const likes = Number(root.likes ?? candidate.likes ?? 0);
    const retweets = Number(root.retweets ?? candidate.retweets ?? 0);
    const views = Number(candidate.views ?? 0);
    const qualityScore = Number(candidate.quality_score ?? 0);
    const interactionScore = likes + 3 * retweets + 2 * replies;
    const passed =
      qualityScore >= 4.5 ||
      interactionScore >= 20 ||
      (views >= 500 && qualityScore >= 4);

    const updatedCandidate = {
      ...candidate,
      likes,
      retweets,
      replies,
      approved_at: passed ? new Date().toISOString() : null,
      status: passed ? "approved_for_selected_posts" : "dropped_after_recheck",
    };

    candidateById.set(String(item.tweet_id), updatedCandidate);

    if (passed) {
      readyItems.push({
        tweet_id: candidate.tweet_id,
        url: candidate.url,
        author: candidate.author,
        text: candidate.text,
        created_at: candidate.created_at,
        quality_score: qualityScore,
        quality_reason: candidate.quality_reason,
        likes,
        retweets,
        replies,
        views,
        interaction_score: interactionScore,
        needs_manual_check: Boolean(candidate.needs_manual_check),
      });
    }
  }

  const remainingRechecks = pending.filter((item) => !dueIds.has(String(item.tweet_id)));
  writeJsonl(candidatesFile, Array.from(candidateById.values()));
  writeJsonl(recheckFile, remainingRechecks);

  if (!readyItems.length) {
    return null;
  }

  const readyPath = rawCapturePath().replace("timeline-", "selected-ready-");
  fs.writeFileSync(readyPath, `${JSON.stringify(readyItems, null, 2)}\n`, "utf8");
  return readyPath;
}

function runSelectedPostsCodex(readyPath) {
  if (!readyPath) {
    return null;
  }

  const prompt = `${loadSelectedPostsPrompt()}\n\n本轮通过第二轮过滤的帖子文件：\`${readyPath}\`\n\n要求补充：\n- 直接读取这份 JSON\n- 不要调用 opencli\n- 将通过项追加写入 \`selected-posts/YYYY-MM-DD.md\`\n- 必须包含：链接、原文、英文帖子的中文翻译、AI 总结、人工复核`;
  return runPrompt(prompt);
}

ensureDir(stateDir);
ensureDir(logDir);
ensureDir(rawDir);
ensureDir(queueDir);
ensureDir(selectedPostsDir);
acquireLock();
process.on("exit", releaseLock);
process.on("SIGINT", () => {
  releaseLock();
  process.exit(130);
});
process.on("SIGTERM", () => {
  releaseLock();
  process.exit(143);
});

const defaultState = {
  timezone,
  next_run_at: null,
  last_run_at: null,
  last_status: "idle",
  consecutive_failures: 0,
};

const state = readJson(stateFile, defaultState);
const now = new Date();

if (!force && state.next_run_at) {
  const nextRun = new Date(state.next_run_at);
  if (Number.isFinite(nextRun.getTime()) && now < nextRun) {
    appendLog(`skip: not due yet, next_run_at=${state.next_run_at}`);
    process.stdout.write(`skip: next run at ${state.next_run_at}\n`);
    process.exit(0);
  }
}

if (dryRun) {
  const delay = computeNextDelayMinutes(now);
  const nextRunAt = isoAfterMinutes(now, delay);
  const nextState = {
    ...state,
    next_run_at: nextRunAt,
    last_status: "dry_run",
  };
  writeJson(stateFile, nextState);
  appendLog(`dry-run: scheduled next_run_at=${nextRunAt}`);
  process.stdout.write(
    JSON.stringify(
      {
        mode: "dry-run",
        now: now.toISOString(),
        next_run_at: nextRunAt,
        timezone,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

appendLog(`run: backend=${backend}`);
appendLog("run: capturing timeline via opencli");
const capture = captureTimeline();

if (!capture.ok) {
  const failure = detectOpencliCaptureFailure(capture);
  const nextRunAt = isoAfterMinutes(new Date(), failure.retryMinutes);
  const nextState = {
    ...state,
    last_run_at: now.toISOString(),
    next_run_at: nextRunAt,
    last_status: failure.status,
    consecutive_failures: (state.consecutive_failures ?? 0) + 1,
  };

  writeJson(stateFile, nextState);
  appendLog(`capture failure classified as ${failure.status}`);
  if (capture.result?.stderr) {
    appendLog(`opencli stderr: ${capture.result.stderr.trim().slice(0, 500)}`);
  }
  if (capture.result?.stdout) {
    appendLog(`opencli stdout: ${capture.result.stdout.trim().slice(0, 500)}`);
  }
  if (capture.parseError) {
    appendLog(`opencli parse error: ${capture.parseError}`);
  }
  process.stderr.write(`${failure.message}\n`);
  process.exit(1);
}

appendLog(`run: timeline captured to ${capture.filePath}`);
const recheckManifestPath = captureDueRechecks(dueRechecks());
if (recheckManifestPath) {
  appendLog(`run: due rechecks captured to ${recheckManifestPath}`);
}
appendLog(`run: invoking ${backend} for filtering`);
const result = runCodexOnce(capture.filePath);
const delay = computeNextDelayMinutes(new Date());
const nextRunAt = isoAfterMinutes(new Date(), delay);
const codexFailed = commandFailed(result);

const nextState = {
  ...state,
  last_run_at: now.toISOString(),
  next_run_at: nextRunAt,
  last_status:
    result.error?.code === "ETIMEDOUT"
      ? `failed_${backend}_timeout`
      : codexFailed
        ? "failed"
        : "success",
  last_backend: backend,
  consecutive_failures: codexFailed ? (state.consecutive_failures ?? 0) + 1 : 0,
};

writeJson(stateFile, nextState);

if (result.stdout) {
  appendLog(`${backend} stdout: ${result.stdout.trim().slice(0, 500)}`);
}

if (result.stderr) {
  appendLog(`${backend} stderr: ${result.stderr.trim().slice(0, 500)}`);
}

if (result.error) {
  appendLog(`${backend} spawn error: ${result.error.message}`);
}

if (result.signal) {
  appendLog(`${backend} terminated by signal: ${result.signal}`);
}

if (codexFailed) {
  appendLog(`run failed: exit_code=${result.status}, next_run_at=${nextRunAt}`);
  process.stderr.write(result.stderr || `${backend} exec failed with code ${result.status}\n`);
  process.exit(result.status ?? 1);
}

const readyPath = evaluateDueRechecks(recheckManifestPath);
if (readyPath) {
  appendLog(`run: ready selected-posts payload at ${readyPath}`);
  const selectedPostsResult = runSelectedPostsCodex(readyPath);

  if (selectedPostsResult?.stdout) {
    appendLog(`selected-posts stdout: ${selectedPostsResult.stdout.trim().slice(0, 500)}`);
  }
  if (selectedPostsResult?.stderr) {
    appendLog(`selected-posts stderr: ${selectedPostsResult.stderr.trim().slice(0, 500)}`);
  }
  if (selectedPostsResult?.error) {
    appendLog(`selected-posts spawn error: ${selectedPostsResult.error.message}`);
  }
  if (selectedPostsResult?.signal) {
    appendLog(`selected-posts terminated by signal: ${selectedPostsResult.signal}`);
  }
  if (selectedPostsResult && commandFailed(selectedPostsResult)) {
    appendLog(`selected-posts failed: exit_code=${selectedPostsResult.status}`);
    process.stderr.write(
      selectedPostsResult.stderr ||
        `selected-posts codex exec failed with code ${selectedPostsResult.status}\n`,
    );
    process.exit(selectedPostsResult.status ?? 1);
  }
}

appendLog(`run success: next_run_at=${nextRunAt}`);
process.stdout.write(result.stdout || "");
