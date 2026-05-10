# CLI reference

[English](./CLI.md) · [简体中文](./CLI.zh-CN.md)

## Synopsis

```
atr [atr-flags...] [program] [program-args...]    # spawn a PTY (default)
atr <subcommand> [args]                           # manage broker / instances
```

**Strict argument order**: atr's own flags must come **before** `[program]`.
Once a program name is seen, every remaining token is passed through to the
child — atr no longer parses anything (no flag aliasing, no ambiguity).

Examples:

| Form | Meaning |
|---|---|
| `atr` | run default `$SHELL` |
| `atr claude` | run `claude` |
| `atr claude --resume foo` | extra args pass through to `claude` |
| `atr -p 3010 claude` | broker port = 3010, then run `claude` |
| `atr -p 3010 claude --port 9` | `-p 3010` → atr; `--port 9` → claude (passthrough) |
| `atr -- --weird` | `--` forces split; default shell with `--weird` |

## Subcommands

| Subcommand | Description |
|---|---|
| `start [--port n] [--host ip]` | Start the broker in the foreground (Ctrl+C to quit) |
| `stop` | Stop the broker (SIGTERM → 5s grace → SIGKILL) |
| `status` | One-shot view: process, token, entry URLs, instances |
| `list` | List all live instances |
| `logs` | Tail today's broker log (`~/.atr/broker-YYYY-MM-DD.log`) |
| `install` | Register autostart (systemd / launchd) |
| `uninstall` | Remove autostart (asks for confirmation) |
| `attach <url>` | Attach a CLI client to an existing instance |
| `kill <pattern \| all>` | Kill instances by substring match on name/cwd/host:port; `all` kills every running instance (with confirm) |
| `completion <zsh\|bash\|fish>` | Print shell completion script to stdout |

**Reserved words**: the subcommands above always take precedence at position 0.
To run a PATH binary with the same name (e.g. an executable called `start`),
use a path prefix: `atr ./start`, or place it after `--`: `atr -- start`.
In an interactive terminal, atr will prompt you to choose if a PATH binary
collides with a subcommand.

## Run flags (used with `atr [program]`)

| Flag | Description |
|---|---|
| `-p, --port <n>` | Broker port (default 3000). If broker is already running on a different port, atr will refuse to start — use `atr stop` then `atr -p <n>` to switch. Worker ports are auto-assigned and not user-tunable. |
| `--host <ip>` | Broker listen host (default `0.0.0.0`; workers always bind `127.0.0.1`) |
| `-S, --strict-port` | Strict-port mode: error out if preferred port is taken (no auto-bump) |
| `--spawn-timeout <s>` | PTY spawn fallback timeout in seconds (default 30; 0 = no timeout). Mutually exclusive with `--wait-confirm`. |
| `--token <hex>` | Use a fixed token (default: read / generate one in `~/.atrrc`) |
| `--workdir <path>` | Child process cwd (default: current directory) |
| `--instance-name <s>` | Instance display name (default: last segment of cwd) |
| `--config <path>` | Config file path (default: `~/.atrrc`) |
| `--max-buffer-lines` | Output buffer line cap (default 10000) |
| `--session-ttl <ms>` | Session TTL in ms (default 24h) |
| `--auth-rate-limit <n>` | Auth attempts per minute per IP (default 20) |
| `--log-dir <path>` | Override log directory |
| `--workdir-allow <patterns>` | cwd allow-list (picomatch glob, comma-separated). When set, new instance cwd must match at least one pattern. |
| `--workdir-deny <patterns>` | cwd deny-list (picomatch glob, comma-separated). Match means reject. Default includes sensitive system paths (`/etc/**`, `/root/**`, …); pass `""` to clear. CLI overrides `~/.atrrc`. |
| `--no-terminal` | Don't echo PTY output on this process's stdout |
| `--no-color` | Disable colored output |
| `--no-open` | Don't auto-open the browser |
| `--wait-confirm` | Wait for Enter before spawning the PTY child (default: spawn immediately) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |
| `--` | Explicit separator; tokens after `--` pass through to program |

## Environment variables

| Variable | Purpose |
|---|---|
| `ATR_BROKER_PORT` | Same as `--port` for the broker (used by systemd unit / launchd plist) |
| `ATR_BROKER_HOST` | Same as `--host` for the broker (default `0.0.0.0`) |
| `ATR_DEBUG_SPAWN` | Set to `1` to capture broker fork log to `/tmp/atr-broker-*.log` |
| `NO_COLOR` | Any non-empty value disables colored output (https://no-color.org/) |
| `FORCE_COLOR` | Any non-empty value forces color even when stdout is not a TTY |
| `LOG_LEVEL` | pino level (default `info`) |

## Files

| Path | Contents |
|---|---|
| `~/.atrrc` | Main config: token, user preferences, shortcuts, command snippets |
| `~/.atr/instances.json` | Live instance registry (broker + workers share it) |
| `~/.atr/broker.json` | Broker process state (pid / port / startedAt) |
| `~/.atr/broker-YYYY-MM-DD.log` | Broker daily log (kept for 7 days) |
| `~/.atr/sessions/` | Shared session files (cookie auth) |
| `~/.atr/vapid-keys.json` | Web Push VAPID keys |
| `~/.atr/push-subscriptions.json` | Subscribed push endpoints |

## Multi-instance model

The broker runs once on `0.0.0.0:3000` (auto-fork on first `atr <program>`,
or explicit `atr start`). Each `atr <program>` invocation forks a worker
that binds a high port on `127.0.0.1` only — the broker reverse-proxies
`/i/<id>/api/*` and `/i/<id>/ws` to the worker. Browsers always talk to the
broker; `/i/<id>/` identifies a single instance.

To switch broker port: `atr stop` then `atr -p <new>` (a new `atr <program>`
will auto-fork on the new port).

## Shell completion

Generate a completion script and source it / append to your shell rc:

```bash
# zsh
atr completion zsh >> ~/.zshrc

# bash
atr completion bash >> ~/.bashrc

# fish
atr completion fish > ~/.config/fish/completions/atr.fish
```

Provides subcommand and flag completion. `atr kill <Tab>` suggests `all`,
`atr completion <Tab>` suggests `zsh / bash / fish`.
