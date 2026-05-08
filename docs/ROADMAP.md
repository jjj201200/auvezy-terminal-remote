# Roadmap

> Everything below is **planned / under evaluation / explicitly out of scope** —
> NOT yet implemented. Items already shipping live in [FEATURES](./FEATURES.md).
> Each tier is sorted by "expected effort vs. UX gain".

[English](./ROADMAP.md) · [简体中文](./ROADMAP.zh-CN.md)

## Tier 1 — Planned (must-have for mobile, low effort, big UX win)

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
6. **Approval push notifications** (Claude Code hook → phone)
   When `/api/hook` receives an approval event, fan out a push notification
   to every registered subscription so the user gets a phone alert. Web Push
   (VAPID) for Android Chrome / desktop browsers; iOS Safari fallback to
   in-page LocalNotification. Backend scaffolding (vapid.json, push-routes,
   push-service) is partially in place but the end-to-end flow isn't wired up
   for production yet — needs HTTPS path (Tailscale / self-signed cert) and
   subscription UX polish.

## Tier 2 — Planned (mobile UX bonus)

7. **SmartKeys long-press menu** (Blink)
   On-screen keyboard expansion row: long-press Tab → Shift+Tab; long-press Esc
   → `^[`; long-press Ctrl → sticky until next key. We already have a Toolbar
   shortcut panel, missing "long-press menu" + "modifier sticky".
8. **Thumb-drag cursor strip** (Termius: long-press space as trackpad)
   Bottom 8px transparent strip on the terminal area; drag = arrow key
   sequence. Best solution for precise cursor movement on mobile.
9. **OSC 8 hyperlinks + word-link / file-link** (VS Code)
   xterm.js native LinkProvider — a few lines makes `src/foo.ts:42` clickable.
10. **Multi-chord shortcuts / modifier sticky** (Tabby, Blink)
    Mobile virtual modifier + Cmd-K Cmd-S two-step combos save more screen than
    a wall of buttons.
11. **Quick Fixes** (VS Code)
    Scan output, suggest fixes. `fatal: ... --set-upstream` one-click apply.
    High effort but very flashy.

## Tier 3 — Planned (write permission / security / collaboration)

12. **Writable / Read-only split** (ttyd -W, gotty -w)
    When multiple devices connect to one instance, others can be set to
    read-only. Very low effort (distinguish at WS handshake).
13. **Broadcast Input** (Termius: simultaneous input on multiple terminals)
    When multiple webapps connect to one instance, broadcast the same input to
    all PTYs. Easy to add to our multi-instance arch.
14. **TLS self-signed cert** (ttyd -S, gotty -t)
    HTTPS on LAN lets Web Push API work in more browsers (currently restricted
    on LAN HTTP).
15. **OAuth / client cert auth** (ttyd client cert)
    On top of our token, add client cert for hardware auth. Low priority —
    token is already enough.

## Tier 4 — Out of scope (explicitly NOT copying)

- ❌ **Plugin system** (Tabby): unnecessary for a LAN-only single binary
- ❌ **Cloud Settings Sync** (VS Code): conflicts with the LAN-only red line
- ❌ **Sixel / iTerm image protocols**: low value on mobile, xterm.js doesn't
  natively support them
- ❌ **asciinema public sharing**: conflicts with LAN-only; if anything we'd
  only do local `.cast` export
- ❌ **SFTP / SCP file management** (Termius / Wetty): outside the
  "remote PTY control" scope
- ❌ **End-to-end encrypted Vault**: home LAN users don't need this
