"""语义色的 WCAG 对比度回归：文字安全色与主按钮必须 ≥ 4.5:1。"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
CSS = (ROOT / "app" / "src" / "styles.css").read_text(encoding="utf-8")


def _block(selector):
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\}", CSS, re.S)
    assert m, f"缺少 {selector} 块"
    out = {}
    for name, value in re.findall(r"--([\w-]+):\s*([\d\s]+);", m.group(1)):
        out[name] = tuple(int(x) for x in value.split())
    return out


def _lum(rgb):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _ratio(a, b):
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


LIGHT = _block(":root")
DARK = _block(".dark")
WHITE = (255, 255, 255)


def test_light_text_safe_colors():
    for name in ("accent-ink", "ok-ink", "bad-ink", "warn-ink"):
        for bg in ("canvas", "surface"):
            assert _ratio(LIGHT[name], LIGHT[bg]) >= 4.5, (name, bg)


def test_light_primary_button():
    assert _ratio(WHITE, LIGHT["accent-solid"]) >= 4.5


def test_dark_text_safe_colors():
    for name in ("accent-ink", "ok-ink", "bad-ink", "warn-ink"):
        assert _ratio(DARK[name], DARK["canvas"]) >= 4.5, name


def test_dark_primary_button():
    assert _ratio(WHITE, DARK["accent-solid"]) >= 4.5
