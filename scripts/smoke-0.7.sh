#!/usr/bin/env bash
#
# 0.7.0 一键 smoke：在临时 HOME 起一个 worker，看完整 broker → worker 链路。
#
# 用法：
#   bash scripts/smoke-0.7.sh                       # 起 1 个实例（默认 bash）
#   bash scripts/smoke-0.7.sh --cmd zsh             # 跑 zsh
#   bash scripts/smoke-0.7.sh --cmd claude          # 跑 claude（如已装）
#   bash scripts/smoke-0.7.sh --extra              # 多起一个实例方便测切换
#   bash scripts/smoke-0.7.sh --persist            # 不用临时 HOME，用真实 ~/
#
# 完事 Ctrl+C 退出 worker；broker 会被 unref，独立活着；用
#   HOME=$SMOKE_HOME node backend/dist/cli.js broker stop
# 干掉 broker。

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="$ROOT/backend/dist/cli.js"

if [[ ! -f "$CLI" ]]; then
  echo "[smoke] dist 不存在；先跑 pnpm build" >&2
  exit 1
fi

CMD="bash"
EXTRA=""
PERSIST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cmd) CMD="$2"; shift 2 ;;
    --extra) EXTRA=1; shift ;;
    --persist) PERSIST=1; shift ;;
    *) echo "[smoke] 未知参数 $1" >&2; exit 2 ;;
  esac
done

if [[ -n "$PERSIST" ]]; then
  SMOKE_HOME=$HOME
  echo "[smoke] 使用真实 HOME=$HOME（broker.json 落到 ~/.atr/）"
else
  SMOKE_HOME=$(mktemp -d)
  echo "[smoke] 临时 HOME=$SMOKE_HOME"
  # 退出时杀掉本次 fork 出来的 broker——临时 HOME 模式下 broker 永驻没意义，
  # 反而会把 :3000 占着导致下次启动 EADDRINUSE
  trap '
    echo
    echo "[smoke] 清理 broker（临时 HOME 模式）..."
    HOME="$SMOKE_HOME" node "$CLI" broker stop 2>/dev/null || true
    # 兜底：本次 SMOKE_HOME 写过的 broker.json 还可能跟另一台机器 broker 撞，
    # 直接 fuser kill 我们刚 fork 的 PID
    if [[ -f "$SMOKE_HOME/.atr/broker.json" ]]; then
      pid=$(grep -oE "\"pid\":[0-9]+" "$SMOKE_HOME/.atr/broker.json" 2>/dev/null | head -1 | sed "s/.*://")
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    fi
    rm -rf "$SMOKE_HOME"
    echo "[smoke] done"
  ' EXIT INT TERM
fi

echo "[smoke] 启动 worker 1（$CMD）"
echo "[smoke] 完事按 Ctrl+C 退出 worker；broker 会自启在 :3000"
echo

if [[ -n "$EXTRA" ]]; then
  echo "[smoke] 5s 后会再启第二个 worker（用 -p 0 自适应端口）"
  (
    sleep 5
    HOME=$SMOKE_HOME nohup node "$CLI" "$CMD" --no-terminal --instance-name "extra-$$" \
      > "/tmp/atr-smoke-extra-$$.log" 2>&1 &
    echo "[smoke] 第二实例 PID $!，日志 /tmp/atr-smoke-extra-$$.log"
  ) &
fi

# 主前台 worker：让你能看 banner + prompt。
# 不用 exec —— shell 要保留住 trap 在 worker 退出后清理 broker
HOME=$SMOKE_HOME node "$CLI" "$CMD"
