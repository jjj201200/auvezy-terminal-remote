# Features

Complete inventory of what ships in `auvezy-terminal-remote` today.
For planned-but-not-built items see [ROADMAP](./ROADMAP.md).

[English](./FEATURES.md) · [简体中文](./FEATURES.zh-CN.md)

## Core terminal

- Full PTY bridge over WebSocket (node-pty + xterm.js 5), ANSI colors,
  alt-screen / TUI-friendly scrollback handling, configurable ANSI filter
- Reconnect with replay — `OutputBuffer` rehydrates scrollback on every
  reconnect; alt-screen TUIs (claude / tmux / vim / htop …) protected by an
  extensible blocklist so reconnect never blanks the screen
- Incremental redraw fix for Ink/Claude/Yoga TUIs that don't reflow on resize
  (double-pulse strategy)
- Session TTL + idle disconnect handling, configurable

## Multi-instance

- One `atr` per terminal — each instance auto-grabs the next free port
  (3000, 3001, 3002…); a single browser tab bar shows them all and lets you
  switch
- `instances/<port>.json` registry with file-locked atomic writes, stale-PID
  cleanup, shared token across instances on the same machine
- `atr list` / `atr kill <pattern|all>` / `atr attach <url>` / `atr completion <shell>` subcommands

## Multi-client (master / slave arbitration)

- Multiple browsers / tabs / `attach` clients on the same instance simultaneously
- Master arbitration: webapp > attach > local PC, configurable per session
- "Adapt to current device" button in the top bar takes over PTY size from
  whichever device is currently active

## Mobile-first webapp

- PWA (manifest + service worker), installable on iOS Safari and Android
  Chrome — runs without browser chrome, status bar tinted to match
- Mobile-optimized input: dedicated input bar + toolbar + IME composition
  guard (no predictive-input pollution from iOS / Android keyboards)
- Touch gestures: long-press progress indicator, swipe scroll, momentum
  preservation, virtual keyboard safe-area handling, viewport-aware fit
- Mobile instance switcher (sheet) + share sheet (URL / QR copy)
- iOS-specific xterm work: WebGL disabled, helper-textarea predictive input
  suppressed, focus-hijack mitigation
- Auth page entry points: token paste / camera QR scan / full-URL paste

## Settings panel

In-webapp, all written back to `~/.auvezy/terminal-remote/config.json`.

- General (language, theme, font size, letter spacing)
- Display (xterm theme picker including 16-color / Campbell / custom)
- Shortcuts (custom keys with bucket grouping, drag-to-reorder)
- Commands (saved command snippets with grouping)
- Controls (input mode toggle, TUI tap-to-focus, scrollback options)
- Network (display-IP override, CORS allow list inspection)
- Actions (per-instance quick actions)
- About (version, repo links, license)
- Developer tab (debug toggles, console-bridge settings)

## Authentication & security

- 64-char hex token, `timingSafeEqual` comparison
- Port-bound session cookie (cookie-name suffix per port → no cross-instance
  cookie leakage)
- LAN-only by default; optional CORS allow list via `OCR_CORS_ALLOW`
- `/api/hook` accepts loopback only (127.0.0.1 / ::1)
- Workdir whitelist for path traversal protection
- Config files at mode 0o600, directory at 0o700
- Per-IP rate limiting on auth attempts

## Network awareness

- IP drift detection: 30s polling, stability threshold, broadcast
  `ip_changed` to clients with toast prompt
- Multi-NIC display IP heuristic with diagnostic banner output (LAN +
  Tailscale dual QR codes)
- WSL2 mirrored / NAT mode auto-detection + PowerShell port-forward script
  generated on first run — see [WSL guide](./WSL.md)

## CLI ergonomics

- Banner with color-aware QR codes (LAN + Tailscale where applicable)
- `--dev-proxy` for local frontend development (vite port auto-discovery
  5173–5180, 10s cache)
- Full flag set documented in [CLI reference](./CLI.md)

## Approval hook (Claude Code integration)

- `/api/hook` endpoint accepts Claude approval events (loopback only)
- Settings panel "Integrations → Claude Code" fine-grained event subscription:
  approvals / tool progress / turn lifecycle / session lifecycle / user prompts,
  each individually toggleable
- Status bar auto-reflects `waitingInput` / `Bash: npm test` running state
- `console-bridge`: front-end `console.*` forwarded over WS to backend stderr
  for cross-device debugging

## PWA Push notifications

- Web Push (VAPID): keypair auto-generated and persisted to
  `~/.auvezy/terminal-remote/vapid-keys.json`
- Frontend "Settings → Notifications" tab for one-click subscribe/unsubscribe,
  with graceful degradation (unsupported browsers, denied permissions)
- iOS 16.4+ (Safari / Chrome / 3rd-party) Web Push requires: **app added to
  home screen** AND HTTPS (LAN HTTP restriction)
- Approval hook fans out push to every registered subscription → phone lock
  screen notification
- Notification click deep-links back to webapp's corresponding instance

## Quick reference (technical mapping)

| Feature | How it's implemented |
|---|---|
| PTY bridge | node-pty + xterm.js 5 |
| Auth | timingSafeEqual token + Session Cookie (port-bound) |
| Multi-instance | port-finder auto-increment + cookie-name suffix isolation |
| Reconnect / replay | OutputBuffer + history_sync (alt-screen filtered by default) |
| IP drift detection | 30s polling + stability threshold + ip_changed broadcast |
| Config rewrite | Webapp Settings dialog → /api/config |
| `attach` subcommand | Master arbitration (webapp > attach > PC) |
