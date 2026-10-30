"""API Key 的安全存储：Windows DPAPI > keyring > 环境变量 > 旧 settings.json。

原则：能加密就落盘，不能加密就不落盘；绝不把明文写回 settings.json。
"""
import ctypes
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS = os.path.join(ROOT, "data", "settings.json")
SECRET = os.path.join(ROOT, "data", "secret.bin")
HEADER = b"dpapi:v1\n"


class _BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _dpapi(data, protect):
    if sys.platform != "win32":
        raise OSError("DPAPI unavailable")
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    src = _BLOB(len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_byte)))
    dst = _BLOB()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    fn.argtypes = [ctypes.POINTER(_BLOB), ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(_BLOB)]
    fn.restype = ctypes.c_bool
    if not fn(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(dst)):
        raise OSError("DPAPI call failed")
    try:
        return ctypes.string_at(dst.pbData, dst.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(dst.pbData, ctypes.c_void_p))


def _atomic_write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def store_key(key, secret_path=None):
    """加密落盘；返回 'dpapi' / 'keyring' / ''（未持久化）。"""
    if not key:
        return ""
    path = secret_path or SECRET
    try:
        _atomic_write(path, HEADER + _dpapi(key.encode("utf-8"), True))
        return "dpapi"
    except Exception:
        pass
    try:
        import keyring  # 可选依赖
        keyring.set_password("spec2test", "llm", key)
        return "keyring"
    except Exception:
        return ""


def _from_keyring():
    try:
        import keyring
        return keyring.get_password("spec2test", "llm") or ""
    except Exception:
        return ""


def _from_legacy(settings_path):
    try:
        with open(settings_path, encoding="utf-8") as f:
            return (json.load(f).get("api_key") or "").strip()
    except Exception:
        return ""


def load_key(secret_path=None, settings_path=None):
    path = secret_path or SECRET
    settings = settings_path or SETTINGS
    try:
        with open(path, "rb") as f:
            raw = f.read()
        if raw.startswith(HEADER):
            return _dpapi(raw[len(HEADER):], False).decode("utf-8").strip()
    except Exception:
        pass
    key = _from_keyring()
    if key:
        return key
    for env in ("ANTHROPIC_API_KEY", "LLM_API_KEY"):
        if os.environ.get(env):
            return os.environ[env].strip()
    return _from_legacy(settings)


def migrate(secret_path=None, settings_path=None):
    """把旧 settings.json 里的明文 key 迁到安全存储；成功才删明文。"""
    settings = settings_path or SETTINGS
    try:
        with open(settings, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return False
    key = (data.get("api_key") or "").strip()
    if not key:
        return False
    if not store_key(key, secret_path):
        return False
    data.pop("api_key", None)
    _atomic_write(settings, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
    try:
        os.chmod(settings, 0o600)
    except Exception:
        pass
    return True
