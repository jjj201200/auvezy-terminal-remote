# CLI reference

[English](./CLI.md) · [简体中文](./CLI.zh-CN.md)

## Synopsis

```
atr [atr-flags...] [program] [program-args...]
atr <subcommand> [args]
```

`atr`'s own flags (`-p / --port`, `--name`, `--no-terminal`, etc.) are always
captured by `atr` regardless of position. Anything after a recognized program
that `atr` doesn't recognize is forwarded to the child process. Use `--` to
forcibly stop `atr`'s flag parsing and forward everything after it.

## Subcommands

Used in place of `[program]`:

| Subcommand | Description |
|---|---|
| `start` | Start the backend (default — implicit when no subcommand given) |
| `attach <url>` | Attach to a running instance from the command line |
| `list` | List all running instances on this machine |
| `stop [pattern]` | Stop running instances on this machine (optional name pattern) |

## Examples

```bash
atr                            # runs your $SHELL (auto-detects zsh / bash)
atr claude                     # runs claude
atr zsh                        # runs zsh
atr claude --resume foo        # passes unknown args through to claude
atr -p 3001 --name api claude  # atr's own flags + program + program-args coexist
atr claude -- --port 8080      # use `--` to disambiguate when program shares
                               # a flag name with atr (here --port goes to claude)
```

## Options

| Flag | Description |
|---|---|
| `-p, --port <n>` | Port (default 3000, auto-increments unless `-S`) |
| `-S, --strict-port` | Strict port mode: fail if port is taken, no fallback |
| `--spawn-timeout <s>` | PTY spawn fallback seconds (default 30; 0 = no timeout; first browser connect / Enter / timeout — whichever first) |
| `--wait-confirm` | Require Enter to spawn (overrides browser/timeout triggers) |
| `--name <s>` | Instance name (shown in webapp) |
| `--no-terminal` | Don't print QR code (CI / daemon-friendly) |
| `--command <cmd>` | PTY command (default: `claude`) |
| `--args <json>` | Command args (JSON array string) |
| `--workdir <path>` | Child process working directory (default: `process.cwd()`) |
| `--token <s>` | Specify token (default: auto-generated) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Environment variables

| Variable | Purpose |
|---|---|
| `OCR_COMMAND` | Child command (default `$SHELL`, or `/bin/sh`; set to `claude` to run Claude) |
| `OCR_ARGS` | Command args (JSON array string, e.g. `'["-c","tail -f /dev/null"]'`) |
| `OCR_CWD` | Child process working directory (default: `process.cwd()`) |
| `OCR_ANSI_FILTER` | Filter alt-screen output (default `false`). Set `true` for cleaner reconnect replay after vim/htop exits; full-time alt-screen TUIs (claude/tmux/...) are still protected by the built-in blocklist |
| `OCR_ANSI_FILTER_TUI_NAMES` | Append to your own alt-screen TUI blocklist (comma-separated), e.g. `"lazygit,k9s,gh-dash"` |
| `OCR_CORS_ALLOW` | Extend CORS allow list (comma-separated origins) |
| `OCR_SPAWN_TIMEOUT` | Same as `--spawn-timeout` (seconds; 0 = no timeout) |
| `PORT` | Same as `--port` |
| `STRICT_PORT` | Same as `--strict-port` (set `true` to enable strict mode) |
| `AUTH_TOKEN` | Specify token (default: auto-generated) |
| `LOG_LEVEL` | pino level (default `info`) |

## Configuration file

On startup the backend reads `~/.auvezy/terminal-remote/config.json`:

```json
{
  "token": "<64-char hex, auto-generated>",
  "shortcuts": [
    { "label": "ESC", "data": "" },
    { "label": "↑",   "data": "[A" }
  ],
  "command": null,
  "args": null,
  "rateLimitPerMinute": 10,
  "sessionTtlMs": 86400000
}
```

The multi-instance registry lives in `instances/<port>.json` next to it.
