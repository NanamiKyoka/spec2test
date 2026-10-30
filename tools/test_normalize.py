"""消息名归一化单测：正例须通过，反例须被判非法。"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import validate

SYM = os.path.join(os.path.dirname(HERE), "data", "symbols", "rrc_symbols.json")

POSITIVE = [
    "SIB1",
    "MIB/SIB1",
    "SystemInformationBlockType1",
    "SIB1 (cellBarred=barred, cellBarredNTN absent)",
    "NR RRC: SIB19",
]
NEGATIVE = ["SIB99", "RRCFoo", "MIB/SIB99"]


def main():
    symbols = json.load(open(SYM, encoding="utf-8"))
    known = set(symbols["messages"]) | set(symbols.get("known_uncovered", [])) \
        | set(symbols.get("all_definitions", [])) | set(symbols.get("all_defined_names", []))
    bad = 0
    for raw in POSITIVE:
        ok, unknown = validate.resolve_message(raw, known)
        print(f"[pos] {raw!r:55} -> {'PASS' if ok else 'FAIL ' + str(unknown)}")
        bad += 0 if ok else 1
    for raw in NEGATIVE:
        ok, unknown = validate.resolve_message(raw, known)
        print(f"[neg] {raw!r:55} -> {'PASS' if not ok else 'FAIL(未判非法)'}")
        bad += 0 if not ok else 1
    print(f"failures={bad}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
