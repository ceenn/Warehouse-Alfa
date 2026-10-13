"""Data awal: 4 akun (admin, manager, staff, purchasing) + contoh master data. Hanya jika database masih kosong."""
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash
from .core import now
from .database import Database

USERS = [
    ("admin", "Administrator", "admin", "admin123"),
    ("manager", "Budi Manager", "manager", "manager123"),
    ("staff", "Sari Staff Warehouse", "staff", "staff123"),
    ("purchasing", "Dedi Purchasing", "purchasing", "purchasing123"),
]


class Seeder:
    @staticmethod
    def _insert(col, doc):
        try:
            Database.col(col).insert_one({**doc, "created_at": now()})
        except DuplicateKeyError:
            pass

    @classmethod
    def run(cls):
        if Database.col("users").count_documents({}) == 0:
            for u, name, role, pwd in USERS:
                cls._insert("users", {"username": u, "full_name": name, "role": role,
                                      "active": True, "password_hash": generate_password_hash(pwd)})
        if Database.col("items").count_documents({}) == 0:
            for c in ("Elektronik", "Alat Tulis", "Perlengkapan"):
                cls._insert("categories", {"name": c, "description": ""})
            cls._insert("warehouses", {"name": "Gudang Utama", "address": "Jl. Industri No. 1"})
            cls._insert("suppliers", {"name": "PT Sumber Makmur", "contact": "Andi", "phone": "081200000001",
                                      "email": "sales@sumbermakmur.example", "address": "Semarang"})
            samples = [
                ("BRG-001", "Laptop 14 inch", "Elektronik", "unit", 5, "A-01", 12),
                ("BRG-002", "Mouse Wireless", "Elektronik", "pcs", 10, "A-02", 8),
                ("BRG-003", "Kertas A4 80gr", "Alat Tulis", "rim", 20, "B-01", 60),
                ("BRG-004", "Pulpen Hitam", "Alat Tulis", "box", 10, "B-02", 25),
                ("BRG-005", "Helm Safety", "Perlengkapan", "pcs", 15, "C-01", 4),
            ]
            for code, name, cat, unit, mn, loc, stock in samples:
                cls._insert("items", {"code": code, "name": name, "category": cat, "unit": unit, "min_stock": mn,
                                      "warehouse": "Gudang Utama", "location": loc, "stock": stock})
