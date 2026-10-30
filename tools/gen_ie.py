"""第二段：IE 生成。弃权判定在调用模型之前（ADR-0006）。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm
import validate

SYSTEM = (
    "你是 3GPP RRC 信令内容助手。只输出 JSON，不要解释。"
    '格式：{"message":"<消息名>","derivation_path":"<模板来源>",'
    '"ies":[{"name":"<字段名>","value":"<取值>","condition":"<条件或空串>"}]}。'
    "字段名必须是该消息 ASN.1 里真实存在的字段；取值写具体值（如 10、true、Not present）。"
    "若 validation_errors 非空，必须修正这些字段：只能使用 default_template_fields "
    "或全局标识符里的字段。"
)
MAX_MSG = 12

SIB_RE = re.compile(r"\bSIB\s?(\d{1,2})\b")
SIBTYPE_RE = re.compile(r"\bSystemInformationBlockType\s?(\d{1,2})\b", re.I)
FIELD_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*")
FIELD_STOP = {"one", "two", "three", "four", "five", "six", "seven", "eight",
              "true", "false", "not", "present", "barred", "none", "all",
              "setup", "release", "add", "mod", "spare", "normal", "critical"}


def _field_like(tok):
    """过滤枚举/布尔字面量（如 one/two/true），只保留 ASN.1 字段样式的 token。"""
    return (len(tok) >= 4
            and (any(c.isupper() for c in tok) or "-" in tok or any(c.isdigit() for c in tok))
            and tok.lower() not in FIELD_STOP)
RRC_RE = re.compile(
    r"\b(RRCSetupRequest|RRCSetupComplete|RRCSetup|RRCReconfigurationComplete|"
    r"RRCReconfiguration|RRCRelease|RRCReestablishment|RRCResumeRequest|RRCResumeComplete|"
    r"UECapabilityEnquiry|UECapabilityInformation|SecurityModeCommand|SecurityModeComplete|"
    r"SecurityModeFailure|Paging|SystemInformation|DLInformationTransfer|"
    r"ULInformationTransfer|CounterCheck|MeasurementReport|RRCSystemInfoRequest)\b"
)


def load_symbols(path):
    d = json.load(open(path, encoding="utf-8"))
    return d["messages"], set(d.get("global_identifiers", [])), set(d.get("all_defined_names", []))


def _input_text(ctx):
    return " ".join(str(ctx.get(k, "")) for k in
                    ("test_purpose", "conformance_requirements", "pre_test_conditions"))


def _explicit_positions(text):
    """输入里显式出现的 SIB / RRC 消息名及首次位置。"""
    found = [(m.start(), f"SIB{int(m.group(1))}") for m in SIB_RE.finditer(text)]
    found += [(m.start(), f"SIB{int(m.group(1))}") for m in SIBTYPE_RE.finditer(text)]
    found += [(m.start(), m.group(1)) for m in RRC_RE.finditer(text)]
    return found


def distinct_messages(steps):
    out, seen = [], set()
    for s in steps or []:
        m = re.sub(r"^nr\s*rrc\s*:\s*", "", (s.get("message") or "").strip(), flags=re.I)
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def messages_from_inputs(ctx):
    """只读输入侧三个字段，抽取实际出现的消息/SIB 名，按首次出现排序去重。"""
    out, seen = [], set()
    for _, name in sorted(_explicit_positions(_input_text(ctx))):
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def candidate_messages(ctx, symbols_path):
    """候选消息：显式消息名优先，再用符号表把输入中出现的字段反查回所属消息。"""
    table, _, _ = load_symbols(symbols_path)
    text = _input_text(ctx)
    explicit = messages_from_inputs(ctx)

    field_index = {}
    for msg, meta in table.items():
        for f in meta.get("fields") or []:
            field_index.setdefault(f, []).append(msg)

    counts, first_pos = {}, {}
    seen_pairs = set()
    for m in FIELD_TOKEN.finditer(text):
        token = m.group(0)
        if not _field_like(token):
            continue
        for msg in field_index.get(token, [])[:3]:
            if (token, msg) in seen_pairs:
                continue
            seen_pairs.add((token, msg))
            counts[msg] = counts.get(msg, 0) + 1
            if msg not in first_pos or m.start() < first_pos[msg]:
                first_pos[msg] = m.start()
    derived = sorted(counts, key=lambda m: (-counts[m], first_pos[m]))

    out, seen = [], set()
    for name in explicit + derived:
        if name in seen:
            continue
        if name in table or re.fullmatch(r"SIB\d{1,2}", name):
            seen.add(name)
            out.append(name)
        if len(out) >= MAX_MSG:
            break
    return out


def generate_ie(ctx, steps, message, symbols_path, feedback=None):
    msgs, gids, _ = load_symbols(symbols_path)
    skeleton = msgs.get(message, {}).get("fields", [])[:60]
    payload = {
        "test_purpose": ctx.get("test_purpose", "")[:1200],
        "message": message,
        "default_template_fields": skeleton,
        "steps_hint": [{"st": s.get("st"), "direction": s.get("direction"),
                        "message": s.get("message")} for s in (steps or [])][:15],
        "validation_errors": feedback or [],
    }
    text, stop = llm.complete([{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                              system=SYSTEM)
    ir = llm.extract_json(text)
    if not isinstance(ir, dict):
        return {"message": message, "ies": [], "_error": f"parse_failed(stop={stop})"}
    ies = [i for i in (ir.get("ies") or []) if isinstance(i, dict) and i.get("name")]
    for i in ies:
        i["name"] = str(i["name"]).strip()
        i["_known"] = (i["name"] in (msgs.get(message, {}).get("fields") or [])) or (i["name"] in gids)
    return {"message": message, "derivation_path": ir.get("derivation_path", ""),
            "ies": ies, "_stop": stop}


def _r2_messages(violations):
    """把 R2 违规按消息名归组，供带错重生成。"""
    bad = {}
    for v in violations or []:
        if v.get("rule") != "R2":
            continue
        m = re.match(r"messages\[([^\]]+)\]", v.get("path") or "")
        msg = m.group(1) if m else ""
        if msg:
            bad.setdefault(msg, []).append(v.get("detail") or "")
    return bad


def generate_all(ctx, steps, symbols_path, repairs=1):
    """产品入口：候选为空则弃权；R2 失败时带违规清单重生成一次。"""
    cand = candidate_messages(ctx, symbols_path)
    if not cand:
        return {"status": "abstained",
                "reason": "inputs contain no message/SIB names",
                "candidates": [], "messages": [], "calls": 0}
    table = json.load(open(symbols_path, encoding="utf-8"))
    msgs = [generate_ie(ctx, steps, m, symbols_path) for m in cand]
    calls, used = len(cand), 0
    for _ in range(max(0, repairs)):
        violations = validate.validate(
            {"case_id": ctx.get("case_id", ""), "steps": steps, "messages": msgs}, table)
        bad = _r2_messages(violations)
        if not bad:
            break
        for msg, feedback in list(bad.items())[:3]:
            idx = next((i for i, m in enumerate(msgs)
                        if (m.get("message") or "") == msg), None)
            if idx is None:
                continue
            repaired = generate_ie(ctx, steps, msg, symbols_path, feedback=feedback)
            # 修复解析失败（空 ies）时保留原消息，避免越修越空
            if repaired.get("ies") or not (msgs[idx].get("ies") or []):
                msgs[idx] = repaired
            calls += 1
            used += 1
    return {"status": "generated", "candidates": cand, "messages": msgs,
            "calls": calls, "repairs": used}


if __name__ == "__main__":
    print("gen_ie 作为库使用：from gen_ie import generate_all")
