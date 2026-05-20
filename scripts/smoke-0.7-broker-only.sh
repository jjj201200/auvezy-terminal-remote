#!/usr/bin/env bash
#
# 0.7.x broker-only smoke:不启 worker,直接 atr start 拉起 broker 进程,
# 验证 webapp 入口完整链路:
#   1. /api/health 返回 role=broker
#   2. /api/auth 接受 token cookie
#   3. POST /api/instances 异步语义(202 + SSE)
#   4. /i/<id>/api/health 反代到 worker(刚 spawn 的)
#   5. /manifest.webmanifest?token= 注入 start_url
#   6. SPA 入口注入 <link rel=manifest> token
#
# 流程结束自动清理。任何一步失败立即退出 + 打印日志。
#
# 用法:
#   bash scripts/smoke-0.7-broker-only.sh
#
# 与 smoke-0.7.sh 的差异:
#   - 不开前台 PTY,纯 HTTP 检查 broker / worker 路由是否就位
#   - 创建一个实例后立刻清理,不需要交互
#   - 全程 curl + grep,无 PTY 依赖,可在 CI 跑(本地 WSL 也能跑)

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="$ROOT/backend/dist/cli.js"

if [[ ! -f "$CLI" ]]; then
  echo "[smoke-broker] dist 不存在;先跑 pnpm build" >&2
  exit 1
fi

# 用临时 HOME 避免污染真实 ~/.atr / ~/.atrrc
SMOKE_HOME=$(mktemp -d)
LOG="/tmp/atr-smoke-broker-$$.log"

cleanup() {
  echo
  echo "[smoke-broker] 清理..."
  if [[ -n "${BROKER_BG_PID:-}" ]]; then
    kill "$BROKER_BG_PID" 2>/dev/null || true
    wait "$BROKER_BG_PID" 2>/dev/null || true
  fi
  if [[ -f "$SMOKE_HOME/.atr/broker.json" ]]; then
    pid=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$SMOKE_HOME/.atr/broker.json','utf-8')).pid)}catch{}" 2>/dev/null)
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  fi
  rm -rf "$SMOKE_HOME" "$LOG"
}
trap cleanup EXIT INT TERM

# 选个不撞的端口(主用 3737,被占就让 broker 自适应递增)
echo "[smoke-broker] 临时 HOME=$SMOKE_HOME"
# 3737 残留检查 —— 上次没清干净的 broker 会让本次 start 8s 超时
if ss -tln 2>/dev/null | grep -q ":3737 "; then
  echo "[smoke-broker] ERR: 3737 已被占用,先 \`atr stop\` 或 kill 残留 broker" >&2
  exit 1
fi
# 用 --foreground 直接前台跑 broker,smoke 自己管 PID;daemonize 模式有 8s 探测
# 超时的 flakiness(快速 stop/start 时上一个 broker 的端口在 TIME_WAIT,父进程探测
# broker.json 落地超时即报错,但其实子进程已 listen),smoke 不需要那条路径
echo "[smoke-broker] 启动 broker(--foreground,后台跑)..."
HOME="$SMOKE_HOME" node "$CLI" start --foreground > "$LOG" 2>&1 &
BROKER_BG_PID=$!
# 等 broker.json 出现 + health 200
for i in 1 2 3 4 5 6 7 8 9 10; do
  if [[ -f "$SMOKE_HOME/.atr/broker.json" ]] \
     && curl -sf --noproxy '*' http://127.0.0.1:3737/api/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done
if [[ ! -f "$SMOKE_HOME/.atr/broker.json" ]]; then
  echo "[smoke-broker] broker 10s 内未写 broker.json" >&2
  cat "$LOG" >&2
  exit 1
fi

PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$SMOKE_HOME/.atr/broker.json','utf-8')).port)")
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$SMOKE_HOME/.atrrc','utf-8')).token)")
URL="http://127.0.0.1:$PORT"

echo "[smoke-broker] broker 就绪 :$PORT (token=$(echo "$TOKEN" | head -c 8)...)"

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name: expected=$expected actual=$actual" >&2
    cat "$LOG" >&2
    exit 1
  fi
}

assert_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name: '$needle' not in: $haystack" >&2
    cat "$LOG" >&2
    exit 1
  fi
}

echo "[smoke-broker] 1. /api/health role=broker"
HEALTH=$(curl -s --noproxy '*' "$URL/api/health")
assert_contains "health.role" '"role":"broker"' "$HEALTH"

echo "[smoke-broker] 2. /api/auth 接受 token + 返回 cookie"
SET_COOKIE=$(curl -s --noproxy '*' -i -X POST "$URL/api/auth" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}" \
  | grep -i '^set-cookie:' | head -1)
assert_contains "set-cookie 存在" "session_id" "$SET_COOKIE"
COOKIE=$(echo "$SET_COOKIE" | sed 's/^[Ss]et-[Cc]ookie: //; s/;.*$//')

echo "[smoke-broker] 3. /manifest.webmanifest?token= 注入 start_url"
MANIFEST=$(curl -s --noproxy '*' "$URL/manifest.webmanifest?token=$TOKEN")
EXPECTED_START="/?token=$TOKEN"
ACTUAL_START=$(echo "$MANIFEST" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).start_url))")
assert_eq "manifest.start_url 注入" "$EXPECTED_START" "$ACTUAL_START"

echo "[smoke-broker] 4. SPA / 入口注入 <link rel=manifest> token"
HTML=$(curl -s --noproxy '*' "$URL/?token=$TOKEN")
assert_contains "index.html manifest link 带 token" "token=$TOKEN" \
  "$(echo "$HTML" | grep -i 'rel="manifest"' | head -1)"

echo "[smoke-broker] 5. POST /api/instances 202 异步语义"
CREATE_BODY=$(curl -s --noproxy '*' -X POST "$URL/api/instances" \
  -H "Cookie: $COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke","cwd":"/tmp","command":"bash"}' \
  -o /tmp/atr-smoke-create-$$.json -w "%{http_code}")
assert_eq "POST /api/instances 状态码" "202" "$CREATE_BODY"
INSTANCE_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/atr-smoke-create-$$.json','utf-8')).instance.instanceId)")
rm -f /tmp/atr-smoke-create-$$.json
echo "  instanceId=$INSTANCE_ID"

echo "[smoke-broker] 6. 等待实例就绪(/i/<id>/api/health 200 = worker listen)"
for i in 1 2 3 4 5 6 7 8 9 10; do
  WORKER_HEALTH=$(curl -s --noproxy '*' -H "Cookie: $COOKIE" "$URL/i/$INSTANCE_ID/api/health" || echo "")
  if [[ "$WORKER_HEALTH" == *'"ok":true'* ]]; then
    echo "  ✓ worker 就绪(等了 ${i}s)"
    break
  fi
  sleep 1
done
if [[ "$WORKER_HEALTH" != *'"ok":true'* ]]; then
  echo "  ✗ worker 没在 10s 内 ready" >&2
  cat "$LOG" >&2
  exit 1
fi

echo
echo "[smoke-broker] 全部通过 ✓"
