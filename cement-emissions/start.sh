#!/usr/bin/env bash
# =============================================================================
# 水泥生产排放监测平台 - 一键启动脚本
#
# 用法:
#   ./start.sh                自动选择：有 Docker 用 Docker Compose，否则本地模式
#   ./start.sh docker         强制使用 Docker Compose（PostgreSQL + API + Web）
#   ./start.sh local          本地模式：Node + 嵌入式 PostgreSQL（免安装 PG）
#   ./start.sh local --fresh  本地模式并重置数据库
#   ./start.sh stop           停止（Docker 模式停止容器，本地模式停止子进程）
#   ./start.sh logs           查看 Docker 日志
#   ./start.sh test           运行后端与前端全部测试
#
# 启动后访问:
#   Web 平台      http://localhost:8080
#   API 健康检查  http://localhost:4000/api/health
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
PID_DIR="$ROOT_DIR/.run"
BACKEND_PID="$PID_DIR/backend.pid"
PG_PID="$PID_DIR/pg-local.pid"
VITE_PID="$PID_DIR/vite.pid"

BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
export LOCAL_PG_PORT="${LOCAL_PG_PORT:-5432}"
export LOCAL_PG_DB="${LOCAL_PG_DB:-cement_emissions}"
export LOCAL_PG_USER="${LOCAL_PG_USER:-postgres}"
export LOCAL_PG_PASSWORD="${LOCAL_PG_PASSWORD:-postgres}"

