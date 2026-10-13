"""Session berbasis server: cookie hanya menyimpan session-id bertanda tangan,
datanya disimpan di MongoDB (koleksi `sessions`) sehingga bisa dicabut saat logout."""
import secrets
from datetime import timedelta
from flask import session, request, g, current_app
from .core import AppError, now
from .database import Database
from .models import User


class SessionManager:
    KEY = "sid"

    @classmethod
    def start(cls, user):
        sid = secrets.token_urlsafe(32)
        hours = current_app.config["SESSION_HOURS"]
        Database.col("sessions").insert_one({
            "sid": sid, "user_id": user["_id"], "username": user["username"],
            "created_at": now(), "expires_at": now() + timedelta(hours=hours),
            "ip": request.remote_addr, "agent": (request.user_agent.string or "")[:200],
        })
        session.clear()
        session[cls.KEY] = sid
        session.permanent = True

    @classmethod
    def current_user(cls):
        sid = session.get(cls.KEY)
        if not sid:
            return None
        rec = Database.col("sessions").find_one({"sid": sid, "expires_at": {"$gt": now()}})
        user = User.col().find_one({"_id": rec["user_id"], "active": True}) if rec else None
        if not user:
            session.clear()
            return None
        return user

    @classmethod
    def end(cls):
        sid = session.get(cls.KEY)
        if sid:
            Database.col("sessions").delete_one({"sid": sid})
        session.clear()


def require(*roles):
    """Pastikan user sudah login (dan memiliki salah satu role bila roles diberikan)."""
    user = g.get("user")
    if not user:
        raise AppError("Silakan login terlebih dahulu", 401)
    if roles and user["role"] not in roles:
        raise AppError("Anda tidak memiliki akses ke fitur ini", 403)
    return user


def public_user(user):
    return {"id": str(user["_id"]), "username": user["username"],
            "full_name": user["full_name"], "role": user["role"]}
