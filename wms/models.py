"""Model (OOP) untuk data master, user, audit log, dan kartu stok."""
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash, check_password_hash
from .core import AppError, now, oid, serialize
from .database import Database

ROLES = ("admin", "manager", "staff", "purchasing")


class AuditLog:
    @staticmethod
    def log(actor, action, entity, ref=None, detail="", session=None):
        Database.col("audit_logs").insert_one({
            "at": now(),
            "user": actor["username"] if actor else "system",
            "role": actor["role"] if actor else "system",
            "action": action,
            "entity": entity,
            "ref": str(ref) if ref is not None else "",
            "detail": str(detail)[:300],
        }, session=session)

    @staticmethod
    def find(limit=500):
        return serialize(list(Database.col("audit_logs").find().sort("at", -1).limit(limit)))


class BaseModel:
    """Basis CRUD generik: validasi field, audit log, hook before_update / before_delete."""
    collection = ""
    label = "Data"
    fields = {}          # nama -> {type, required, default, min}
    sort = [("created_at", -1)]

    @classmethod
    def col(cls):
        return Database.col(cls.collection)

    @classmethod
    def clean(cls, data, partial=False):
        out = {}
        for name, spec in cls.fields.items():
            if name in data:
                v = data[name]
                if v is None or v == "":
                    v = spec.get("default")
                else:
                    try:
                        v = spec["type"](v)
                    except (ValueError, TypeError):
                        raise AppError(f"Field '{name}' tidak valid")
                    if isinstance(v, str):
                        v = v.strip()
                out[name] = v
            elif not partial and "default" in spec:
                out[name] = spec["default"]
            if spec.get("required") and (not partial or name in data) and out.get(name) in (None, ""):
                raise AppError(f"Field '{name}' wajib diisi")
            if "min" in spec and out.get(name) is not None and out[name] < spec["min"]:
                raise AppError(f"Field '{name}' minimal {spec['min']}")
        return out

    @classmethod
    def defaults(cls):
        return {}

    @classmethod
    def describe(cls, doc):
        return doc.get("name") or doc.get("code") or doc.get("username") or ""

    @classmethod
    def find_all(cls, flt=None):
        return serialize(list(cls.col().find(flt or {}).sort(cls.sort)))

    @classmethod
    def get(cls, rid):
        doc = cls.col().find_one({"_id": oid(rid)})
        if not doc:
            raise AppError(f"{cls.label} tidak ditemukan", 404)
        return doc

    @classmethod
    def create(cls, data, actor):
        doc = cls.clean(data)
        doc.update(cls.defaults())
        doc["created_at"] = now()
        try:
            cls.col().insert_one(doc)
        except DuplicateKeyError:
            raise AppError(f"{cls.label} sudah ada (data duplikat)", 409)
        AuditLog.log(actor, "create", cls.collection, doc["_id"], cls.describe(doc))
        return doc

    @classmethod
    def before_update(cls, current, changes, actor):
        pass

    @classmethod
    def update(cls, rid, data, actor):
        current = cls.get(rid)
        changes = cls.clean(data, partial=True)
        cls.before_update(current, changes, actor)
        changes["updated_at"] = now()
        try:
            cls.col().update_one({"_id": current["_id"]}, {"$set": changes})
        except DuplicateKeyError:
            raise AppError(f"{cls.label} sudah ada (data duplikat)", 409)
        AuditLog.log(actor, "update", cls.collection, current["_id"], cls.describe({**current, **changes}))
        return cls.get(rid)

    @classmethod
    def before_delete(cls, doc, actor):
        pass

    @classmethod
    def delete(cls, rid, actor):
        doc = cls.get(rid)
        cls.before_delete(doc, actor)
        cls.col().delete_one({"_id": doc["_id"]})
        AuditLog.log(actor, "delete", cls.collection, doc["_id"], cls.describe(doc))


