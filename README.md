<div align="center">

<img src="./frontend/public/icons/atr-icon.svg" alt="auvezy-terminal-remote logo" width="96" height="96">

# auvezy-terminal-remote

[![npm](https://img.shields.io/npm/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://www.npmjs.com/package/auvezy-terminal-remote)
[![license](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-b6f09c?style=flat-square&labelColor=0a0c0f)](./LICENSE)
[![node](https://img.shields.io/node/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://nodejs.org)
[![stars](https://img.shields.io/github/stars/jjj201200/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://github.com/jjj201200/auvezy-terminal-remote)

**English** · [简体中文](./README.zh-CN.md)

Remote-control any terminal program on your PC from a phone or tablet
browser over LAN. Start a broker once at boot — open the browser any
time to log in, create instances, and run Claude / your shell / any TUI.

<img src="./frontend/public/screenshots/desktop.png" alt="Webapp running Claude Code in a browser tab" width="960">

<img src="./frontend/public/screenshots/mobile.png" alt="Webapp on a phone screen" width="400">

</div>

## ✨ Highlights

- **Mobile browser as a first-class terminal client** — full-fidelity PTY
  for any program (`claude`, `vim`, `htop`, your shell). The mobile UI ships
  with on-screen shortcut keys, IME-safe input handling, swipe-to-scroll,
  viewport-aware sizing, and an installable PWA manifest.
- **TUI / Claude Code adaptation** — handles Ink/Yoga reflow on resize so
  Claude does not blank on device rotation; an alt-screen blocklist keeps
  full-screen TUIs (`claude`, `tmux`, `lazygit`, …) clean across reconnects.
- **Reconnect with replay** — scrollback is rehydrated on every reconnect,
  so transient network drops, lock-screen, or sleeping the device do not
  lose context.
- **Multi-instance with unified tab bar** — each `atr <program>` runs as an
  independent subprocess at its own URL (`/i/<id>/`); the webapp surfaces
  every active instance in a single tab strip.
- **Configurable from the settings panel** — on-screen shortcut keys,
  saved command snippets, per-device font size, terminal theme, scrollback
  size, and hook integrations are user-configurable. All preferences are
  persisted to `~/.atrrc`.
- **LAN-only architecture** — a single shared token (timing-safe comparison),
  workers bound to `127.0.0.1`, and the broker as the sole outward-facing
  process. No public server, no third-party relay.
- **One-step boot autostart** — `atr install` generates the systemd /
  launchd unit; the service comes up automatically on reboot.

Full list: [`docs/FEATURES.md`](./docs/FEATURES.md).

## 🏛️ Architecture

`atr` is a two-process model: **broker** is the LAN entry and coordinator,
**worker** is a single PTY instance.

```
Browser / phone                  Your PC
┌──────────────┐                ┌──────────────────────────────────┐
│              │   ws://host    │  broker (LAN: 0.0.0.0:3000)      │
│  webapp PWA  │ ──────────────►│  ├─ /api/*  (auth / instances /  │
│              │                │  │           push / config / …)  │
│              │                │  ├─ /i/<id>/  → SPA + base href  │
│              │                │  ├─ /i/<id>/api/* → proxy worker │
│              │                │  └─ /i/<id>/ws    → proxy worker │
└──────────────┘                │            │                     │
                                │            ▼                     │
                                │  worker A   worker B   …         │
                                │  127.0.0.1: 127.0.0.1:           │
                                │  3001       3002       …         │
                                │  ├─ PTY (claude / shell / TUI)   │
                                │  ├─ /api/health  /api/hook       │
                                │  └─ /ws (PTY IO)                 │
                                └──────────────────────────────────┘
```

- **broker** (LAN entry point): the only outward-facing process, listens on
  `0.0.0.0:3000`. Owns all "system-level" APIs: login, user config,
  instance list, push subscriptions, SSE live stream. Serves the static
  frontend and injects `<base href>` for `/i/<id>/`. Long-lived — start
  once at boot.
- **worker** (PTY instance): one subprocess per instance, listens on a
  high port at `127.0.0.1` only. Exposes only `/api/health` (probe),
  `/api/hook` (loopback only), and `/ws` (PTY IO). Spawned by the broker
  via `POST /api/instances`, detached + unref so it outlives broker
  restarts.
- **Shared sessions**: broker and workers share a file-locked sessions
  store — one cookie authenticates everywhere.
- **Entry model**: the browser always talks to the broker; URL `/i/<id>/`
  identifies an instance. F5 doesn't lose context. Single PWA, multiple
  instances.

Module diagram and data flow: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
Design decisions (broker/worker split, lifecycle, API ownership, base
href injection, …): [`docs/plans/path-routing/adrs/`](./docs/plans/path-routing/adrs/).

## 📦 Install

```bash
npm install -g auvezy-terminal-remote   # -g is required (it's a CLI)
```

> ⚠️ The default `npm i` command shown on the npm package page is
> **missing `-g`** — without it the `atr` binary won't be on your PATH.

## 🚀 Quick start

### Run the background service once at boot (recommended)

```bash
atr install              # writes systemd (Linux/WSL2) / launchd (macOS) config
# Follow the printed steps to enable + start; auto-starts at boot.
```

Or run it manually (for testing / no autostart):

```bash
atr start                # foreground, Ctrl+C to quit
```

### Open in a browser

```bash
atr status               # one-shot view: process / token / entry URLs / instances
```

The "entry URLs" section lists every reachable URL with `?token=<token>`
appended — paste any of them into a browser to log in. The default entry
is marked with ★ (Tailscale > LAN > IPv6 > loopback).

After the webapp loads, click "+ New instance", pick a cwd, and a PTY
spawns. Default command is `$SHELL`; run `claude` (or anything else)
inside it.

### Spawn an instance directly (CLI, classic usage)

```bash
atr                          # runs your $SHELL
atr claude                   # runs claude
atr claude --resume foo      # extra args pass through
```

The CLI auto-ensures the background service is up (forks one if not),
spawns the instance, and prints the URL.

## 🔧 Usage

```
atr [run-flags...] [program] [args...]      # spawn a PTY instance (default)
atr <subcommand> [args]                     # manage broker / instances
```

Strict argument order: atr's own flags must come **before** `[program]`.
Once a program name is seen, every remaining token passes through to the child.

### Subcommands

| Command | Purpose |
|---|---|
| `atr start [--port n] [--host ip]` | Start the broker (foreground, Ctrl+C to quit) |
| `atr stop` | Stop the broker (SIGTERM → 5s grace → SIGKILL) |
| `atr status` | One-shot view: process, token, entry URLs, instances |
| `atr list` | List all live instances |
| `atr logs` | Tail today's broker log (`~/.atr/broker-YYYY-MM-DD.log`) |
| `atr install` | Register autostart (systemd / launchd) |
| `atr uninstall` | Remove autostart (asks for confirmation) |
| `atr attach <url>` | CLI client to share a PTY with a running instance |
| `atr kill <pattern \| all>` | Kill instances by substring match; `all` kills every one (with confirm) |
| `atr completion <zsh\|bash\|fish>` | Print shell completion script to stdout |

Reserved words (the subcommands above) take precedence at position 0. To run
a PATH binary with the same name: `atr ./<name>` or `atr -- <name>`. In an
interactive terminal, atr will prompt you to choose if a PATH binary
collides with a subcommand.

### Run flags (used with `atr [program]`)

| Flag | Purpose |
|---|---|
| `-p, --port <n>` | Service port (default 3000); instance ports are auto-assigned |
| `--name <s>` | Instance name (shown in webapp) |
| `--no-terminal` | Don't print the QR / banner (CI / daemon-friendly) |
| `--workdir <path>` | Child process cwd |
| `--token <s>` | Use a fixed token instead of reading `~/.atrrc` |

Full reference (all flags, env vars, config file):
[`docs/CLI.md`](./docs/CLI.md). Run `atr -h` for the inline help.

## 📂 File locations

| Path | Contents |
|---|---|
| `~/.atrrc` | Main config: token, user prefs, shortcuts, command snippets |
| `~/.atr/instances.json` | Live instance registry (broker / worker share it) |
| `~/.atr/broker.json` | Broker process state (pid / port / startedAt) |
| `~/.atr/broker-YYYY-MM-DD.log` | Broker daily log (kept for 7 days) |
| `~/.atr/sessions/` | Shared session files |
| `~/.atr/vapid-keys.json` | Web Push VAPID keys |
| `~/.atr/push-subscriptions.json` | Subscribed push endpoints |

## 📱 Install as a PWA

The webapp ships with a manifest. "Add to Home Screen" gives a near-native
app: no browser chrome, status bar tinted to match.

- **iOS Safari** — share button → "Add to Home Screen"
- **Android Chrome** — top-right ⋮ → "Install app"

## 🌐 WSL → Windows browser

WSL2 works out of the box on **mirrored mode**. On **NAT mode** the banner
prints a one-shot PowerShell snippet to make the port reachable from
Windows. Details: [`docs/WSL.md`](./docs/WSL.md).

## 🛣️ Roadmap

Planned, evaluating, and explicitly out-of-scope items live in
[`docs/ROADMAP.md`](./docs/ROADMAP.md). The README only lists what
already ships.

## 🛠️ Development

```bash
git clone https://github.com/jjj201200/auvezy-terminal-remote.git
cd auvezy-terminal-remote
bash install.sh            # checks Node 20+ / pnpm 9+ / build deps → installs → builds
```

Dev startup order (broker first, then vite):

```bash
# Terminal 1: start broker in dev mode (tsx running src)
pnpm --filter auvezy-terminal-remote exec tsx src/cli.ts broker start

# Terminal 2: vite dev server; proxies /api and /i/ to the broker (3000)
pnpm --filter auvezy-terminal-remote-frontend dev
# Open http://localhost:5173/
```

Run tests:

```bash
pnpm test                  # shared + backend + frontend unit tests
```

Gitee mirror (faster from mainland China):
`git clone https://gitee.com/drowsyflesh/auvezy-terminal-remote.git`

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for personal, educational,
and nonprofit use. Commercial use requires a separate license.
