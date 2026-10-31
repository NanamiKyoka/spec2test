# Spec2Test — 自证式测试意图编译器

把 3GPP 规范条款编译成可执行的测试意图（测试步骤 + 具体信令内容），并用**确定性校验器**对生成结果自检、判错。当前在 **TS 38.523-1 §6.7 NR NTN**（非地面网络）的 8 个一致性测试用例上验证。

> 本项目不含规范原文（ADR-0003）。你从 ETSI 下载公开 PDF，用本仓库脚本重放整条流水线——**可复现性是本作品唯一的真实性佐证**。

## 三步启动

```
1) 双击 start.bat              （或：py -3.12 scripts\serve.py）
2) 浏览器打开 http://127.0.0.1:8000/web/
3) 想自己重跑数据：bash scripts/repro.sh
```

仓库自带 `results/` 结果快照，**没有 `data/` 也能直接看到页面**；页面会提示"当前显示的是快照"。
`data/` 由 `scripts/repro.sh` 生成，存在时自动优先使用。

## 目录

```
tools/     核心链路：切分/抽取/生成/校验/评分（纯 Python，无框架）
docs/      决策与报告（ADR、基线、评测定义、架构边界）
web/       单页结果浏览器（无框架、无外链）
scripts/   一键复现与静态服务
results/   结果快照（入库；无 data/ 时页面读这里）
data/      运行产物（不入库）
```

## 依赖

- **Python 3.12**（pdfplumber 需要能装 wheel 的解释器）
- `pdfplumber==0.11.10`（`pip install -r requirements.txt`）
- `pdftotext`（poppler；只用于 TP 与条款的文本层）

⚠️ **不要用 MSYS2 自带的 python**：它是 3.11 且缺 pip 的 wheel 支持，装 pdfplumber 会报 `Unsupported platform: 311`。请用官方安装版（安装时勾选 Add to PATH），`start.bat` 会自动探测 `py -3.12`、官方安装路径或 `python`。

## 一键复现（推荐）

```bash
./scripts/repro.sh                    # 冒烟：全链路 dry-run，写 data/_repro/
./scripts/repro.sh --live             # 真实调用模型，写 data/
./scripts/repro.sh --live --force     # 目标目录非空时允许覆盖
./scripts/repro.sh --no-validate      # 跳过校验器误报检查
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\repro.ps1
powershell -ExecutionPolicy Bypass -File scripts\repro.ps1 -Live -Force
```

> ⚠️ **dry-run 的结果是桩数据，不可用于报告分数。** 默认模式只写 `data/_repro/`（out / out_baseline / score / validate），不会触碰真实结果目录 `data/out`、`data/out_baseline`、`data/score`；只有 `--live` 才写真实目录，且目标非空时必须显式 `--force`。

脚本会自检解释器、检查 `_scratch/spec/v19.pdf` 是否存在、按序调用各步，缺件只打印 `[TODO]` 并继续，最后汇总产物目录。

## 四步复现（手动）

```bash
# 0) 准备（仅一次）：用能 import pdfplumber 的 Python 3.12
export PYTHON="${PYTHON:-python}"   # 若默认 python 不是 3.12，改为 py -3.12 或官方安装路径
mkdir -p _scratch/spec && cd _scratch/spec

# 1) 下载规范（公开，ETSI 镜像）
curl -A "Mozilla/5.0" -L -o v19.pdf \
  "https://www.etsi.org/deliver/etsi_ts/138500_138599/13852301/19.06.00_60/ts_13852301v190600p.pdf"
pdftotext -layout v19.pdf v19.txt
cd ../..

# 2) 切分用例（文本层）+ 抽取基准（坐标层）
"$PYTHON" tools/extract_cases.py _scratch/spec/v19.txt data/benchmark/v0
"$PYTHON" tools/pdf_steps.py     _scratch/spec/v19.pdf  data/ir/steps_pdf
"$PYTHON" tools/pdf_ie.py        _scratch/spec/v19.pdf  data/ir/ie

# 3) 跑链路（默认 dry-run，不调模型）
"$PYTHON" tools/build_ir.py  data/benchmark/v0 data/ctx
"$PYTHON" tools/generate.py  data/ctx data/out          --dry-run
"$PYTHON" tools/baseline.py  data/ctx data/out_baseline --dry-run

# 4) 评分（L1 合法率 / L3 IE recall；L2 只做定性对照）
"$PYTHON" tools/score.py data/ir/steps_pdf data/ir/ie data/out data/out_baseline data/score
```

### 预期输出（2026-10-29 实测，数字随版本可能小幅变动）

| 命令 | 输出 |
|---|---|
| `extract_cases.py` | `cases=8` + 逐例字数 |
| `pdf_steps.py` | 逐例表，末行 `合计 steps=59 dir=16 msg=...` |
| `pdf_ie.py` | 逐例表，末行 `合计 tables=25 ies=42` |
| `build_ir.py` | `contexts=8 chars=29558 max=4430` |
| `generate.py` | `DRY-RUN generated=8 errors=0 provider=proxy model=claude-sonnet-4-6[1M] temp=0 max_tokens=16384` |
| `baseline.py` | `DRY-RUN baseline=8 empty=0 ...` |
| `score.py` | 逐例 `L1 / L1_base / L3 / L3_base / gold_ie_n` 表 + 一行说明 |

