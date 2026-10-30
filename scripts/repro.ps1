# 一键复现。默认 dry-run 写入沙箱 data\_repro\，不触碰真实结果目录。
#   powershell -File scripts\repro.ps1
#   powershell -File scripts\repro.ps1 -Live
#   powershell -File scripts\repro.ps1 -Live -Force
param(
  [switch]$Live,
  [switch]$Force,
  [switch]$NoValidate
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
& chcp 65001 > $null

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Mode = if ($Live) { "" } else { "--dry-run" }

# --- 输出目录：dry-run 一律进沙箱 ---
$OutBase = if ($Live) { "data" } else { "data/_repro" }
$Out     = Join-Path $OutBase "out"
$BaseOut = Join-Path $OutBase "out_baseline"
$Score   = Join-Path $OutBase "score"
$Gold    = Join-Path $OutBase "gold_ir"
$Val     = Join-Path $OutBase "validate"

if ($Live -and -not $Force) {
  foreach ($d in @($Out, $BaseOut, $Score)) {
    if ((Test-Path $d) -and (Get-ChildItem $d -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      Write-Host "[abort] $d 已有内容。真实结果目录不允许被默认覆盖。"
      Write-Host "        确认覆盖请加 -Force；只想冒烟请去掉 -Live（将写入 data/_repro）。"
      exit 1
    }
  }
}
foreach ($d in @($Out, $BaseOut, $Score)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
Write-Host ("[env] mode={0}  outbase={1}" -f ($(if ($Live) {"LIVE"} else {"DRY-RUN"})), $OutBase)

# --- 解释器 ---
$Python = $env:PYTHON
if (-not $Python -or -not (Test-Path $Python)) {
  $cand = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
  if (Test-Path $cand) { $Python = $cand } else { $Python = "python" }
}
Write-Host "[env] python = $Python"
& $Python -c "import sys;print('[env] version',sys.version.split()[0])"
if ($LASTEXITCODE -ne 0) { Write-Host "[fatal] python 不可用"; exit 1 }

& $Python -c "import pdfplumber;print('[env] pdfplumber',pdfplumber.__version__)"
if ($LASTEXITCODE -ne 0) { Write-Host "[warn] 未装 pdfplumber：pip install -r requirements.txt" }

# --- 输入 ---
$Pdf = "_scratch/spec/v19.pdf"
$Txt = "_scratch/spec/v19.txt"
if (-not (Test-Path $Pdf)) {
  Write-Host "[TODO] 缺少规范 PDF：$Pdf"
  Write-Host "       curl -A 'Mozilla/5.0' -L -o $Pdf https://www.etsi.org/deliver/etsi_ts/138500_138599/13852301/19.06.00_60/ts_13852301v190600p.pdf"
  exit 1
}
if (-not (Test-Path $Txt)) {
  if (Get-Command pdftotext -ErrorAction SilentlyContinue) {
    & pdftotext -layout $Pdf $Txt; Write-Host "[run] pdftotext ok"
  } else { Write-Host "[fatal] 缺 pdftotext（poppler）"; exit 1 }
}

function Invoke-Step {
  param([string]$Label, [string]$Script, [string[]]$ArgList)
  if (-not (Test-Path $Script)) { Write-Host "[TODO] 缺 $Script，跳过 $Label"; return }
  Write-Host "[run] $Label"
  & $Python -I $Script @ArgList
  if ($LASTEXITCODE -ne 0) { Write-Host "[fail] $Label（继续）" }
}

# --- 抽取（输入侧，固定写 data/） ---
Invoke-Step "extract_cases" "tools/extract_cases.py" @($Txt, "data/benchmark/v0")
Invoke-Step "pdf_steps"     "tools/pdf_steps.py"     @($Pdf, "data/ir/steps_pdf")
Invoke-Step "pdf_ie"        "tools/pdf_ie.py"        @($Pdf, "data/ir/ie")

# --- 链路 ---
Invoke-Step "build_ir" "tools/build_ir.py" @("data/benchmark/v0", "data/ctx")

$g = @("data/ctx", $Out);          if ($Mode) { $g += $Mode }
Invoke-Step "generate" "tools/generate.py" $g
$b = @("data/ctx", $BaseOut);      if ($Mode) { $b += $Mode }
Invoke-Step "baseline" "tools/baseline.py" $b

Invoke-Step "score" "tools/score.py" @("data/ir/steps_pdf", "data/ir/ie", $Out, $BaseOut, $Score)

# --- 校验器误报检查（沙箱） ---
if (-not $NoValidate -and (Test-Path "tools/validate.py")) {
  if ((Test-Path "data/symbols/rrc_symbols.json") -and (Test-Path "tools/gold_ir.py")) {
    Invoke-Step "gold_ir" "tools/gold_ir.py" @("data/ir/steps_pdf", "data/ir/ie", $Gold, "data/ir/v0")
    $valOut = Join-Path $Val "gold.json"
    Invoke-Step "validate(gold)" "tools/validate.py" @($Gold, "data/symbols/rrc_symbols.json", $valOut)
  } else {
    Write-Host "[TODO] 缺符号表或 tools/gold_ir.py，跳过校验器"
  }
}

Write-Host ""
Write-Host "[done] 产物："
foreach ($d in @("data/benchmark/v0","data/ctx",$Out,$BaseOut,$Score,$Val)) {
  if (Test-Path $d) {
    $n = (Get-ChildItem $d -File -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Host ("  {0,-26} {1} files" -f $d, $n)
  }
}
if (-not $Live) { Write-Host "[note] 本次为 DRY-RUN，结果在 $OutBase，**不可用于报告分数**" }
Write-Host "[note] L2 不计分；不报平均数（n=8）。详见 docs/EVAL.md"