class Category(BaseModel):
    collection, label, sort = "categories", "Kategori", [("name", 1)]
    fields = {"name": {"type": str, "required": True}, "description": {"type": str, "default": ""}}

    @classmethod
    def before_delete(cls, doc, actor):
        if Item.col().count_documents({"category": doc["name"]}):
            raise AppError("Kategori masih dipakai oleh barang", 409)


class Warehouse(BaseModel):
    collection, label, sort = "warehouses", "Warehouse", [("name", 1)]
    fields = {"name": {"type": str, "required": True}, "address": {"type": str, "default": ""}}

    @classmethod
    def before_delete(cls, doc, actor):
        if Item.col().count_documents({"warehouse": doc["name"]}):
            raise AppError("Warehouse masih dipakai oleh barang", 409)


class Supplier(BaseModel):
    collection, label, sort = "suppliers", "Supplier", [("name", 1)]
    fields = {
        "name": {"type": str, "required": True},
        "contact": {"type": str, "default": ""},
        "phone": {"type": str, "default": ""},
        "email": {"type": str, "default": ""},
        "address": {"type": str, "default": ""},
    }

    @classmethod
    def before_delete(cls, doc, actor):
        if Database.col("purchase_orders").count_documents({"supplier_id": doc["_id"]}):
            raise AppError("Supplier sudah memiliki PO, tidak bisa dihapus", 409)


class Item(BaseModel):
    collection, label, sort = "items", "Barang", [("code", 1)]
    fields = {
        "code": {"type": str, "required": True},
        "name": {"type": str, "required": True},
        "category": {"type": str, "required": True},
        "unit": {"type": str, "default": "pcs"},
        "min_stock": {"type": int, "default": 0, "min": 0},
        "warehouse": {"type": str, "default": ""},
        "location": {"type": str, "default": ""},
    }

    @classmethod
    def defaults(cls):
        return {"stock": 0}   # stok hanya berubah lewat transaksi IN / OUT / ADJ

    @classmethod
    def before_delete(cls, doc, actor):
        if doc.get("stock", 0) > 0 or Database.col("stock_transactions").count_documents({"item_id": doc["_id"]}):
            raise AppError("Barang sudah memiliki stok/transaksi, tidak bisa dihapus", 409)


class User(BaseModel):
    collection, label, sort = "users", "User", [("username", 1)]
    fields = {
        "username": {"type": str, "required": True},
        "full_name": {"type": str, "required": True},
        "role": {"type": str, "required": True},
        "active": {"type": bool, "default": True},
    }

    @classmethod
    def clean(cls, data, partial=False):
        out = super().clean(data, partial)
        if "role" in out and out["role"] not in ROLES:
            raise AppError("Role harus salah satu dari: " + ", ".join(ROLES))
        if "username" in out:
            out["username"] = out["username"].lower().replace(" ", "")
        pwd = data.get("password")
        if pwd:
            if len(str(pwd)) < 6:
                raise AppError("Password minimal 6 karakter")
            out["password_hash"] = generate_password_hash(str(pwd))
        elif not partial:
            raise AppError("Password wajib diisi")
        return out

    @classmethod
    def before_update(cls, current, changes, actor):
        if str(current["_id"]) == str(actor["_id"]) and (changes.get("active") is False or
                                                         changes.get("role", current["role"]) != current["role"]):
            raise AppError("Anda tidak dapat menonaktifkan / mengubah role akun sendiri", 409)

    @classmethod
    def before_delete(cls, doc, actor):
        if str(doc["_id"]) == str(actor["_id"]):
            raise AppError("Anda tidak dapat menghapus akun sendiri", 409)

    @classmethod
    def authenticate(cls, username, password):
        user = cls.col().find_one({"username": str(username or "").strip().lower()})
        if not user or not user.get("active", True) or \
                not check_password_hash(user["password_hash"], str(password or "")):
            raise AppError("Login Gagal: username atau password salah", 401)
        return user


class StockTransaction:
    @staticmethod
    def find(item_id=None, limit=500):
        flt = {"item_id": oid(item_id)} if item_id else {}
        return serialize(list(Database.col("stock_transactions").find(flt).sort("at", -1).limit(limit)))