> dry-run 用确定性桩，**只证明链路通，不证明效果**；真实数字需 `--live`（见下）。

## 可选步骤：校验器与缺陷注入

```bash
# 符号表：需先下载 TS 38.331 到 _scratch/spec331/t38331.pdf
"$PYTHON" tools/build_symbols.py _scratch/spec331/t38331.pdf data/symbols/rrc_symbols.json

# 金标 IR（把官方答案组装成 IR），并对它跑校验器——误报必须为 0
"$PYTHON" tools/gold_ir.py data/ir/steps_pdf data/ir/ie data/gold_ir data/ir/v0
"$PYTHON" tools/validate.py data/gold_ir data/symbols/rrc_symbols.json data/validate/gold.json

# 缺陷注入 → 用检出去算校验器的缺陷检出率
"$PYTHON" tools/inject.py data/gold_ir data/defects
"$PYTHON" tools/validate.py data/defects data/symbols/rrc_symbols.json data/validate/defects.json
```

实测：金标 `files=8 violations=0`（无误报）。

## 智能解读与自然语言输入

- `tools/explain.py <case...>`：用当前模型通道为每个用例生成"结果 + 数据"的自然语言解读，写入
  `data/explain/` 与 `results/explain/`。页面优先读 `data/`，缺失时回落到 `results/` 快照。
- 对话页的模糊输入（如「你好」「卫星小区被禁止」）由 `POST /api/chat` 交给模型判断：
  能对上用例就返回用例号并执行，对不上就用自然语言引导；精确用例号仍走本地快速路径。
- `results/symbols/rrc_symbols.json` 是符号表快照，保证没有 `data/` 时字段证据抽屉仍可用。

## 测试与 CI

```bash
# 后端：静态路径安全、任务持久化、会话并发、HTTP 冒烟
py -3.12 -m pip install -r requirements-dev.txt
py -3.12 -m pytest -q

# 前端：类型检查 + 构建 + 浏览器冒烟（需先启动 scripts/serve.py）
cd app && npm ci && npm run build && npm run smoke
```

CI（`.github/workflows/ci.yml`）在 **push `main` 与 pull request** 时触发，跑三组：后端 `py_compile` + pytest、前端构建、Playwright UI 冒烟（6 条路由 + 外部请求/console 断言；Windows 用 Edge，Linux 用 chromium）。

## 模型通道（三选一，禁止写死）

| `LLM_PROVIDER` | 需要的环境变量 | 说明 |
|---|---|---|
| `proxy`（默认） | `LLM_SESSION`（任意 uuid） | 本地 OpenCode 代理 `http://127.0.0.1:15721/v1/messages`，**必须带 `x-opencode-session` 头** |
| `openai` | `LLM_API_KEY`、可选 `LLM_BASE_URL`/`LLM_MODEL` | 任意 OpenAI 兼容（如 DeepSeek 官方） |
| `anthropic` | `ANTHROPIC_API_KEY` | Anthropic 官方 |

```bash
"$PYTHON" tools/test_llm.py --dry-run   # 三通道配置自检，缺 key 会 [skip] 而不是报错
"$PYTHON" tools/generate.py data/ctx data/out --live
```

**对比实验必须同通道、同模型、同温度**，否则"比裸 prompt 强"的结论不成立。

## 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| `Unsupported platform: 311` | 用了 MSYS2 的 python | 换官方 Python 3.12 |
| `MissingSessionID` | 直连代理但没带 `x-opencode-session` | 加该头，或用 `LLM_PROVIDER=openai` |
| 下载得到的是 HTML | `aicomp.cn` 附件中文名需 URL 编码 + 浏览器 UA | 用编码后的 URL 并加 `-A` |
| `pdfplumber` 表格为空 | 该页表格无框线或跨页 | 检查是否用了坐标层脚本（不要用文本层解析表格） |
| 中文提示行显示为乱码 | Windows PowerShell 5.1 控制台编码 | 仅影响提示文字；数字与结果以 `data/**/*.json` 为准。或先 `chcp 65001` |

## 已知限制（务必先读）

- **样本量 8，不报平均数**，只报逐例矩阵——8 个样本没有统计意义。
- L2（消息序列）**不计分**：全库仅 16 个交换，无区分度（ADR-0004）。
- L3 分母为 7（6.7.1.1 原文信令表为 `None`）。
- TP 与条款取自文本层，步骤表与 IE 表取自坐标层，两层结果不可混用。

细节见 `docs/`：`BASELINE.md`（基线）、`BENCHMARK.md`（基准）、`EVAL.md`（指标定义）、`ARCH.md`（模块边界）、`adr/`（决策记录）。
