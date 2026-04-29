# AGENTS.md

Guidance for coding agents working in this repo.

## Project

`ai-usage` is a small local CLI that reports Claude Code and Codex usage. It reads only local files:

- Claude Code: `~/.claude/projects/**/*.jsonl`
- Codex: `~/.codex/state_5.sqlite` and `~/.codex/sessions/**/*.jsonl`

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
- `usage.config.json` — user-editable caps and provider toggles.
- `.ai-usage-state.json` — runtime cache for live rate limits and `set` overrides. Do not commit.
- `display.md` — sample rendered output.

## Conventions

- No dependencies. Keep it that way unless asked.
- Pure ESM, Node built-ins only.
- Reads must be tolerant of partial writes (sessions are live) — wrap JSON parsing in try/catch and skip on failure.
- Live provider rate limits beat local token estimates; `set` overrides win only if newer than the live snapshot.
- Don't widen scope: this tool is read-only against user data and writes only to its own config/state files.

## Testing

There is no test suite. Validate changes by running `npm run check` and exercising the affected command (`now`, `statusline`, `watch`) against real local data.
