#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "usage.config.json");
const STATE_DIR = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "ai-usage")
  : path.join(os.homedir(), ".config", "ai-usage");
const STATE_PATH = path.join(STATE_DIR, "state.json");
const DEFAULT_CONFIG = {
  sessionWindowHours: 5,
  weekStartsOn: "monday",
  providers: {
    claude: {
      enabled: true,
      home: "~/.claude",
      sessionTokenCap: 0,
      weeklyTokenCap: 0,
    },
    codex: {
      enabled: true,
      home: "~/.codex",
      sessionTokenCap: 0,
      weeklyTokenCap: 0,
    },
  },
};
const COLORS = {
  reset: "\x1b[0m",
  claude: "\x1b[38;5;208m",
  codex: "\x1b[34m",
};
const BOX_WIDTH = 69;
const BAR_WIDTH = 25;
const INNER_WIDTH = BOX_WIDTH - 2;

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "now";

  if (command === "set") {
    setProviderLimits(args.slice(1));
    return;
  }

  const options = parseOptions(args.slice(1));
  const config = loadConfig();

  if (command === "now") {
    printNow(config, options, loadRuntimeContext());
    return;
  }

  if (command === "statusline") {
    printStatusline(config, options, loadRuntimeContext());
    return;
  }

  if (command === "watch") {
    watch(config, options);
    return;
  }

  if (command === "paths") {
    printPaths(config);
    return;
  }

  usage(1);
}

