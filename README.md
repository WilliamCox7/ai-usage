# ai-usage

Small local usage tracker for Claude Code and Codex.

It surfaces the **server-reported** rate-limit percentages (the same numbers
each provider's CLI sees), not local token estimates. Each box shows how long
ago the snapshot was observed so you can tell when it's gone stale.

Sources (read-only):

- Claude Code: the `rate_limits` JSON the statusline hook pipes in on stdin,
  cached locally between runs.
- Codex: the latest `rate_limits` event in `~/.codex/sessions/**/*.jsonl`.

Run:

```sh
npm run now
npm run app
node bin/ai-usage.js now
node bin/ai-usage.js statusline
node bin/ai-usage.js watch
node bin/ai-usage.js set claude 99 98
node bin/ai-usage.js set codex 86 98
```

`npm run app` opens the minimal Electron desktop window. It polls the same local
tracker data every 5 seconds and has a manual refresh button.

`set` writes a manual override (left-percent for session and weekly) into the
local state cache — useful for filling in a number until the next live snapshot
arrives. Newer live data wins over older overrides.

To get fresh Claude numbers, point your statusline at this CLI — Claude Code
pipes its `rate_limits` payload over stdin every render, and the CLI caches it.

Claude statusline example:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/will/Documents/repositories/ai-usage/bin/ai-usage.js statusline --provider claude"
  }
}
```

Codex statusline-style command:

```sh
node /Users/will/Documents/repositories/ai-usage/bin/ai-usage.js statusline --provider codex
```
