"""Koneksi MongoDB Atlas (singleton) + helper transaksi atomic & penomoran dokumen."""
from pymongo import MongoClient, ASCENDING, DESCENDING, ReturnDocument


class Database:
    _client = None
    _db = None

    @classmethod
    def connect(cls, uri, name):
        if not uri:
            raise RuntimeError("MONGO_URI belum diisi. Salin .env.example menjadi .env dan isi connection string Atlas.")
        cls._client = MongoClient(uri, serverSelectionTimeoutMS=10000, tz_aware=True)
        cls._client.admin.command("ping")
        cls._db = cls._client[name]
        cls._ensure_indexes()

    @classmethod
    def _ensure_indexes(cls):
        c = cls.col
        c("users").create_index("username", unique=True)
        c("items").create_index("code", unique=True)
        c("categories").create_index("name", unique=True)
        c("warehouses").create_index("name", unique=True)
        c("suppliers").create_index("name", unique=True)
        c("sessions").create_index("sid", unique=True)
        c("sessions").create_index("expires_at", expireAfterSeconds=0)  # TTL: session kedaluwarsa otomatis
        c("stock_transactions").create_index([("item_id", ASCENDING), ("at", DESCENDING)])

    @classmethod
    def col(cls, name):
        return cls._db[name]

    @classmethod
    def transaction(cls, fn):
        """Jalankan fn(session) sebagai transaksi MongoDB (all-or-nothing)."""
        with cls._client.start_session() as s:
            return s.with_transaction(fn)

    @classmethod
    def next_number(cls, prefix):
        doc = cls.col("counters").find_one_and_update(
            {"_id": prefix}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
        return f"{prefix}-{doc['seq']:05d}"
