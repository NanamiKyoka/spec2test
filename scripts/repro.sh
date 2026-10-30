#!/usr/bin/env bash
# 一键复现。默认 dry-run 且写入沙箱 data/_repro/，绝不触碰真实结果目录。
#   ./scripts/repro.sh                  # 冒烟 → data/_repro/{out,out_baseline,score,validate}
#   ./scripts/repro.sh --live           # 真实调用，写 data/{out,out_baseline,score}
#   ./scripts/repro.sh --live --force   # 目标目录非空时允许覆盖
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="--dry-run"; LIVE=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --live)   LIVE=1; MODE="" ;;
    --force)  FORCE=1 ;;
    --no-validate) NO_VALIDATE=1 ;;
    *) echo "[warn] 忽略未知参数: $a" ;;
  esac
done

# --- 输出目录：dry-run 一律进沙箱 ---
if [ "$LIVE" = "1" ]; then
  OUTBASE="data"
else
  OUTBASE="data/_repro"
fi
OUT="$OUTBASE/out"; BASEOUT="$OUTBASE/out_baseline"; SCORE="$OUTBASE/score"
GLD="$OUTBASE/gold_ir"; VAL="$OUTBASE/validate"

if [ "$LIVE" = "1" ] && [ "$FORCE" != "1" ]; then
  for d in "$OUT" "$BASEOUT" "$SCORE"; do
    if [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
      echo "[abort] $d 已有内容。真实结果目录不允许被默认覆盖。"
      echo "        确认要覆盖请加 --force；只想冒烟请去掉 --live（将写入 data/_repro）。"
      exit 1
    fi
  done
fi
mkdir -p "$OUT" "$BASEOUT" "$SCORE"
echo "[env] mode=$([ "$LIVE" = "1" ] && echo LIVE || echo DRY-RUN)  outbase=$OUTBASE"

# --- 解释器 ---
if [ -n "${PYTHON:-}" ] && [ -x "${PYTHON}" ]; then :
else
  PYTHON=""
  for cand in \
    "${LOCALAPPDATA:-}/Programs/Python/Python312/python.exe" \
    "C:/Users/${USERNAME:-${USER:-}}/AppData/Local/Programs/Python/Python312/python.exe" \
    "/c/Users/${USERNAME:-${USER:-}}/AppData/Local/Programs/Python/Python312/python.exe" ; do
    if [ -n "$cand" ] && [ -x "$cand" ]; then PYTHON="$cand"; break; fi
  done
fi
if [ -z "${PYTHON:-}" ]; then
  if command -v python3 >/dev/null 2>&1; then PYTHON=python3
  elif command -v python >/dev/null 2>&1; then PYTHON=python
  else echo "[fatal] 未找到 python，请用 PYTHON=/path/to/python 指定"; exit 1; fi
fi
echo "[env] python = $PYTHON"
"$PYTHON" -c "import sys;print('[env] version',sys.version.split()[0])" || { echo "[fatal] python 不可用"; exit 1; }
"$PYTHON" -c "import pdfplumber;print('[env] pdfplumber',pdfplumber.__version__)" \
  || echo "[warn] 未安装 pdfplumber，坐标层抽取会失败：pip install -r requirements.txt"

# --- 输入 ---
PDF="_scratch/spec/v19.pdf"; TXT="_scratch/spec/v19.txt"
if [ ! -f "$PDF" ]; then
  echo "[TODO] 缺少规范 PDF：$PDF"
  echo "       curl -A 'Mozilla/5.0' -L -o $PDF \\"
  echo "         https://www.etsi.org/deliver/etsi_ts/138500_138599/13852301/19.06.00_60/ts_13852301v190600p.pdf"
  exit 1
fi
if [ ! -f "$TXT" ]; then
  command -v pdftotext >/dev/null 2>&1 || { echo "[fatal] 缺 pdftotext（poppler）"; exit 1; }
  pdftotext -layout "$PDF" "$TXT" && echo "[run] pdftotext ok"
fi

run() { # run <label> <script> [args...]
  local label="$1" script="$2"; shift 2
  if [ ! -f "$script" ]; then echo "[TODO] 缺 $script，跳过 $label"; return 0; fi
  echo "[run] $label"
  "$PYTHON" -I "$script" "$@" || echo "[fail] $label（继续）"
}

# --- 抽取（基准与 gold，属于输入侧，固定写 data/） ---
run extract_cases tools/extract_cases.py "$TXT" data/benchmark/v0
run pdf_steps     tools/pdf_steps.py     "$PDF" data/ir/steps_pdf
run pdf_ie        tools/pdf_ie.py        "$PDF" data/ir/ie

# --- 链路 ---
run build_ir tools/build_ir.py data/benchmark/v0 data/ctx
echo "[run] generate ($MODE)"
"$PYTHON" tools/generate.py data/ctx "$OUT" $MODE || echo "[fail] generate"
echo "[run] baseline ($MODE)"
"$PYTHON" tools/baseline.py data/ctx "$BASEOUT" $MODE || echo "[fail] baseline"

echo "[run] score"
"$PYTHON" tools/score.py data/ir/steps_pdf data/ir/ie "$OUT" "$BASEOUT" "$SCORE" \
  || echo "[fail] score"

# --- 校验器误报检查（同样进沙箱） ---
if [ "${NO_VALIDATE:-0}" != "1" ] && [ -f tools/validate.py ]; then
  if [ -f data/symbols/rrc_symbols.json ] && [ -f tools/gold_ir.py ]; then
    run gold_ir tools/gold_ir.py data/ir/steps_pdf data/ir/ie "$GLD" data/ir/v0
    echo "[run] validate(gold)"
    "$PYTHON" tools/validate.py "$GLD" data/symbols/rrc_symbols.json "$VAL/gold.json" \
      || echo "[fail] validate(gold)"
  else
    echo "[TODO] 缺符号表或 tools/gold_ir.py，跳过校验器"
  fi
fi

echo
echo "[done] 产物："
for d in data/benchmark/v0 data/ctx "$OUT" "$BASEOUT" "$SCORE" "$VAL"; do
  [ -d "$d" ] && printf '  %-26s %s files\n' "$d" "$(ls -1 "$d" 2>/dev/null | wc -l | tr -d ' ')"
done
if [ "$LIVE" != "1" ]; then
  echo "[note] 本次为 DRY-RUN，结果在 $OUTBASE，**不可用于报告分数**"
fi
echo "[note] L2 不计分；不报平均数（n=8）。详见 docs/EVAL.md"
