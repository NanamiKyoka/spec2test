"""编排消融：固定六阶段管线 vs 模型自由编排。

用法：
    py -3.12 scripts/ab_orchestrate.py                 # 全部用例
    py -3.12 scripts/ab_orchestrate.py --cases 6.7.1.3 --free-budget 6

指标：判定分布、成功率、弃权率、模型调用数、耗时。逐例列出，不报质量平均数。
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BENCH = os.path.join(ROOT, "data", "benchmark", "v0")
OUT_DIR = os.path.join(ROOT, "data", "ab")

sys.path.insert(0, HERE)
from ab_repair import parse_events  # noqa: E402


def all_cases():
    if not os.path.isdir(BENCH):
        return []
    return sorted(n[:-5] for n in os.listdir(BENCH) if n.endswith(".json"))


def parse_free(lines):
    row = {"L1": None, "L3": None, "violations": None, "calls": 0,
           "tool_calls": 0, "status": "unknown", "verdict": None}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get("stage") == "agent" and ev.get("status") in ("ok", "skipped", "failed"):
            row["tool_calls"] += 1
        if ev.get("stage") == "score":
            d = ev.get("detail") or {}
            row["status"] = "scored"
            row["L1"] = d.get("L1")
            row["L3"] = d.get("L3")
            row["violations"] = len(d.get("violations") or [])
            row["calls"] = int(d.get("calls") or 0)
            row["verdict"] = d.get("verdict")
    return row


def run(cmd, timeout, parse):
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "seconds": round(time.time() - t0, 1)}
    row = parse((proc.stdout or "").splitlines())
    row["seconds"] = round(time.time() - t0, 1)
    row["exit"] = proc.returncode
    return row


def run_fixed(case, timeout):
    return run([sys.executable, os.path.join(HERE, "run_one.py"), case,
                "--mode", "full", "--repairs", "1", "--no-write"], timeout, parse_events)


def run_free(case, budget, timeout):
    return run([sys.executable, os.path.join(HERE, "orchestrate.py"), case,
                "--max-steps", str(budget)], timeout, parse_free)


def summarize(rows):
    total = len(rows) or 1
    out = {"total": len(rows), "pass": 0, "reject": 0, "abstained": 0, "failed": 0,
           "calls": 0, "seconds": round(sum(r.get("seconds") or 0 for r in rows), 1)}
    for r in rows:
        v = r.get("verdict")
        if not v and r.get("status") == "abstained":
            v = "abstained"
        if r.get("status") in ("timeout",):
            v = "failed"
        if v == "pass":
            out["pass"] += 1
        elif v == "reject":
            out["reject"] += 1
        elif v == "abstained":
            out["abstained"] += 1
        else:
            out["failed"] += 1
        out["calls"] += int(r.get("calls") or 0)
    out["success_rate"] = round(out["pass"] / total, 3)
    out["abstain_rate"] = round(out["abstained"] / total, 3)
    return out


def to_md(rows):
    lines = ["| 用例 | 固定管线 | 自由编排 |", "|---|---|---|"]
    for r in rows:
        f, fr = r["fixed"], r["free"]
        lines.append("| %s | %s / L1 %s / L3 %s / 调用 %s / %ss | %s / L1 %s / L3 %s / 调用 %s / %ss |" % (
            r["case"],
            f.get("verdict") or f.get("status"), f.get("L1"), f.get("L3"),
            f.get("calls", "—"), f.get("seconds"),
            fr.get("verdict") or fr.get("status"), fr.get("L1"), fr.get("L3"),
            fr.get("calls", "—"), fr.get("seconds")))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="", help="逗号分隔；空=全部用例")
    ap.add_argument("--free-budget", type=int, default=8, help="自由编排的工具调用上限")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--out", default=os.path.join(OUT_DIR, "orchestration.json"))
    a = ap.parse_args()

    cases = [c.strip() for c in a.cases.split(",") if c.strip()] or all_cases()
    if not cases:
        print("没有可跑的用例", file=sys.stderr)
        return 1

    rows = []
    for case in cases:
        print("[run] %s fixed" % case, file=sys.stderr, flush=True)
        fixed = run_fixed(case, a.timeout)
        print("[run] %s free(budget=%d)" % (case, a.free_budget), file=sys.stderr, flush=True)
        free = run_free(case, a.free_budget, a.timeout)
        rows.append({"case": case, "fixed": fixed, "free": free})

    payload = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "free_budget": a.free_budget,
        "rows": rows,
        "summary": {
            "fixed": summarize([r["fixed"] for r in rows]),
            "free": summarize([r["free"] for r in rows]),
        },
    }
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    s = payload["summary"]
    md = to_md(rows)
    md += ("\n\n## 对照汇总\n\n| 组 | 通过 | 拒收 | 弃权 | 失败 | 成功率 | 弃权率 | 模型调用合计 | 耗时合计(s) |\n"
           "|---|---|---|---|---|---|---|---|---|\n")
    for name, key in (("固定管线", "fixed"), ("自由编排", "free")):
        m = s[key]
        md += "| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n" % (
            name, m["pass"], m["reject"], m["abstained"], m["failed"],
            m["success_rate"], m["abstain_rate"], m["calls"], m["seconds"])
    with open(os.path.splitext(a.out)[0] + ".md", "w", encoding="utf-8") as f:
        f.write(md + "\n")

    print(md)
    print("\n结果写入 %s（Markdown 同目录）" % a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
