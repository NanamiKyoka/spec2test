"""按坐标提取 Main behaviour 表，并以"表标题里的用例号"归属。

页边界不可靠：下一用例标题可能与上一用例内容同页，表格标题也可能落在上一页。
故：优先用本页表格上方的标题；没有则沿用上一页最后见到的标题（carry）。
规范有笔误（6.1.7.3 应为 6.7.1.3），需归一化。
"""
import json
import os
import re
import sys

import pdfplumber

CASES = ["6.7.1.1", "6.7.1.2", "6.7.1.3", "6.7.1.4",
         "6.7.1.5", "6.7.1.6", "6.7.1.10", "6.7.1.12"]
SCAN = range(645, 745)

CAPTION = re.compile(r"Table\s+([\d.]+-\d+)")
STEP_ID = re.compile(r"^\d{1,3}[A-Za-z]?$")
CASE_ID = re.compile(r"6\.7\.1\.\d+")


def norm(x):
    return re.sub(r"\s+", " ", (x or "")).strip()


def caption_above(bbox, lines):
    top = bbox[1]
    for t_top, t in reversed([(a, b) for a, b in lines if a < top - 1]):
        m = CAPTION.search(t)
        if m:
            return m.group(1)
    return None


def ref_case(ref):
    if not ref:
        return None
    m = re.match(r"6\.(\d+)\.(\d+)\.(\d+)", ref)
    if not m:
        return None
    a, b, c = m.group(1), m.group(2), m.group(3)
    if a == "1" and b == "7":
        a, b = "7", "1"
    return f"6.{a}.{b}.{c}"


def direction(us):
    u = norm(us).replace(" ", "")
    if "<--" in u:
        return "S->U"
    if "-->" in u:
        return "U->S"
    if "-" in u:
        return "none"
    return None


def is_header(row):
    j = " ".join(norm(c) for c in row)
    return "Procedure" in j and "Verdict" in j


def looks_continuation(t):
    return bool(t) and all(len(r) == 6 for r in t) \
        and re.fullmatch(r"\d{1,3}", norm(t[0][0])) is not None


def parse_rows(rows):
    steps, last = [], None
    for r in rows:
        if len(r) != 6:
            continue
        st, proc, us, msg, tp, vd = (norm(x) for x in r[:6])
        if msg in ("-", "–", ""):
            msg = ""
        if us in ("U - S", "U-S") or proc == "Procedure":
            continue
        if STEP_ID.fullmatch(st):
            last = {"st": st, "procedure": proc, "direction": direction(us),
                    "message": msg, "tp": tp or None, "verdict": vd or None}
            steps.append(last)
        elif last is not None:
            if proc:
                last["procedure"] = (last["procedure"] + " " + proc).strip()
            if msg:
                last["message"] = (last["message"] + " " + msg).strip()
            if not last["direction"] and us:
                last["direction"] = direction(us)
            if not last["tp"] and tp:
                last["tp"] = tp
            if not last["verdict"] and vd:
                last["verdict"] = vd
    return steps


def main(pdf_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    pdf = pdfplumber.open(pdf_path)
    buckets = {c: [] for c in CASES}
    carry = None          # 上一页最后见到的表格标题
    last_case = None      # 最近一次成功归属的用例

    page_ids = {}
    for i in SCAN:
        txt = pdf.pages[i].extract_text() or ""
        page_ids[i] = set(CASE_ID.findall(txt))

    for i in SCAN:
        page = pdf.pages[i]
        lines = [(ln["top"], ln["text"]) for ln in page.extract_text_lines()]
        page_caps = [t for _, t in lines if CAPTION.search(t)]
        nearby = page_ids[i] | page_ids.get(i - 1, set())

        for tbl in page.find_tables():
            t = tbl.extract()
            if not t or not t[0]:
                continue
            header = is_header(t[0])
            cont = looks_continuation(t)
            if not header and not cont:
                continue

            ref = caption_above(tbl.bbox, lines) or carry
            case = ref_case(ref)
            if not header:
                # 无标题续表：若本页/上一页只出现一个候选用例，直接归它
                cands = sorted(nearby)
                if case not in buckets and len(cands) == 1 and cands[0] in buckets:
                    case = cands[0]

            if case in buckets and (case in nearby or header):
                if header:
                    buckets[case].extend(t[1:])
                else:
                    buckets[case].extend(t)
                last_case = case
            elif not header and last_case and last_case in nearby:
                buckets[last_case].extend(t)

        if page_caps:
            carry = page_caps[-1]

    print(f"{'case':<10}{'steps':>7}{'dir':>6}{'msg':>6}{'tp':>5}")
    tot = [0, 0, 0]
    for cid in CASES:
        steps = parse_rows(buckets[cid])
        with open(os.path.join(out_dir, f"{cid}.json"), "w", encoding="utf-8") as f:
            json.dump({"case_id": cid, "steps": steps}, f, ensure_ascii=False, indent=2)
        nd = sum(1 for s in steps if s["direction"] in ("S->U", "U->S"))
        nm = sum(1 for s in steps if s["message"])
        nt = sum(1 for s in steps if s["tp"] and s["tp"] != "-")
        tot = [tot[0] + len(steps), tot[1] + nd, tot[2] + nm]
        print(f"{cid:<10}{len(steps):>7}{nd:>6}{nm:>6}{nt:>5}")
    print(f"合计 steps={tot[0]} dir={tot[1]} msg={tot[2]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
