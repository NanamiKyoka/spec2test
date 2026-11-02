"""修复增益 A/B：同一用例「一次生成」vs「自诊断修复后」。

用法：
    py -3.12 scripts/ab_repair.py                        # 全部用例，0 vs 1 轮
    py -3.12 scripts/ab_repair.py --cases 6.7.1.3 --arms 0,1,2

输出 data/ab/repair.json 与同目录 repair.md（逐例对照，不报平均数）。
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
RUN_ONE = os.path.join(HERE, "run_one.py")


def all_cases():
    if not os.path.isdir(BENCH):
        return []
    return sorted(n[:-5] for n in os.listdir(BENCH) if n.endswith(".json"))


def parse_events(lines):
    """把 JSON Lines 汇总成一行指标；失败/弃权如实标注，不补零分。"""
    row = {"L1": None, "L3": None, "violations": None, "violations_before": None,
           "calls": 0, "repair_rounds": 0, "status": "unknown", "verdict": None, "error": ""}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        stage, status = ev.get("stage"), ev.get("status")
        detail = ev.get("detail") or {}
        if stage == "candidates" and status == "skipped":
            row["status"] = "abstained"
        if stage == "generate":
            if status == "failed":
                row["status"] = "failed"
                row["error"] = ev.get("summary") or ""
            else:
                row["calls"] += int(detail.get("calls") or 0)
                row["repair_rounds"] = max(row["repair_rounds"],
                                           int(detail.get("repairs") or 0))
        if stage == "repair":
            row["repair_rounds"] = max(row["repair_rounds"], int(detail.get("round") or 0))
            if row["violations_before"] is None and detail.get("before") is not None:
                row["violations_before"] = int(detail["before"])
        if stage == "score" and status in ("ok", "rejected"):
            row["status"] = "scored"
            row["L1"] = detail.get("L1")
            row["L3"] = detail.get("L3")
            row["violations"] = len(detail.get("violations") or [])
            row["verdict"] = detail.get("verdict")
        if stage == "validate" and status == "rejected":
            row["violations"] = len(detail.get("violations") or [])
            if row["violations_before"] is None:
                row["violations_before"] = row["violations"]
    return row


def run_arm(case, repairs, timeout=1800, ir_file=None):
    t0 = time.time()
    cmd = [sys.executable, RUN_ONE, case, "--mode", "repair_only" if ir_file else "full",
           "--repairs", str(repairs), "--no-write"]
    if ir_file:
        cmd.extend(["--ir-file", ir_file])
    try:
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"case": case, "repairs": repairs, "status": "timeout",
                "seconds": round(time.time() - t0, 1)}
    row = parse_events((proc.stdout or "").splitlines())
    row.update({"case": case, "repairs": repairs, "ir_file": ir_file,
                "seconds": round(time.time() - t0, 1), "exit": proc.returncode})
    if proc.returncode != 0 and row["status"] == "unknown":
        row["status"] = "failed"
    return row


def run_defects(defect_dir, arms, repairs_cap, timeout=1800, limit=0, on_row=None):
    """缺陷注入集：直接对已知缺陷 IR 做「不修 vs 修 N 轮」，属于受控修复增益。"""
    rows = []
    names = sorted(n for n in os.listdir(defect_dir)
                   if n.endswith(".json") and not n.startswith("_"))
    if limit:
        names = names[:limit]
    for name in names:
        path = os.path.join(defect_dir, name)
        try:
            with open(path, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            continue
        if not isinstance(meta, dict):
            continue
        case = meta.get("case_id") or name.split("_")[0]
        for n in arms:
            r = run_arm(case, min(n, repairs_cap), timeout, ir_file=path)
            r.update({"defect": name, "expected_rule": meta.get("_expected_rule"),
                      "defect_note": meta.get("_defect")})
            rows.append(r)
            if on_row:
                on_row(rows)
    return rows


def delta(base, after):
    def diff(a, b):
        return None if a is None or b is None else round(b - a, 3)
    return {"L1": diff(base.get("L1"), after.get("L1")),
            "L3": diff(base.get("L3"), after.get("L3")),
            "violations": diff(base.get("violations"), after.get("violations"))}


def to_markdown(rows):
    lines = ["| 用例 | 修复轮数 | 判定 | L1 | L3 | 违规 | 模型调用 | 用时(s) |",
             "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append("| %s | %s | %s | %s | %s | %s | %s | %s |" % (
            r.get("case"), r.get("repairs"), r.get("status"),
            "—" if r.get("L1") is None else r["L1"],
            "—" if r.get("L3") is None else r["L3"],
            "—" if r.get("violations") is None else r["violations"],
            r.get("calls", "—"), r.get("seconds", "—")))
    return "\n".join(lines)


def to_defect_markdown(rows):
    lines = ["| 缺陷 | 期望规则 | 修复轮数 | 修复前违规 | 修复后违规 | 判定 | 用时(s) |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        before = r.get("violations_before")
        after = r.get("violations")
        lines.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            r.get("defect"), r.get("expected_rule") or "—", r.get("repairs"),
            "—" if before is None else before,
            "—" if after is None else after,
            r.get("status"), r.get("seconds")))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="", help="逗号分隔；空=全部用例")
    ap.add_argument("--arms", default="0,1", help="修复轮数列表，如 0,1,2")
    ap.add_argument("--defects", default="", help="缺陷 IR 目录；给了就只跑受控修复增益")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 个缺陷（0=全部）")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--out", default=os.path.join(OUT_DIR, "repair.json"))
    a = ap.parse_args()

    arms = [int(x) for x in a.arms.split(",") if x.strip().isdigit()]
    if not arms:
        print("没有可跑的轮数", file=sys.stderr)
        return 1

    if a.defects:
        partial = os.path.splitext(a.out)[0] + ".partial.json"

        def save_partial(rows):
            try:
                os.makedirs(os.path.dirname(partial) or ".", exist_ok=True)
                with open(partial, "w", encoding="utf-8") as f:
                    json.dump({"mode": "defects", "rows": rows}, f, ensure_ascii=False)
            except Exception:
                pass

        rows = run_defects(a.defects, arms, max(arms), a.timeout, a.limit, save_partial)
        payload = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
                   "mode": "defects", "defects": a.defects, "arms": arms, "rows": rows}
        md = to_defect_markdown(rows)
    else:
        cases = [c.strip() for c in a.cases.split(",") if c.strip()] or all_cases()
        if not cases:
            print("没有可跑的用例", file=sys.stderr)
            return 1
        rows = []
        for case in cases:
            for n in arms:
                print("[run] %s repairs=%d" % (case, n), file=sys.stderr, flush=True)
                rows.append(run_arm(case, n, a.timeout))

        by_case = {}
        for r in rows:
            by_case.setdefault(r["case"], {})[r["repairs"]] = r
        comparisons = []
        for case, arms_of in by_case.items():
            base = arms_of.get(min(arms))
            for n in arms:
                if n == min(arms) or n not in arms_of or base is None:
                    continue
                comparisons.append({"case": case, "from": min(arms), "to": n,
                                    "delta": delta(base, arms_of[n])})
        payload = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": "cases",
                   "cases": cases, "arms": arms, "rows": rows, "deltas": comparisons}
        md = to_markdown(rows)
        md += "\n\n## 修复前后差值（逐例）\n\n| 用例 | 轮数 | ΔL1 | ΔL3 | Δ违规 |\n|---|---|---|---|---|\n"
        for c in comparisons:
            d = c["delta"]
            md += "| %s | %s→%s | %s | %s | %s |\n" % (
                c["case"], c["from"], c["to"],
                "—" if d["L1"] is None else d["L1"],
                "—" if d["L3"] is None else d["L3"],
                "—" if d["violations"] is None else d["violations"])

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    with open(os.path.splitext(a.out)[0] + ".md", "w", encoding="utf-8") as f:
        f.write(md + "\n")

    print(md)
    print("\n结果写入 %s（Markdown 同目录）" % a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
