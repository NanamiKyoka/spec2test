"""技能库：skills/<name>.md，frontmatter 提供 name / description / when。

技能是给智能体读的过程说明，不是可执行代码；正文按“判断顺序 / 修复 / 判据 / 不要做”组织。
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS_DIR = os.path.join(ROOT, "skills")


def _parse(text):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        return {}, text.strip()
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, val = line.split(":", 1)
            meta[key.strip()] = val.strip()
    return meta, m.group(2).strip()


def _files():
    if not os.path.isdir(SKILLS_DIR):
        return []
    return sorted(n for n in os.listdir(SKILLS_DIR) if n.endswith(".md"))


def list_skills():
    out = []
    for name in _files():
        try:
            with open(os.path.join(SKILLS_DIR, name), encoding="utf-8") as f:
                meta, body = _parse(f.read())
        except Exception:
            continue
        out.append({"name": meta.get("name") or name[:-3],
                    "description": meta.get("description", ""),
                    "when": meta.get("when", ""),
                    "chars": len(body)})
    return out


def get_skill(name):
    key = (name or "").strip().lower()
    if not key:
        return None
    for fname in _files():
        try:
            with open(os.path.join(SKILLS_DIR, fname), encoding="utf-8") as f:
                meta, body = _parse(f.read())
        except Exception:
            continue
        skill_name = (meta.get("name") or fname[:-3]).lower()
        if key in (skill_name, fname[:-3].lower()):
            return {"name": skill_name, "description": meta.get("description", ""),
                    "when": meta.get("when", ""), "body": body}
    return None
