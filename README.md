# ai-usage

Small local usage tracker for Claude Code and Codex.

It reads local files only:

- Claude Code: `~/.claude/projects/**/*.jsonl`
- Codex: `~/.codex/state_5.sqlite` and `~/.codex/sessions/**/*.jsonl`

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

For estimated "left" percentages based on local token usage, set caps in
`usage.config.json`. Codex can also show the live rate-limit percentages that
the local Codex rollout logs include when they are present. `set` writes a local
calibration snapshot using left percentages; newer live provider data wins when
it is available.

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
