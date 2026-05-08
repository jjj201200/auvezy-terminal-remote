# Running in WSL, accessing from Windows browser

[English](./WSL.md) · [简体中文](./WSL.zh-CN.md)

WSL2 has two network modes that behave differently:

- **Mirrored mode** (Win11 22H2+ default): WSL gets the Windows LAN IP directly
  (e.g. `192.168.x.x`). Windows browsers can use the IP printed on the banner —
  no extra config.
- **NAT mode** (default on older Windows): WSL is on a `172.x.x.x` private
  network — Windows browsers can't connect directly. The backend detects this
  on startup and prints PowerShell config commands at the end of the banner.

## One-shot auto config (admin PowerShell)

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

## How the backend detects WSL

`backend/src/utils/wsl-detect.ts` checks `/proc/version` for `microsoft` /
`WSL` markers. If found, `wsl-port-hint.ts` decides whether the current
network mode is mirrored or NAT (by comparing the WSL IP against the Windows
host IP). The banner appends one of:

- "WSL2 mirrored mode — banner IP is reachable directly from Windows."
- "WSL2 NAT mode — run the PowerShell snippet below from an admin terminal
  to make this port reachable from Windows."

## Build dependencies on WSL

`node-pty` builds a native module on install, which needs:

```bash
sudo apt install build-essential python3
```

If `pnpm install` fails with "make: not found" or "Python not found",
install these and retry.
