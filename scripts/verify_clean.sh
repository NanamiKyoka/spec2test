#!/usr/bin/env bash
# 干净克隆验收：clone → 起服务 → 健康检查 → 可选 UI 冒烟 → 清理。
# 用法：./scripts/verify_clean.sh [--port 8019] [--no-smoke]
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-$((18000 + RANDOM % 2000))}"
SMOKE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --no-smoke) SMOKE=0; shift ;;
    *) echo "[warn] 忽略未知参数: $1"; shift ;;
  esac
done

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  for cand in python python3; do
    if command -v "$cand" >/dev/null 2>&1 \
      && "$cand" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,9) else 1)" >/dev/null 2>&1; then
      PYTHON="$cand"
      break
    fi
  done
fi
if [ -z "$PYTHON" ]; then
  echo "[fatal] 未找到可用的 Python 3.9+，请用 PYTHON=/path/to/python 指定"
  exit 1
fi
echo "[env] python = $PYTHON ($("$PYTHON" -c 'import sys;print(sys.version.split()[0])'))"

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t spec2test)"
PID=""
cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null
    if command -v taskkill >/dev/null 2>&1; then
      taskkill //PID "$PID" //T //F >/dev/null 2>&1 || true
    fi
    wait "$PID" 2>/dev/null
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    rm -rf "$TMP" 2>/dev/null && break
    sleep 0.2
  done
}
trap cleanup EXIT INT TERM

echo "[1/5] clone → $TMP/repo"
git clone --quiet "$ROOT" "$TMP/repo" || { echo "[fail] clone"; exit 1; }
CLONE="$TMP/repo"
[ -d "$CLONE/results" ] || { echo "[fail] 缺少 results/ 快照"; exit 1; }
[ -f "$CLONE/web/index.html" ] || { echo "[fail] 缺少 web/index.html"; exit 1; }
[ ! -d "$CLONE/data" ] || echo "[warn] data/ 意外存在（不影响验收）"

echo "[2/5] 启动服务 :$PORT"
if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/api/health"; then
  echo "[fail] 端口 $PORT 已被占用，请换 --port"
  exit 1
fi
( cd "$CLONE" && exec "$PYTHON" scripts/serve.py --port "$PORT" --no-browser >"$TMP/serve.log" 2>&1 ) &
PID=$!

echo "[3/5] 等待健康检查"
ready=0
for i in $(seq 1 100); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
  [ "$code" = "200" ] && ready=1 && break
  sleep 0.2
done
if [ "$ready" != "1" ]; then
  echo "[fail] 服务未就绪"
  cat "$TMP/serve.log"
  exit 1
fi

echo "[4/5] 检查页面与数据来源"
curl -sf "http://127.0.0.1:$PORT/api/health" | grep -q '"data_source": "snapshot"' \
  || { echo "[fail] data_source 不是 snapshot"; curl -s "http://127.0.0.1:$PORT/api/health"; echo; exit 1; }
for p in /web/ /web/index.html /results/score/report.json; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$p")
  [ "$code" = "200" ] || { echo "[fail] $p -> $code"; exit 1; }
done

echo "[4b/5] 校验快照：gold 误报 / 缺陷检出"
( cd "$CLONE" && "$PYTHON" -c "import json;g=json.load(open('results/validate/gold.json',encoding='utf-8'));d=json.load(open('results/validate/defects_report.json',encoding='utf-8'));gv=sum(len(x.get('violations') or []) for x in g);dv=sum(1 for x in d if x.get('violations'));assert gv==0;assert dv==len(d)==31;print('[ok] gold violations=%d; defects %d/%d'%(gv,dv,len(d)))" ) \
  || { echo "[fail] 校验快照不一致"; exit 1; }

if [ "$SMOKE" = "1" ] && [ -d "$ROOT/app/node_modules" ] && command -v npm >/dev/null 2>&1; then
  echo "[5/5] Playwright 冒烟"
  ( cd "$ROOT/app" && SMOKE_BASE="http://127.0.0.1:$PORT" npm run smoke ) || { echo "[fail] smoke"; exit 1; }
else
  echo "[5/5] 跳过 UI 冒烟（缺少 app/node_modules 或 npm）；页面与快照检查已完成"
fi

echo "[ok] clean-clone PASS"
