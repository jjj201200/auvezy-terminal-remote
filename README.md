<div align="center">

<img src="./frontend/public/icons/atr-icon.svg" alt="auvezy-terminal-remote logo" width="96" height="96">

# auvezy-terminal-remote

[![npm](https://img.shields.io/npm/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://www.npmjs.com/package/auvezy-terminal-remote)
[![license](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-b6f09c?style=flat-square&labelColor=0a0c0f)](./LICENSE)
[![node](https://img.shields.io/node/v/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://nodejs.org)
[![stars](https://img.shields.io/github/stars/jjj201200/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://github.com/jjj201200/auvezy-terminal-remote)

**English** · [简体中文](./README.zh-CN.md)

Remote-control any terminal program on your PC from a phone or tablet
browser over LAN. One command — `atr [program]` — and every instance
shows up as a tab in your browser's top bar.

<img src="./frontend/public/screenshots/desktop.png" alt="Webapp running Claude Code in a browser tab" width="720">

</div>

## ✨ Features

- **PTY bridge** — node-pty + xterm.js 5, full ANSI, alt-screen TUI safe
- **Claude Code / TUI tuned** — Ink/Yoga reflow fix on resize, alt-screen blocklist, "adapt to current device" PTY sizing
- **Multi-instance** — every `atr` grabs the next free port; one tab bar shows them all
- **Multi-client** — many browsers / `attach` clients on one instance, with master arbitration
- **Mobile-first PWA** — IME guard, long-press, swipe scroll, viewport-aware fit, install to home screen
- **Custom shortcuts & commands** — define on-screen keys and saved command snippets in the settings panel
- **Reconnect with replay** — scrollback rehydrated on every reconnect, alt-screen TUIs protected
- **LAN-only by design** — token + port-bound cookie, `timingSafeEqual`, loopback-only `/api/hook`
- **WSL aware** — mirrored / NAT auto-detected, PowerShell port-forward script generated

Full inventory in [`docs/FEATURES.md`](./docs/FEATURES.md).

## 📦 Install

```bash
npm install -g auvezy-terminal-remote   # -g is required (it's a CLI)
```

> ⚠️ The default `npm i` command shown on the npm package page is **missing
> `-g`** — without it the `atr` binary won't be on your PATH.

## 🚀 Quick start

```bash
atr                       # runs your $SHELL (zsh / bash auto-detected)
atr claude                # runs claude
atr claude --resume foo   # extra args passed through to claude
```

After it starts, scan the QR code printed in the terminal — the webapp
logs in automatically (token lives in `~/.auvezy/terminal-remote/config.json`).

Run `atr` in different terminals to spawn more instances; the browser tab
bar updates live.

## 🔧 Usage

```
atr [atr-flags...] [program] [program-args...]
atr <subcommand> [args]
```

Most-used flags:

| Flag | Purpose |
|---|---|
| `-p, --port <n>` | Port (default 3000, auto-increments) |
| `--name <s>` | Instance name (shown in webapp) |
| `--no-terminal` | Don't print QR (CI / daemon-friendly) |
| `--workdir <path>` | Child process cwd |
| `--token <s>` | Use a fixed token instead of auto-generated |

Subcommands: `atr list` · `atr stop [pattern]` · `atr attach <url>`.

Full reference (all flags, env vars, config file): [`docs/CLI.md`](./docs/CLI.md).
Run `atr -h` for the inline help.

## 📱 Install as a PWA

The webapp ships with a manifest. "Add to Home Screen" gives a near-native
app: no browser chrome, status bar tinted to match.

- **iOS Safari** — share button → "Add to Home Screen"
- **Android Chrome** — top-right ⋮ → "Install app"

## 🌐 WSL → Windows browser

WSL2 backend works out of the box on **mirrored mode**. On **NAT mode**
the banner prints a one-shot PowerShell snippet to make the port reachable
from Windows. Details: [`docs/WSL.md`](./docs/WSL.md).

## 🛣️ Roadmap

Planned, evaluating, and explicitly out-of-scope items live in
[`docs/ROADMAP.md`](./docs/ROADMAP.md). The README only lists what already ships.

## 🏛️ Architecture

- Module diagram & data flow: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Design doc & ADRs: [`docs/plans/open-claude-remote-clone/`](./docs/plans/open-claude-remote-clone/)

## 🛠️ Development

```bash
git clone https://github.com/jjj201200/auvezy-terminal-remote.git
cd auvezy-terminal-remote
bash install.sh           # checks Node 20+ / pnpm 9+ / build deps → installs → builds
pnpm dev                  # backend (tsx watch) + frontend (vite) in parallel
pnpm test                 # shared + backend + frontend unit tests
```

Gitee mirror (faster from mainland China):
`git clone https://gitee.com/drowsyflesh/auvezy-terminal-remote.git`

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for personal, educational,
and nonprofit use. Commercial use requires a separate license.
