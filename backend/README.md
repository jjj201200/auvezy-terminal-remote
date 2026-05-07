# auvezy-terminal-remote

**English** | [简体中文](https://github.com/jjj201200/auvezy-terminal-remote/blob/main/README.zh-CN.md)

> Remote-control any terminal program on your PC (zsh / bash / claude / any CLI)
> from a phone or tablet browser over LAN.
>
> One command — `atr <program>` — and every instance shows up as a tab in your
> browser's top bar.

> **License: [PolyForm Noncommercial 1.0.0](./LICENSE)** —
> free for personal, educational, and nonprofit use, including modification and
> redistribution. Commercial use requires a separate license.

## What is this

You're on the couch with your phone. A long-running CLI on your PC
(Claude Code / a deploy script / a debug session…) is doing its thing and
you want to:

- See its live output (ANSI colors included)
- Type the next command, hit arrow keys
- Get a phone notification when Claude triggers an approval hook
- Not open any port to the public internet, not depend on a cloud service

That's exactly what this project does. PTY output is bridged over WebSocket
to a webapp; webapp input is bridged back to the PTY. Listens on LAN IPs only,
authed by token + local cookie.

## Quick start

### Global install (npm users)

```bash
npm install -g auvezy-terminal-remote   # -g is required
```

> ⚠️ The default `npm i auvezy-terminal-remote` shown at the top right of the
> npm package page is **missing `-g`**. This is a CLI tool — without `-g` the
> `atr` binary won't be on your PATH. Use the command above.

Then in any terminal:

```bash
atr                       # runs your $SHELL (auto-detects zsh / bash)
atr claude                # runs claude
atr zsh                   # runs zsh
atr claude --resume foo   # passes any args through to the child process
```

After it starts, scan the QR code printed in the terminal — the webapp logs in
automatically (token lives in `~/.auvezy/terminal-remote/config.json`).

**Multiple instances**: Run `atr <prog>` in different terminals; each grabs the
next available port (3000, 3001, 3002…). Tabs for new instances appear in the
browser's top bar automatically — click to switch.

```bash
atr list                  # list all running instances on this machine
atr stop                  # stop all instances on this machine
atr attach <url>          # take over a running instance from the command line
```

### From source (development or self-build)

```bash
# GitHub (primary)
git clone https://github.com/jjj201200/auvezy-terminal-remote.git
# or Gitee mirror (faster from mainland China)
git clone https://gitee.com/drowsyflesh/auvezy-terminal-remote.git

cd auvezy-terminal-remote
bash install.sh           # checks Node 20+ / pnpm 9+ / build deps → installs → builds
node backend/dist/cli.js  # equivalent to `atr`
```


## Feature matrix

| Feature | How it's implemented |
|---|---|
| PTY bridge | node-pty + xterm.js 5 |
| Auth | timingSafeEqual token + Session Cookie (port-bound) |
| Multi-instance | port-finder auto-increment + cookie-name suffix isolation |
| Reconnect / replay | OutputBuffer + history_sync (alt-screen filtered by default) |
| Approval push | Web Push (VAPID, 3 priorities) + iOS Safari LocalNotification fallback |
| IP drift detection | 30s polling + stability threshold + ip_changed broadcast |
| Config rewrite | Webapp Settings dialog → /api/config |
| `attach` subcommand | Master arbitration (webapp > attach > PC) |

## Configuration

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

VAPID keys live in the same directory: `vapid.json` (mode 0o600, auto-generated
or read from env vars `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`).

Subscriptions are in `push-subscriptions.json`; the multi-instance registry is in
`instances/<port>.json`.

## Startup options

```
atr [subcommand] [options]

Subcommands:
  start          start the backend (default)
  attach         attach to a running instance from the command line
  list           list all running instances on this machine
  stop           stop all instances on this machine

Options:
  -p, --port <n>      port (default 3000, auto-increments unless -S)
  -S, --strict-port   strict port mode: fail if port is taken, no fallback
  --spawn-timeout <s> PTY spawn fallback seconds (default 30; 0 = no timeout;
                      first browser connect / Enter / timeout — whichever first)
  --wait-confirm      require Enter to spawn (overrides browser/timeout triggers)
  --name <s>          instance name (shown in webapp)
  --no-terminal       don't print QR code (CI / daemon-friendly)
  --command <cmd>     PTY command (default: 'claude')
  --args <json>       command args (JSON array string)
  -h, --help          show help
  -v, --version       show version
```

Environment variables:

| Variable | Purpose |
|---|---|
| `OCR_COMMAND` | Child command (default `$SHELL`, or `/bin/sh`; set to `claude` to run Claude) |
| `OCR_ARGS`    | Command args (JSON array string, e.g. `'["-c","tail -f /dev/null"]'`) |
| `OCR_CWD`     | Child process working directory (default: `process.cwd()`) |
| `OCR_ANSI_FILTER` | Filter alt-screen output (default `false`). Set `true` for cleaner reconnect replay after vim/htop exits; full-time alt-screen TUIs (claude/tmux/...) are still protected by built-in blocklist |
| `OCR_ANSI_FILTER_TUI_NAMES` | Append to your own alt-screen TUI blocklist (comma-separated), e.g. `"lazygit,k9s,gh-dash"` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Inject VAPID keys (highest priority, skips file) |
| `PORT`        | Same as `--port` |
| `STRICT_PORT` | Same as `--strict-port` (set `true` to enable strict mode) |
| `OCR_SPAWN_TIMEOUT` | Same as `--spawn-timeout` (seconds; 0 = no timeout) |
| `AUTH_TOKEN`  | Specify token (default: auto-generated) |
| `LOG_LEVEL`   | pino level (default `info`) |

> Legacy names `CLAUDE_COMMAND` / `CLAUDE_ARGS` / `CLAUDE_CWD` still work
> (warned once at startup). Renamed to make it clear: this project is not tied
> to Claude — it can run any PTY program.

## Install as a PWA (recommended on mobile)

The webapp ships with a manifest. "Add to Home Screen" gives you a near-native
app experience:

- **Android Chrome**: top-right ⋮ → "Install app" (or the address bar shows an
  "Install" prompt)
- **iOS Safari**: share button → "Add to Home Screen"

After install: no browser UI (no address bar, no bottom nav), independent task
card, status bar matches the app color.

> **Web Push limitations**: browsers require Push to be in a secure context
> (HTTPS / localhost). LAN HTTP (http://192.168.x.x) cannot subscribe to push.
> The settings panel will display "HTTPS required". Workarounds: use Tailscale /
> Cloudflare Tunnel to put HTTPS in front of the backend, or deploy with a
> self-signed certificate.

## Running in WSL, accessing from Windows browser

WSL2 has two network modes that behave differently:

- **Mirrored mode** (Win11 22H2+ default): WSL gets the Windows LAN IP directly
  (e.g. `192.168.x.x`). Windows browsers can use the IP printed on the banner,
  no extra config.
- **NAT mode** (default): WSL is on `172.x.x.x` private network — Windows
  browsers can't connect directly. The backend detects this on startup and
  prints PowerShell config commands at the end of the banner.

**One-shot auto config** (admin PowerShell):

```powershell
# Forward common port range (default 3000–3010)
.\scripts\wsl-port-forward.ps1

# Forward specific ports only
.\scripts\wsl-port-forward.ps1 -Ports 3000,3001

# Register to re-forward on login (no manual re-run when WSL IP changes)
.\scripts\wsl-port-forward.ps1 -Persist

# Cleanup
.\scripts\wsl-port-forward.ps1 -Reset
```

## Architecture / decisions

- Design doc: [`docs/plans/open-claude-remote-clone/design.md`](./docs/plans/open-claude-remote-clone/design.md)
- Module diagram and data flow: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Architecture decision records (ADRs):
  [`docs/plans/open-claude-remote-clone/adrs/`](./docs/plans/open-claude-remote-clone/adrs/)

## Development

```bash
pnpm install
pnpm dev          # backend (tsx watch) + frontend (vite) in parallel
pnpm test         # shared + backend + frontend unit tests
pnpm typecheck
pnpm build        # full build artifacts (frontend copied into backend/frontend-dist)
```


## Roadmap

### Tier 1 (must-have for mobile, low effort, big UX win)

1. **Local Echo** (Mosh / Blink / code-server)
   Input lag killer on mobile 4G/weak networks. xterm prediction plugin shows
   keystrokes immediately, PTY response replaces.
2. **Multi-line paste warning + bracketed paste** (VS Code, Tabby)
   Mobile users paste 5-line commands from WeChat/email — currently goes
   straight to PTY, dangerous. Detect multi-line → confirm dialog.
3. **Shell Integration subset (OSC 633/133)**
   - Command decorations (green/red dot)
   - Run Recent Command — fuzzy cross-session history quick pick
   - Both extremely friendly on mobile (slow typing → cross-session history
     search is core)
4. **Auto Reply** (VS Code)
   Match prompt → auto-respond y/N. Mobile users hate typing `[y/N]`.
5. **Process Revive** (VS Code terminal revive)
   You already have instances.json; serialize scrollback into it. After restart
   webapp can see the previous content. The only hard part on the LAN-only
   route is serialization size — bumping to 5MB is fine.

### Tier 2 (mobile UX bonus)

6. **SmartKeys long-press menu** (Blink)
   On-screen keyboard expansion row: long-press Tab → Shift+Tab; long-press Esc
   → `^[`; long-press Ctrl → sticky until next key. We already have a Toolbar
   shortcut panel, missing "long-press menu" + "modifier sticky".
7. **Thumb-drag cursor strip** (Termius: long-press space as trackpad)
   Bottom 8px transparent strip on the terminal area; drag = arrow key
   sequence. Best solution for precise cursor movement on mobile.
8. **OSC 8 hyperlinks + word-link / file-link** (VS Code)
   xterm.js native LinkProvider — a few lines makes `src/foo.ts:42` clickable.
9. **Multi-chord shortcuts / modifier sticky** (Tabby, Blink)
   Mobile virtual modifier + Cmd-K Cmd-S two-step combos save more screen than
   a wall of buttons.
10. **Quick Fixes** (VS Code)
    Scan output, suggest fixes. `fatal: ... --set-upstream` one-click apply.
    High effort but very flashy.

### Tier 3 (write permission / security / collaboration)

11. **Writable / Read-only split** (ttyd -W, gotty -w)
    When multiple devices connect to one instance, others can be set to
    read-only. Very low effort (distinguish at WS handshake).
12. **Broadcast Input** (Termius: simultaneous input on multiple terminals)
    When multiple webapps connect to one instance, broadcast the same input to
    all PTYs. Easy to add to our multi-instance arch.
13. **TLS self-signed cert** (ttyd -S, gotty -t)
    HTTPS on LAN lets Web Push API work in more browsers (currently restricted
    on LAN HTTP).
14. **OAuth / client cert auth** (ttyd client cert)
    On top of our token, add client cert for hardware auth. Low priority —
    token is already enough.

### Tier 4 (explicitly NOT copying)

- ❌ Plugin system (Tabby): unnecessary for a LAN-only single binary
- ❌ Cloud Settings Sync (VS Code): conflicts with the LAN-only red line
- ❌ Sixel/iTerm image protocols: low value on mobile, xterm.js doesn't
  natively support them
- ❌ asciinema public sharing: conflicts with LAN-only; if anything we'd only
  do local `.cast` export
- ❌ SFTP/SCP file management (Termius/Wetty): outside the "remote PTY control"
  scope
- ❌ End-to-end encrypted Vault: home LAN users don't need this

---

## Pain points unique to us (others haven't done these)

- **Tailscale / VPN QR code labeling**: we already do dual LAN+Tailscale codes —
  a thoughtful detail on the LAN-only route
- **Webapp toast notification + iOS LocalNotification fallback**: under iOS PWA
  push restrictions, this fallback strategy isn't considered by anyone else
