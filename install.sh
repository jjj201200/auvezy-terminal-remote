#!/usr/bin/env bash
#
# install.sh — open-claude-remote-clone 一键安装脚本
#
# 流程：
#   1) 检查 Node >= 20、pnpm >= 9
#   2) Linux/WSL：检查 build-essential + python3（node-pty 编译需要）
#   3) pnpm install --frozen-lockfile
#   4) pnpm build（shared + frontend + backend，并把 frontend dist 拷给 backend）
#   5) 输出运行命令
#
# 使用：
#   bash install.sh
#

set -euo pipefail

# ──────────────── 颜色 ────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf "${GREEN}[install]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[install]${NC} %s\n" "$*"; }
err() {
  printf "${RED}[install]${NC} %s\n" "$*" >&2
  exit 1
}

# ──────────────── 1) Node ────────────────
if ! command -v node >/dev/null 2>&1; then
  err "未找到 Node.js。请先安装 Node.js >= 20，例：\n  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 20"
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  err "Node 版本过低：当前 v${NODE_VER}，需要 >= 20"
fi
info "Node v${NODE_VER} ✓"

# ──────────────── 2) pnpm ────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  warn "未找到 pnpm，尝试通过 corepack 启用..."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
  else
    err "请手动安装 pnpm >= 9：\n  npm install -g pnpm@latest"
  fi
fi

PNPM_VER="$(pnpm -v)"
PNPM_MAJOR="${PNPM_VER%%.*}"
if [ "${PNPM_MAJOR}" -lt 9 ]; then
  err "pnpm 版本过低：当前 ${PNPM_VER}，需要 >= 9"
fi
info "pnpm ${PNPM_VER} ✓"

# ──────────────── 3) Linux/WSL：node-pty 编译依赖 ────────────────
case "$(uname -s)" in
  Linux*)
    MISSING=()
    for cmd in make g++ python3; do
      command -v "$cmd" >/dev/null 2>&1 || MISSING+=("$cmd")
    done
    if [ "${#MISSING[@]}" -gt 0 ]; then
      warn "node-pty 编译需要：${MISSING[*]}"
      warn "Debian/Ubuntu：sudo apt-get install -y build-essential python3"
      warn "Arch：sudo pacman -S base-devel python"
      err "请先安装上述依赖后重试"
    fi
    info "node-pty 编译依赖 ✓ (make/g++/python3)"
    ;;
  Darwin*)
    info "macOS（默认带 clang/python，跳过显式检查）"
    ;;
  *)
    warn "未知平台 $(uname -s)，跳过原生依赖检查"
    ;;
esac

# ──────────────── 4) install + build ────────────────
info "pnpm install --frozen-lockfile..."
pnpm install --frozen-lockfile

info "pnpm build..."
pnpm build

# ──────────────── 5) 输出运行命令 ────────────────
info "✅ 安装完成"
cat <<'EOF'

下一步：
  pnpm start                        # 默认 0.0.0.0:3000，无终端二维码：加 --no-terminal
  pnpm start -- --port 3001         # 指定端口（可启多实例）
  pnpm stop                         # 停止本机所有实例

配置文件位置：~/.claude-remote/
  ├── config.json              （token / shortcuts / 启动命令）
  ├── vapid.json               （Web Push 私钥，0o600）
  ├── push-subscriptions.json  （已订阅设备）
  └── instances/<port>.json    （多实例注册表）

详情：见 README.md / docs/ARCHITECTURE.md
EOF
