"""解析 "Main behaviour" 步骤表为结构化步骤（不依赖固定表头）。

各用例的表头排版不一致，因此按结构解析：
1. 定位最后一次出现的 "Main behaviour" 表格；
2. 以行首步骤号切块（无号行 = 续行）；
3. 块内用箭头 (-->/<--/--) 切出「过程 | 方向 | 消息」；
4. 行尾形如 "<TP> <Verdict>" 的部分单独取出。
"""
import json
import sys
import os
import re

STEP_NO = re.compile(r"^\s*(\d{1,3})\s+(?!\d)(.*)$")
TAIL = re.compile(r"\s+(\d{1,3}|-)\s+([PFp]|-)\s*$")
END = re.compile(r"^\s*(Specific message contents|Annex)", re.I)


def _find_start(lines):
    idx = [i for i, ln in enumerate(lines) if "Main behaviour" in ln]
    if not idx:
        return None
    start = idx[0]
    for j in range(start, min(start + 20, len(lines))):
        if STEP_NO.match(lines[j]) and not re.search(r"Table", lines[j]):
            return j
    return start


def _split_arrow(s):
    for token, d in (("-->", "U->S"), ("<--", "S->U"), ("--", "none")):
        k = s.find(token)
        if k >= 0:
            return s[:k], d, s[k + len(token):]
    return s, None, ""


def parse_steps(text):
    lines = text.splitlines()
    start = _find_start(lines)
    if start is None:
        return []

    blocks, cur, prev = [], None, 0
    for ln in lines[start + 1:]:
        if END.match(ln):
            break
        m = STEP_NO.match(ln)
        if m:
            st = int(m.group(1))
            if st <= prev:          # 第二张表重启，停止
                break
            prev = st
            cur = {"st": st, "buf": [m.group(2)]}
            blocks.append(cur)
        elif cur is not None and ln.strip():
            cur["buf"].append(ln.strip())

    steps = []
    for b in blocks:
        joined = " ".join(x.strip() for x in b["buf"] if x.strip())
        joined = re.sub(r"\s+", " ", joined).strip()
        joined = re.sub(r"(U-S|Message Sequence|Message|TP Verdict|Verdict)", " ", joined)
        joined = re.sub(r"\s+", " ", joined).strip()

        head, direction, tail = _split_arrow(joined)

        tp = verdict = None
        m = TAIL.search(tail)
        if m:
            tp, verdict = m.group(1), m.group(2)
            tail = tail[:m.start()]
        if tp is None:
            m = TAIL.search(head)
            if m:
                tp, verdict = m.group(1), m.group(2)
                head = head[:m.start()]

        steps.append({
            "st": b["st"],
            "procedure": head.strip(),
            "direction": direction,
            "message": tail.strip(),
            "tp": tp,
            "verdict": verdict,
        })
    return steps


def main(bench_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for name in sorted(os.listdir(bench_dir)):
        if not re.match(r"^6\..*\.json$", name):
            continue
        with open(os.path.join(bench_dir, name), encoding="utf-8") as f:
            case = json.load(f)
        steps = parse_steps(case["answers"]["test_procedure_sequence"])
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump({"case_id": case["case_id"], "steps": steps}, f,
                      ensure_ascii=False, indent=2)
        rows.append((case["case_id"], len(steps),
                     sum(1 for s in steps if s["direction"] in ("S->U", "U->S")),
                     sum(1 for s in steps if s["message"]),
                     sum(1 for s in steps if s["tp"] and s["tp"] != "-")))

    print(f"{'case':<10}{'steps':>7}{'dir':>6}{'msg':>6}{'tp':>5}")
    for r in rows:
        print(f"{r[0]:<10}{r[1]:>7}{r[2]:>6}{r[3]:>6}{r[4]:>5}")
    print(f"合计 steps={sum(r[1] for r in rows)} dir={sum(r[2] for r in rows)} "
          f"msg={sum(r[3] for r in rows)} tp={sum(r[4] for r in rows)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
