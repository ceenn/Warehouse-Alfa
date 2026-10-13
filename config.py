import os
from dotenv import load_dotenv

load_dotenv()


def _bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "y")


class Config:
    """Seluruh konfigurasi aplikasi dibaca dari environment variable / file .env."""
    SECRET_KEY = os.getenv("SECRET_KEY", "ganti-dengan-kunci-rahasia")
    MONGO_URI = os.getenv("MONGO_URI", "")
    MONGO_DB = os.getenv("MONGO_DB", "wms_warehouse")

    SESSION_HOURS = int(os.getenv("SESSION_HOURS", "8"))
    SESSION_COOKIE_NAME = "wms_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _bool(os.getenv("COOKIE_SECURE"))

    OPNAME_THRESHOLD_PCT = float(os.getenv("OPNAME_THRESHOLD_PCT", "10"))
    SEED_DEFAULTS = _bool(os.getenv("SEED_DEFAULTS"), True)
