# AGENTS.md

Guidance for coding agents working in this repo.

## Project

`ai-usage` is a small local CLI that reports Claude Code and Codex usage. It
displays only the server-reported `rate_limits` percentages — no local token
estimation. Sources:

- Claude Code: the `rate_limits` JSON piped over stdin by the statusline hook,
  cached in the local state file between runs.
- Codex: the latest `rate_limits` event in `~/.codex/sessions/**/*.jsonl`.

Single entry point: `bin/ai-usage.js` (Node >=20, ESM, no runtime deps).

## Commands

```sh
npm run check        # node --check on the CLI
npm run now          # default report
node bin/ai-usage.js now [--provider claude|codex] [--json]
node bin/ai-usage.js statusline [--provider claude|codex]
node bin/ai-usage.js watch [--interval seconds]
node bin/ai-usage.js set claude|codex <session-left%> <weekly-left%>
node bin/ai-usage.js paths
```

## Layout

- `bin/ai-usage.js` — entire CLI (commands, parsing, readers, formatting).
- `usage.config.json` — provider toggles and `~`-relative home paths.
- State cache (`~/Library/Application Support/ai-usage/state.json` on macOS,
  `~/.config/ai-usage/state.json` elsewhere) — runtime cache for the latest
  Claude statusline snapshot and `set` overrides.
- `display.md` — sample rendered output.

## Conventions

- No dependencies. Keep it that way unless asked.
- Pure ESM, Node built-ins only.
- Reads must be tolerant of partial writes (sessions are live) — wrap JSON parsing in try/catch and skip on failure.
- Server-reported `rate_limits` are the only displayed signal. Don't reintroduce token-cap estimation. `set` overrides win only if newer than the live snapshot.
- Don't widen scope: this tool is read-only against user data and writes only to its own config/state files.

## Testing

There is no test suite. Validate changes by running `npm run check` and exercising the affected command (`now`, `statusline`, `watch`) against real local data.
