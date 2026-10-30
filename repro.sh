#!/usr/bin/env bash
# 复现流水线：从官方 PDF 重建基准 → 生成 → 校验 → 计分 → 弃权统计 → 一致性自检
set -euo pipefail
cd "$(dirname "$0")"

PY="${PY:-python}"
SPEC="${SPEC:-_scratch/spec/v19.pdf}"

echo "[1/6] 基准（需要规范 PDF 与 pdftotext）"
[ -f _scratch/spec/v19.txt ] || pdftotext -layout "$SPEC" _scratch/spec/v19.txt
"$PY" tools/extract_cases.py _scratch/spec/v19.txt data/benchmark/v0
"$PY" tools/pdf_steps.py "$SPEC" data/ir/steps_pdf
"$PY" tools/pdf_ie.py "$SPEC" data/ir/ie
"$PY" tools/leaf_ies.py

echo "[2/6] 生成（需 LLM 凭据）"
"$PY" tools/generate.py data/ctx data/out

echo "[3/6] 校验"
"$PY" tools/validate.py data/out data/symbols/rrc_symbols.json data/validate/report.json
"$PY" tools/validate.py data/gold_ir data/symbols/rrc_symbols.json data/validate/gold_report.json
"$PY" tools/validate.py data/defects data/symbols/rrc_symbols.json data/validate/defects_report.json

echo "[4/6] 计分"
"$PY" tools/score.py data/ir/steps_pdf data/ir/ie data/out data/out_baseline data/score

echo "[5/6] 弃权统计"
"$PY" tools/abstain_report.py

echo "[6/6] 一致性自检"
"$PY" tools/check_consistency.py
