"""三条 LLM 通道的配置自检。

缺 key / 地址不通 → 一行提示并跳过（不失败）；有配置 → 打一次最小请求。
--dry-run 全走本地 mock，不联网。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm

PROVIDERS = ["proxy", "openai", "anthropic"]


def configured(p):
    if p == "proxy":
        return True                      # 本地代理，无需 key
    if p == "openai":
        return bool(os.environ.get("LLM_API_KEY"))
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def main(dry):
    for p in PROVIDERS:
        os.environ["LLM_PROVIDER"] = p
        # 重新加载常量
        import importlib
        m = importlib.reload(llm)
        if not configured(p):
            need = "LLM_API_KEY" if p == "openai" else "ANTHROPIC_API_KEY"
            print(f"[skip] {p}: 未设置 {need}")
            continue
        if dry:
            print(f"[mock] {p}: dry-run，跳过实际请求（model={m.MODEL} base={m.BASE}）")
            continue
        try:
            t, stop = m.complete([{"role": "user", "content": "只回复两个字：收到"}], max_tokens=256)
            print(f"[ok] {p}: model={m.MODEL} base={m.BASE} -> {t.strip()[:20]!r}")
        except Exception as e:
            print(f"[warn] {p}: 调用失败 {type(e).__name__}: {str(e)[:80]}")
    os.environ["LLM_PROVIDER"] = llm.PROVIDER


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
