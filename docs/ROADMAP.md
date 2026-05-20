# Roadmap

> Everything below is **planned / under evaluation / explicitly out of scope** —
> NOT yet implemented. Items already shipping live in [FEATURES](./FEATURES.md).
> Each tier is sorted by "expected effort vs. UX gain".
>
> **Last reviewed**: 2026-05-20 (audited against 0.7.6 codebase; push notifications
> moved from Tier 1 down to FEATURES as they shipped end-to-end).

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

   Both extremely friendly on mobile (slow typing → cross-session history
   search is core).
4. **Auto Reply** (VS Code)
   Match prompt → auto-respond y/N. Mobile users hate typing `[y/N]`.
5. **Process Revive** (VS Code terminal revive)
   You already have instances.json; serialize scrollback into it. After restart
   webapp can see the previous content. The only hard part on the LAN-only
   route is serialization size — bumping to 5MB is fine.

## Tier 2 — Planned (mobile UX bonus)

6. **SmartKeys long-press menu** (Blink)
   On-screen keyboard expansion row: long-press Tab → Shift+Tab; long-press Esc
   → `^[`; long-press Ctrl → sticky until next key. We already have a Toolbar
   shortcut panel + a LongPressIndicator component (currently used for InputBar
   focus), missing "long-press menu" + "modifier sticky".
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

## Tier 3 — Planned (write permission / security / collaboration)

11. **Writable / Read-only split** (ttyd -W, gotty -w)
    When multiple devices connect to one instance, others can be set to
    read-only. Very low effort (distinguish at WS handshake).
12. **Broadcast Input** (Termius: simultaneous input on multiple terminals)
    When multiple webapps connect to one instance, broadcast the same input to
    all PTYs. Easy to add to our multi-instance arch.
13. **TLS self-signed cert** (ttyd -S, gotty -t)
    HTTPS on LAN. **Current main driver**: iOS PWA Web Push doesn't work on
    LAN HTTP, requires HTTPS. Tailscale users already have it (ts.net cert),
    others need self-signed + local CA install flow.
14. **OAuth / client cert auth** (ttyd client cert)
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
  > Note: the file browser shipped in 0.8.0 (read-only listing + preview +
  > search) does **not** cross this line — it is scoped to the active
  > instance's cwd under the workdir-policy allow list, with no write /
  > upload / download. Goal is phone-side code & log inspection, not a
  > full file-management product. See `docs/plans/file-browser/`.
- ❌ **End-to-end encrypted Vault**: home LAN users don't need this
