"""提取 Specific message contents：每张表对应一个消息的 IE 清单。

输出 data/ir/ie/<case>.json
[{ table_ref, message, step, derivation_path, ies:[{name, value, comment, condition, raw}] }]
"""
import json
import os
import re
import sys

import pdfplumber

CASES = ["6.7.1.1", "6.7.1.2", "6.7.1.3", "6.7.1.4",
         "6.7.1.5", "6.7.1.6", "6.7.1.10", "6.7.1.12"]
SCAN = range(650, 745)

CAPTION = re.compile(r"Table\s+([\d.]+-\d+)\s*:?\s*([A-Za-z][A-Za-z0-9\-]*)")
STEP = re.compile(r"step\s+(\d+)", re.I)
IE_TOKEN = re.compile(r"^([A-Za-z][A-Za-z0-9\-]*)")


def norm(x):
    return re.sub(r"\s+", " ", (x or "")).strip()


def page_lines(page):
    out = []
    for ln in page.extract_text_lines():
        out.append((ln["top"], ln["text"]))
    return out


def caption_for(bbox, lines):
    bbox_top = bbox[1] if isinstance(bbox, (tuple, list)) else bbox["top"]
    above = [t for top, t in lines if top < bbox_top - 1]
    for t in reversed(above):
        m = CAPTION.search(t)
        if m:
            return t, m.group(1), m.group(2)
    return None, None, None


def main(pdf_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    pdf = pdfplumber.open(pdf_path)
    texts = {i: (pdf.pages[i].extract_text() or "") for i in SCAN}

    # 页边界：按 §6.7.1.N 章节标题页定界，避免把未入选用例扫进来
    head_page = {}
    for i in SCAN:
        for ln in texts[i].splitlines():
            m = re.match(r"^\s*(6\.7\.1\.\d+)\s+(?![\d.])", ln)
            if m and m.group(1) not in head_page:
                head_page[m.group(1)] = i
    def next_bound(cid):
        n = int(cid.rsplit(".", 1)[1])
        for k in range(n + 1, 13):
            if f"6.7.1.{k}" in head_page:
                return head_page[f"6.7.1.{k}"]
        return None
    first = {c: head_page[c] for c in CASES if c in head_page}
    order = sorted(CASES, key=lambda c: first.get(c, 10 ** 6))

    report = []
    for k, cid in enumerate(order):
        if cid not in first:
            continue
        start = first[cid]
        stop = next_bound(cid) or (start + 6)
        tables_out = []
        for i in range(start, min(stop + 1, max(SCAN) + 1)):
            if i >= len(pdf.pages):
                break
            page = pdf.pages[i]
            lines = page_lines(page)
            for tbl in page.find_tables():
                t = tbl.extract()
                if not t or not t[0]:
                    continue
                head = " ".join(norm(c) for r in t[:3] for c in r)
                if "Information Element" not in head:
                    continue
                cap, ref, msg = caption_for(tbl.bbox, lines)
                if not ref or not ref.startswith(cid + "."):
                    continue
                step = None
                if cap:
                    m = STEP.search(cap)
                    if m:
                        step = int(m.group(1))
                derivation = ""
                ies = []
                for r in t[1:]:
                    cells = [norm(c) for c in r]
                    if len(cells) < 2:
                        continue
                    name_raw, value = cells[0], cells[1]
                    comment = cells[2] if len(cells) > 2 else ""
                    cond = cells[3] if len(cells) > 3 else ""
                    if name_raw.lower().startswith("information element"):
                        continue
                    if name_raw.lower().startswith("derivation path"):
                        derivation = (name_raw + " " + value).strip()
                        continue
                    m = IE_TOKEN.match(name_raw)
                    if not m:
                        continue
                    ies.append({
                        "name": m.group(1),
                        "value": value,
                        "comment": comment,
                        "condition": cond,
                        "raw": name_raw,
                    })
                leaf, seen = [], set()
                for it in ies:
                    if it["value"] and "::=" not in it["raw"] and "{" not in it["raw"]:
                        if it["name"] not in seen:
                            seen.add(it["name"])
                            leaf.append(it)
                if not leaf:
                    continue
                tables_out.append({
                    "table_ref": ref,
                    "message": msg,
                    "step": step,
                    "derivation_path": derivation,
                    "ies": ies,
                    "leaf_ies": leaf,
                })
        with open(os.path.join(out_dir, f"{cid}.json"), "w", encoding="utf-8") as f:
            json.dump({"case_id": cid, "message_tables": tables_out}, f,
                      ensure_ascii=False, indent=2)
        names = {m["message"] for m in tables_out}
        report.append((cid, len(tables_out), sum(len(m["ies"]) for m in tables_out),
                       sum(len(m["leaf_ies"]) for m in tables_out), len(names)))

    print(f"{'case':<10}{'tables':>8}{'rows':>6}{'leaf':>6}{'msgs':>6}")
    for cid, nt, ni, nl, nm in report:
        print(f"{cid:<10}{nt:>8}{ni:>6}{nl:>6}{nm:>6}")
    print(f"合计 tables={sum(r[1] for r in report)} rows={sum(r[2] for r in report)} "
          f"leaf={sum(r[3] for r in report)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