function parseOptions(args) {
  const options = {
    provider: "all",
    json: false,
    interval: 30,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--provider") {
      options.provider = args[index + 1] || "all";
      index += 1;
    } else if (arg === "--interval") {
      options.interval = Number(args[index + 1] || 30);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function usage(exitCode) {
  const text = [
    "Usage:",
    "  ai-usage now [--provider claude|codex] [--json]",
    "  ai-usage statusline [--provider claude|codex]",
    "  ai-usage set claude|codex <session-left-percent> <weekly-left-percent>",
    "  ai-usage watch [--interval seconds]",
    "  ai-usage paths",
  ].join("\n");
  console.log(text);
  process.exit(exitCode);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return merge(DEFAULT_CONFIG, userConfig);
}

function loadRuntimeContext() {
  const cached = readJsonFile(STATE_PATH) || {};
  const stdin = readStdinJson();
  const claudeRateLimits = parseClaudeRateLimits(stdin);

  if (claudeRateLimits) {
    const next = {
      ...cached,
      claudeRateLimits: mergeRateLimitSnapshot(cached.claudeRateLimits, {
        observedAt: new Date().toISOString(),
        ...claudeRateLimits,
      }),
    };
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    } catch {
      // The tracker still works without cache writes.
    }
    return next;
  }

  return cached;
}

function mergeRateLimitSnapshot(previous, next) {
  return {
    observedAt:
      next.observedAt || previous?.observedAt || new Date().toISOString(),
    session: next.session || previous?.session || null,
    weekly: next.weekly || previous?.weekly || null,
  };
}

function setProviderLimits(args) {
  const [provider, sessionLeft, weeklyLeft] = args;
  if (
    !["claude", "codex"].includes(provider) ||
    sessionLeft == null ||
    weeklyLeft == null
  ) {
    usage(1);
  }

  const session = Number(sessionLeft);
  const weekly = Number(weeklyLeft);
  if (Number.isNaN(session) || Number.isNaN(weekly)) {
    throw new Error("Percent values must be numbers.");
  }

  const state = readJsonFile(STATE_PATH) || {};
  state.overrides ||= {};
  state.overrides[provider] = {
    observedAt: new Date().toISOString(),
    session: percentFromLeft(session),
    weekly: percentFromLeft(weekly),
  };

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  console.log(
    `${provider}: session ${formatNumber(session)}% left, weekly ${formatNumber(weekly)}% left`,
  );
}

function percentFromLeft(leftPercent) {
  const left = clamp(leftPercent, 0, 100);
  return {
    usedPercent: clamp(100 - left, 0, 100),
    leftPercent: left,
  };
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readStdinJson() {
  if (process.stdin.isTTY) return null;

  try {
    const input = fs.readFileSync(0, "utf8").trim();
    return input ? JSON.parse(input) : null;
  } catch {
    return null;
  }
}

function parseClaudeRateLimits(input) {
  const limits = input?.rate_limits;
  if (!limits) return null;

  const session = normalizeClaudeLimit(
    limits.five_hour || limits.session || limits.primary,
  );
  const weekly = normalizeClaudeLimit(limits.weekly || limits.secondary);
  if (!session && !weekly) return null;

  return { session, weekly };
}

function normalizeClaudeLimit(limit) {
  if (!limit) return null;

  const used = firstNumber(
    limit.used_percentage,
    limit.used_percent,
    limit.percent_used,
    limit.usage_percentage,
  );
  if (used == null) return null;

  return {
    usedPercent: used,
    leftPercent: clamp(100 - used, 0, 100),
    resetsAt: normalizeResetTime(
      limit.resets_at || limit.reset_at || limit.reset_time,
    ),
  };
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (!Number.isNaN(number)) return number;
  }
  return null;
}

function normalizeResetTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return new Date(
      value > 10_000_000_000 ? value : value * 1000,
    ).toISOString();
  }

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) {
    return normalizeResetTime(asNumber);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function merge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = merge(base[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function printNow(config, options, runtime) {
  const report = buildReport(config, runtime);
  const filtered = filterProviders(report, options.provider);

  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.providers.length > 0) {
    console.log("");
  }

  filtered.providers.forEach((provider, index) => {
    if (index > 0) console.log("");
    printProvider(provider);
  });
  console.log("");
}

function printStatusline(config, options, runtime) {
  const report = buildReport(config, runtime);
  const providers = filterProviders(report, options.provider).providers;
  const parts = providers.map((provider) => {
    const session = preferredPercent(provider, "session");
    const weekly = preferredPercent(provider, "weekly");
    return `${provider.label} S:${formatLeft(session)} W:${formatLeft(weekly)}`;
  });
  console.log(parts.join(" | "));
}

function watch(config, options) {
  const intervalMs = Math.max(1, options.interval) * 1000;
  let initialized = false;
  const render = () => {
    if (initialized) {
      process.stdout.write("\x1b[H");
    } else {
      process.stdout.write("\x1b[?25l");
      initialized = true;
    }
    printNow(config, options, loadRuntimeContext());
  };

  process.on("SIGINT", () => {
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  });
  process.on("exit", () => {
    process.stdout.write("\x1b[?25h");
  });

  render();
  setInterval(render, intervalMs);
}

function printPaths(config) {
  for (const provider of ["claude", "codex"]) {
    const providerConfig = config.providers[provider];
    console.log(`${provider}: ${expandHome(providerConfig.home)}`);
  }
}

function buildReport(config, runtime) {
  const now = new Date();
  const sessionStart = new Date(
    now.getTime() - config.sessionWindowHours * 60 * 60 * 1000,
  );
  const weekStart = startOfWeek(now, config.weekStartsOn);

  const providers = [];
  if (config.providers.codex.enabled) {
    providers.push(readCodex(config.providers.codex, sessionStart, weekStart));
  }
  if (config.providers.claude.enabled) {
    providers.push(
      readClaude(
        config.providers.claude,
        sessionStart,
        weekStart,
        runtime?.claudeRateLimits,
      ),
    );
  }

  applyOverrides(providers, runtime?.overrides);

  return {
    generatedAt: now.toISOString(),
    windows: {
      sessionStart: sessionStart.toISOString(),
      weekStart: weekStart.toISOString(),
    },
    providers,
  };
}

function applyOverrides(providers, overrides) {
  if (!overrides) return;

  for (const provider of providers) {
    const override = overrides[provider.id];
    if (!override) continue;

    provider.rateLimits ||= {};
    const liveObservedAt = provider.rateLimits.observedAt;
    let applied = false;
    if (
      shouldApplyOverrideLimit(
        provider.rateLimits.session,
        liveObservedAt,
        override.observedAt,
      )
    ) {
      provider.rateLimits.session = mergeLimit(
        provider.rateLimits.session,
        override.session,
      );
      applied = true;
    }
    if (
      shouldApplyOverrideLimit(
        provider.rateLimits.weekly,
        liveObservedAt,
        override.observedAt,
      )
    ) {
      provider.rateLimits.weekly = mergeLimit(
        provider.rateLimits.weekly,
        override.weekly,
      );
      applied = true;
    }
    if (applied && !provider.rateLimits.observedAt) {
      provider.rateLimits.observedAt =
        override.observedAt || new Date().toISOString();
    }
  }
}

function shouldApplyOverrideLimit(
  liveLimit,
  liveObservedAt,
  overrideObservedAt,
) {
  if (!liveLimit) return true;
  if (!liveObservedAt) return true;
  if (!overrideObservedAt) return true;

  const liveTime = new Date(liveObservedAt).getTime();
  const overrideTime = new Date(overrideObservedAt).getTime();
  if (Number.isNaN(liveTime) || Number.isNaN(overrideTime)) return true;
  return overrideTime >= liveTime;
}

function mergeLimit(base, override) {
  if (!override) return base || null;
  return {
    ...(base || {}),
    ...override,
  };
}

function filterProviders(report, providerName) {
  if (!providerName || providerName === "all") {
    return report;
  }

  return {
    ...report,
    providers: report.providers.filter(
      (provider) => provider.id === providerName,
    ),
  };
}

function readClaude(config, sessionStart, weekStart, liveRateLimits) {
  const home = expandHome(config.home);
  const files = listFiles(path.join(home, "projects"), ".jsonl", weekStart);
  const usage = emptyUsage("claude", "Claude");

  for (const file of files) {
    readJsonLines(file, (event) => {
      const timestamp = parseTimestamp(event.timestamp);
      if (!timestamp || timestamp < weekStart) return;

      const tokens = claudeTokens(event);
      const type = event.type || event.message?.role || "event";
      const sessionId =
        event.sessionId || event.session_id || event.sessionID || file;
      addEvent(usage.weekly, timestamp, tokens, type, sessionId);
      if (timestamp >= sessionStart) {
        addEvent(usage.session, timestamp, tokens, type, sessionId);
      }
    });
  }

  applyCaps(usage, config);
  if (liveRateLimits) {
    usage.rateLimits = liveRateLimits;
  }
  return usage;
}

function readCodex(config, sessionStart, weekStart) {
  const home = expandHome(config.home);
  const usage = emptyUsage("codex", "Codex");

  for (const thread of readCodexThreads(path.join(home, "state_5.sqlite"))) {
    const updatedAt = new Date(thread.updatedAt * 1000);
    if (updatedAt < weekStart) continue;

    addEvent(usage.weekly, updatedAt, thread.tokensUsed, "thread", thread.id);
    if (updatedAt >= sessionStart) {
      addEvent(
        usage.session,
        updatedAt,
        thread.tokensUsed,
        "thread",
        thread.id,
      );
    }
  }

  usage.rateLimits = readCodexRateLimits(path.join(home, "sessions"));
  applyCaps(usage, config);
  return usage;
}

function readCodexThreads(dbPath) {
  if (!fs.existsSync(dbPath)) return [];

  try {
    const output = execFileSync(
      "sqlite3",
      [
        "-json",
        dbPath,
        "select id, updated_at as updatedAt, tokens_used as tokensUsed from threads where tokens_used > 0",
      ],
      { encoding: "utf8" },
    );
    return JSON.parse(output || "[]").map((row) => ({
      id: String(row.id),
      updatedAt: Number(row.updatedAt || 0),
      tokensUsed: Number(row.tokensUsed || 0),
    }));
  } catch {
    return [];
  }
}

function readCodexRateLimits(sessionsDir) {
  const files = listFiles(
    sessionsDir,
    ".jsonl",
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );
  let latest = null;

  for (const file of files) {
    readJsonLines(file, (event) => {
      const timestamp = parseTimestamp(event.timestamp);
      const rateLimits = event.payload?.rate_limits || event.rate_limits;
      if (!timestamp || !rateLimits) return;
      if (!latest || timestamp > latest.timestamp) {
        latest = { timestamp, rateLimits };
      }
    });
  }

  if (!latest) return null;

  return {
    observedAt: latest.timestamp.toISOString(),
    session: normalizeCodexLimit(latest.rateLimits.primary),
    weekly: normalizeCodexLimit(latest.rateLimits.secondary),
    planType: latest.rateLimits.plan_type || null,
    reached: latest.rateLimits.rate_limit_reached_type || null,
  };
}

function normalizeCodexLimit(limit) {
  if (!limit) return null;
  return {
    usedPercent: Number(limit.used_percent || 0),
    leftPercent: Math.max(0, 100 - Number(limit.used_percent || 0)),
    windowMinutes: Number(limit.window_minutes || 0),
    resetsAt: limit.resets_at
      ? new Date(Number(limit.resets_at) * 1000).toISOString()
      : null,
  };
}

function emptyUsage(id, label) {
  return {
    id,
    label,
    session: emptyWindow(),
    weekly: emptyWindow(),
    rateLimits: null,
  };
}

function emptyWindow() {
  return {
    tokens: 0,
    events: 0,
    userTurns: 0,
    assistantTurns: 0,
    sessions: 0,
    lastSeenAt: null,
    cap: 0,
    usedPercent: null,
    leftPercent: null,
  };
}

function addEvent(bucket, timestamp, tokens, type, sessionId) {
  bucket.tokens += tokens;
  bucket.events += 1;
  if (type === "user") bucket.userTurns += 1;
  if (type === "assistant") bucket.assistantTurns += 1;
  bucket._sessions ||= new Set();
  bucket._sessions.add(sessionId);
  if (!bucket.lastSeenAt || timestamp > new Date(bucket.lastSeenAt)) {
    bucket.lastSeenAt = timestamp.toISOString();
  }
}

function applyCaps(usage, config) {
  finishWindow(usage.session, Number(config.sessionTokenCap || 0));
  finishWindow(usage.weekly, Number(config.weeklyTokenCap || 0));
}

function finishWindow(bucket, cap) {
  bucket.cap = cap;
  bucket.sessions = bucket._sessions ? bucket._sessions.size : 0;
  delete bucket._sessions;

  if (cap > 0) {
    bucket.usedPercent = clamp((bucket.tokens / cap) * 100, 0, 999);
    bucket.leftPercent = clamp(100 - bucket.usedPercent, 0, 100);
  }
}

function claudeTokens(event) {
  const usage = event.message?.usage;
  if (!usage) return 0;

  return [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
  ].reduce((sum, value) => sum + Number(value || 0), 0);
}

function printProvider(provider) {
  const rows = [
    buildDisplayRow(
      "Session",
      provider.session,
      provider.rateLimits?.session || null,
    ),
    buildDisplayRow(
      "Weekly",
      provider.weekly,
      provider.rateLimits?.weekly || null,
    ),
  ];

  console.log(formatBox(provider, rows));
}

function buildDisplayRow(label, bucket, liveLimit) {
  const percent = liveLimit || bucket;
  return {
    label,
    left: formatLeftOrActivity(percent, bucket),
    progress: progressBar(percent?.usedPercent),
    reset: liveLimit?.resetsAt
      ? `resets ${formatRelativeReset(liveLimit.resetsAt)}`
      : "",
  };
}

function formatLeftOrActivity(percent, bucket) {
  if (percent?.leftPercent != null) {
    return `${formatNumber(percent.leftPercent)}% left`;
  }

  return "100% left";
}

function formatBox(provider, rows) {
  const title = ` ${provider.label} `;
  const topRightWidth = BOX_WIDTH - visibleLength(title) - 1;
  const top = `╭─${title}${"─".repeat(topRightWidth)}╮`;
  const body = rows.map((row) => formatBoxRow(provider.id, row)).join("\n");
  const bottom = `╰${"─".repeat(BOX_WIDTH)}╯`;
  return `${top}\n${body}\n${bottom}`;
}

function formatBoxRow(providerId, row) {
  const left = `${row.label.padEnd(7)}  ${row.left.padEnd(9)}  `;
  const bar = colorizeProgress(providerId, row.progress);
  const right = `  ${row.reset}`;
  const plain = `${left}${row.progress}${right}`;
  const padding = Math.max(0, INNER_WIDTH - visibleLength(plain));
  return `│ ${left}${bar}${right}${" ".repeat(padding)} │`;
}

function progressBar(usedPercent) {
  if (usedPercent == null) return `[${"-".repeat(BAR_WIDTH)}]`;

  const filled = Math.round((clamp(usedPercent, 0, 100) / 100) * BAR_WIDTH);
  return `[${"=".repeat(filled)}${"-".repeat(BAR_WIDTH - filled)}]`;
}

function colorizeProgress(providerId, bar) {
  const color = COLORS[providerId];
  if (
    !color ||
    process.env.NO_COLOR ||
    (!process.stdout.isTTY && !process.env.FORCE_COLOR)
  ) {
    return bar;
  }

  const match = bar.match(/^(\[)(=*)(-*)(\])$/);
  if (!match) return bar;
  const [, open, filled, empty, close] = match;
  return `${open}${color}${filled}${COLORS.reset}${empty}${close}`;
}

function preferredPercent(provider, windowName) {
  return provider.rateLimits?.[windowName] || provider[windowName];
}

function formatLeft(source) {
  if (!source || source.leftPercent == null) return "100% left";
  return `${formatNumber(source.leftPercent)}% left`;
}

function formatNumber(value) {
  return Number(value).toFixed(value >= 10 ? 0 : 1);
}

function formatTime(iso) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelativeReset(iso) {
  const reset = new Date(iso);
  const now = new Date();
  const diffMs = reset.getTime() - now.getTime();
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
    const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `in ${hours}h ${minutes}m`;
    return `in ${minutes}m`;
  }

  return reset
    .toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(":00 ", "");
}

function visibleLength(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function startOfWeek(date, weekStartsOn) {
  const output = new Date(date);
  output.setHours(0, 0, 0, 0);
  const desired = weekStartsOn.toLowerCase() === "sunday" ? 0 : 1;
  const diff = (output.getDay() - desired + 7) % 7;
  output.setDate(output.getDate() - diff);
  return output;
}

function parseTimestamp(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return new Date(value > 10_000_000_000 ? value : value * 1000);
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function listFiles(root, extension, modifiedSince) {
  if (!fs.existsSync(root)) return [];

  const output = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(extension)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (!modifiedSince || stat.mtime >= modifiedSince) {
          output.push(fullPath);
        }
      } catch {
        // Ignore files that disappear during a CLI run.
      }
    }
  }

  return output;
}

function readJsonLines(file, visit) {
  let data = "";
  try {
    data = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      visit(JSON.parse(line));
    } catch {
      // Local CLI logs can contain partial writes while an agent is active.
    }
  }
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

main();
