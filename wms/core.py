"""Utilitas dasar: error aplikasi, waktu, konversi ObjectId, serialisasi JSON."""
from datetime import datetime, timezone
from bson import ObjectId
from bson.errors import InvalidId


class AppError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


class InsufficientStock(AppError):
    def __init__(self, message):
        super().__init__(message, 409)


def now():
    return datetime.now(timezone.utc)


def oid(value):
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError):
        raise AppError("ID tidak valid", 400)


def serialize(obj):
    """Ubah dokumen MongoDB menjadi JSON-friendly (_id -> id, ObjectId -> str, datetime -> ISO)."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k == "password_hash":
                continue
            out["id" if k == "_id" else k] = serialize(v)
        return out
    if isinstance(obj, (list, tuple)):
        return [serialize(x) for x in obj]
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, datetime):
        if obj.tzinfo is None:
            obj = obj.replace(tzinfo=timezone.utc)
        return obj.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return obj
