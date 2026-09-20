#!/usr/bin/env bash
# 水泥生产排放监测平台 - 一键启动脚本
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "错误: 未检测到 Docker，请先安装 Docker。" >&2
  exit 1
fi

# 兼容 docker compose 插件与旧版 docker-compose
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "错误: 未检测到 docker compose。" >&2
  exit 1
fi

echo "==> 构建并启动服务（PostgreSQL + 后端 + 前端）..."
$COMPOSE up -d --build

echo "==> 等待后端健康检查通过..."
for i in $(seq 1 60); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "后端启动超时，请执行 '$COMPOSE logs server' 查看日志。" >&2
    exit 1
  fi
  sleep 2
done

echo ""
echo "启动完成！"
echo "  前端界面:  http://localhost:8080"
echo "  后端 API:  http://localhost:3000/api"
echo "  健康检查:  http://localhost:3000/api/health"
echo ""
echo "常用命令:"
echo "  查看日志:  $COMPOSE logs -f"
echo "  停止服务:  $COMPOSE down"
echo "  清空数据:  $COMPOSE down -v"