log()  { echo -e "\033[1;34m[start]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ ok ]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err()  { echo -e "\033[1;31m[fail]\033[0m $*" >&2; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------- 依赖检查 ----------
ensure_node_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    log "安装 $(basename "$dir") 依赖..."
    (cd "$dir" && npm install --no-audit --no-fund)
  fi
}

wait_http() {
  local url="$1" timeout="${2:-60}" n=0
  while [ "$n" -lt "$timeout" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
    n=$((n + 1))
  done
  return 1
}

# ---------- Docker 模式 ----------
compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  else
    echo "docker-compose"
  fi
}

start_docker() {
  local dc
  dc="$(compose_cmd)"
  if [ ! -f "$ROOT_DIR/.env" ]; then
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
    log "已根据 .env.example 生成 .env"
  fi
  log "使用 Docker Compose 构建并启动全部服务..."
  $dc up -d --build
  log "等待后端健康检查..."
  if wait_http "http://localhost:$BACKEND_PORT/api/health" 90; then
    ok "后端就绪"
  else
    err "后端启动超时，可执行 $dc logs backend 查看日志"
    exit 1
  fi
  ok "全部服务已启动"
  cat <<EOF

  🌐 监测平台:  http://localhost:$FRONTEND_PORT
  🔌 API 文档:  http://localhost:$BACKEND_PORT/api/health
  🗄  PostgreSQL: localhost:${POSTGRES_PORT:-5432}

  实时数据模拟已默认开启（SIMULATION_ENABLED=true）。
  停止服务: ./start.sh stop    查看日志: ./start.sh logs
EOF
}

stop_docker() {
  log "停止 Docker 服务..."
  $(compose_cmd) down
  ok "已停止"
}

# ---------- 本地模式 ----------
stop_local() {
  log "停止本地服务..."
  for pidfile in "$VITE_PID" "$BACKEND_PID" "$PG_PID"; do
    if [ -f "$pidfile" ]; then
      local pid
      pid="$(cat "$pidfile")"
      if kill "$pid" >/dev/null 2>&1; then
        log "已停止进程 $pid ($(basename "$pidfile"))"
      fi
      rm -f "$pidfile"
    fi
  done
  # 兜底：清理可能残留的本地服务进程
  pkill -f "scripts/pg-local.mjs" 2>/dev/null || true
  pkill -f "src/server.js" 2>/dev/null || true
  ok "本地服务已停止"
}

start_local() {
  local fresh=""
  [ "${1:-}" = "--fresh" ] && fresh="--fresh"

  have node || { err "未找到 Node.js (需要 Node 18+)"; exit 1; }
  ensure_node_deps "$BACKEND_DIR"
  ensure_node_deps "$FRONTEND_DIR"

  mkdir -p "$PID_DIR"

  # 若已有运行中的实例，先停掉
  if [ -f "$BACKEND_PID" ] || [ -f "$PG_PID" ]; then
    warn "检测到旧实例，先停止..."
    stop_local
  fi

  log "启动嵌入式 PostgreSQL (端口 $LOCAL_PG_PORT)..."
  (
    cd "$BACKEND_DIR"
    LOCAL_PG_PORT="$LOCAL_PG_PORT" LOCAL_PG_DB="$LOCAL_PG_DB" \
    LOCAL_PG_USER="$LOCAL_PG_USER" LOCAL_PG_PASSWORD="$LOCAL_PG_PASSWORD" \
      node scripts/pg-local.mjs start $fresh
  ) >"$PID_DIR/pg-local.log" 2>&1 &
  echo $! > "$PG_PID"

  # 等待 PG 端口可连接（通过 node 直连测试）
  log "等待 PostgreSQL 就绪..."
  local ready=0
  for _ in $(seq 1 30); do
    if node -e "
      const net=require('net');
      const s=net.connect($LOCAL_PG_PORT,'127.0.0.1');
      s.on('connect',()=>{s.end();process.exit(0)});
      s.on('error',()=>process.exit(1));
      setTimeout(()=>process.exit(1),1000);
    " 2>/dev/null; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" != "1" ]; then
    err "PostgreSQL 启动失败，日志见 $PID_DIR/pg-local.log"
    tail -20 "$PID_DIR/pg-local.log"
    exit 1
  fi
  ok "PostgreSQL 就绪"

  log "启动后端 API (端口 $BACKEND_PORT)..."
  (
    cd "$BACKEND_DIR"
    DATABASE_URL="postgres://$LOCAL_PG_USER:$LOCAL_PG_PASSWORD@127.0.0.1:$LOCAL_PG_PORT/$LOCAL_PG_DB" \
    PORT="$BACKEND_PORT" \
    SEED_ON_START=true \
    SIMULATION_ENABLED=true \
      node src/server.js
  ) >"$PID_DIR/backend.log" 2>&1 &
  echo $! > "$BACKEND_PID"

  if wait_http "http://localhost:$BACKEND_PORT/api/health" 120; then
    ok "后端就绪（已自动初始化主数据与 24h 历史数据）"
  else
    err "后端启动失败，日志见 $PID_DIR/backend.log"
    tail -30 "$PID_DIR/backend.log"
    exit 1
  fi

  log "启动前端 Vite 开发服务器 (端口 $FRONTEND_PORT)..."
  (cd "$FRONTEND_DIR" && npx vite --port "$FRONTEND_PORT" --host) \
    >"$PID_DIR/frontend.log" 2>&1 &
  echo $! > "$VITE_PID"
  sleep 3

  cat <<EOF

  🌐 监测平台:  http://localhost:$FRONTEND_PORT
  🔌 API:       http://localhost:$BACKEND_PORT/api/health
  🗄  嵌入式PG:  127.0.0.1:$LOCAL_PG_PORT/$LOCAL_PG_DB

  实时数据模拟已开启（每 5 秒）。
  日志目录: $PID_DIR/  (pg-local.log / backend.log / frontend.log)
  停止服务: ./start.sh stop
  重置数据: ./start.sh local --fresh
EOF
}

# ---------- 测试 ----------
run_tests() {
  log "运行后端测试（单元 + 真实 PostgreSQL 集成测试）..."
  ensure_node_deps "$BACKEND_DIR"
  (cd "$BACKEND_DIR" && npm test)
  log "运行前端测试与构建..."
  ensure_node_deps "$FRONTEND_DIR"
  (cd "$FRONTEND_DIR" && npm test && npm run build)
  ok "全部测试通过"
}

# ---------- 入口 ----------
ACTION="${1:-auto}"

case "$ACTION" in
  docker)
    have docker || { err "未安装 Docker"; exit 1; }
    start_docker
    ;;
  local)
    start_local "${2:-}"
    ;;
  stop)
    if [ -f "$BACKEND_PID" ] || [ -f "$PG_PID" ] || [ -f "$VITE_PID" ]; then
      stop_local
    elif have docker && $(compose_cmd) ps >/dev/null 2>&1 && [ "$($(compose_cmd) ps -q 2>/dev/null)" ]; then
      stop_docker
    else
      warn "未发现运行中的实例"
    fi
    ;;
  logs)
    $(compose_cmd) logs -f
    ;;
  test)
    run_tests
    ;;
  auto|"")
    if have docker; then
      start_docker
    elif have node; then
      warn "未检测到 Docker，改用本地嵌入式模式"
      start_local
    else
      err "需要 Docker 或 Node.js 18+"
      exit 1
    fi
    ;;
  *)
    echo "未知参数: $ACTION"
    echo "用法: ./start.sh [docker|local [--fresh]|stop|logs|test]"
    exit 1
    ;;
esac
