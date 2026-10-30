"""把 TS 38.523-1 的 §6.7 NTN 用例切成结构化 benchmark。

输入: v19.txt (pdftotext -layout 输出)
输出: data/benchmark/v0/<case>.json + cases.jsonl
"""
import json
import re
import sys
import os

CASE_IDS = [
    "6.7.1.1", "6.7.1.2", "6.7.1.3", "6.7.1.4",
    "6.7.1.5", "6.7.1.6", "6.7.1.10", "6.7.1.12",
]

PAGE_NOISE = re.compile(
    r"^\s*(3GPP TS 38\.523-1 version .*ETSI TS 138 523-1.*|ETSI\s*)$"
)


def clean(lines):
    out = [ln.rstrip() for ln in lines if not PAGE_NOISE.match(ln)]
    # 合并连续空行
    res, blank = [], False
    for ln in out:
        if not ln.strip():
            if blank:
                continue
            blank = True
        else:
            blank = False
        res.append(ln)
    return res


def find_case_span(lines, cid):
    """返回该用例标题行到下一个同级标题行之间的行区间。"""
    head = re.compile(r"^\s*" + re.escape(cid) + r"\s{2,}(?!\d)(.*)$")
    next_head = re.compile(r"^\s*6\.7(\.[0-9]+){2}\s{2,}(?!\d)")
    start = None
    for i, ln in enumerate(lines):
        if head.match(ln):
            start = i
            break
    if start is None:
        return None, None
    for j in range(start + 1, len(lines)):
        if next_head.match(lines[j]) or re.match(r"^\s*Annex\b", lines[j]):
            return start, j
    return start, len(lines)


def split_sections(block, cid):
    """按 x.y.z.1/.2/.3 切分。"""
    marks = [
        (re.compile(r"^\s*" + re.escape(cid) + r"\.1\s+Test Purpose"), "test_purpose"),
        (re.compile(r"^\s*" + re.escape(cid) + r"\.2\s+Conformance requirements"), "conformance"),
        (re.compile(r"^\s*" + re.escape(cid) + r"\.3\s+Test description"), "test_description"),
    ]
    idx = {}
    for i, ln in enumerate(block):
        for pat, name in marks:
            if name not in idx and pat.match(ln):
                idx[name] = i
    order = [(idx[n], n) for n in ("test_purpose", "conformance", "test_description") if n in idx]
    order.sort()
    out = {}
    for k, (pos, name) in enumerate(order):
        end = order[k + 1][0] if k + 1 < len(order) else len(block)
        out[name] = block[pos + 1:end]
    return out


def split_description(lines):
    """Test description 内再切 前置条件/步骤序列/具体信令内容。"""
    pats = [
        (re.compile(r"Pre-test conditions", re.I), "pre_test_conditions"),
        (re.compile(r"Test procedure sequence", re.I), "test_procedure_sequence"),
        (re.compile(r"Specific message contents", re.I), "specific_message_contents"),
    ]
    idx = {}
    for i, ln in enumerate(lines):
        for pat, name in pats:
            if name not in idx and pat.search(ln):
                idx[name] = i
    order = sorted((pos, n) for n, pos in idx.items())
    out = {}
    for k, (pos, name) in enumerate(order):
        end = order[k + 1][0] if k + 1 < len(order) else len(lines)
        out[name] = lines[pos + 1:end]
    return out


def title_of(block, cid):
    """用例标题可能跨行，遇到下一个 x.y.z 标题即停。"""
    stop = re.compile(r"^\s*6\.7(\.\d+){2,3}\s")
    parts = []
    for ln in block[:5]:
        if stop.match(ln) and ln.strip() and not re.match(r"^\s*" + re.escape(cid) + r"\s", ln):
            break
        s = ln.strip()
        if not s:
            continue
        parts.append(re.sub(r"^\s*" + re.escape(cid) + r"\s+", "", ln).strip())
    return " ".join(p for p in parts if p)


def text(lines):
    return "\n".join(lines).strip()


def main(src, outdir):
    with open(src, encoding="utf-8", errors="replace") as f:
        lines = clean(f.read().splitlines())

    # 只在正文里找：从 "6.7 Non-Terrestrial Network" 之后
    body_start = next(i for i, ln in enumerate(lines) if re.match(r"^6\.7\s+Non-Terrestrial", ln))
    body = lines[body_start:]

    os.makedirs(outdir, exist_ok=True)
    records = []
    for cid in CASE_IDS:
        s, e = find_case_span(body, cid)
        if s is None:
            print(f"[MISS] {cid}", file=sys.stderr)
            continue
        block = body[s:e]
        secs = split_sections(block, cid)
        desc = split_description(secs.get("test_description", []))
        rec = {
            "case_id": cid,
            "title": title_of(block, cid),
            "inputs": {
                "test_purpose": text(secs.get("test_purpose", [])),
                "conformance_requirements": text(secs.get("conformance", [])),
                "pre_test_conditions": text(desc.get("pre_test_conditions", [])),
            },
            "answers": {
                "test_procedure_sequence": text(desc.get("test_procedure_sequence", [])),
                "specific_message_contents": text(desc.get("specific_message_contents", [])),
            },
            "source": {"spec": "3GPP TS 38.523-1 v19.6.0", "section": cid},
        }
        records.append(rec)
        with open(os.path.join(outdir, f"{cid}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=2)

    with open(os.path.join(outdir, "cases.jsonl"), "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"cases={len(records)}")
    for r in records:
        n_in = len(r["inputs"]["test_purpose"]) + len(r["inputs"]["conformance_requirements"])
        n_out = len(r["answers"]["test_procedure_sequence"]) + len(r["answers"]["specific_message_contents"])
        print(f"{r['case_id']:<10} in={n_in:>6} out={n_out:>6}  {r['title'][:60]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
