# WMS Warehouse

Aplikasi web Warehouse Management System berdasarkan flowchart dan sequence diagram Kapita.

Stack: Python (Flask, OOP), REST API (JSON), MongoDB Atlas, session server-side, frontend Webix, deploy ke Render.

## Fitur

| Modul | Alur |
|---|---|
| Login dan Session | Login username/password, lalu masuk dashboard sesuai role. Gagal: pesan error. Session disimpan di MongoDB (koleksi `sessions`, kedaluwarsa otomatis), logout mencabut session. |
| Master Data | Barang, Kategori, Warehouse (Admin/Manager). Supplier (Admin/Manager/Purchasing). Semua perubahan tercatat di Audit Log. |
| Request Barang | Semua user membuat request (status Menunggu), Manager menyetujui/menolak, Staff input barang keluar, stok dipotong atomic (transaksi MongoDB), status Selesai. Stok kurang: status Backorder. |
| Purchase Order | Purchasing buat PO, Manager approve (Ordered) atau tolak, Staff cek barang. Sesuai: stok bertambah atomic. Tidak sesuai: dicatat retur/klaim. Status: Partially Received / Received. |
| Stock Opname | Admin/Manager buat sesi, Staff input hasil hitung, selisih di atas ambang (default 10%) memicu hitung ulang, lalu adjustment diajukan ke Manager, disetujui, stok disesuaikan (transaksi ADJ). |
| Kartu Stok | Semua transaksi IN / OUT / ADJ beserta saldo. |
| Laporan | Manager/Admin: preview dan unduh Excel dan PDF (stok, stok menipis, kartu stok, request, PO). |
| Pengguna | Admin kelola akun dan role. |

Aturan bisnis: approver tidak boleh sama dengan pembuat (request / PO) maupun penghitung (opname); stok tidak pernah negatif.

## Hak akses per role

| Menu / Aksi | Admin | Manager | Staff | Purchasing |
|---|:-:|:-:|:-:|:-:|
| Dashboard, lihat Barang, Kartu Stok | Ya | Ya | Ya | Ya |
| Buat Request Barang (sebagai requester) | Ya | Ya | Ya | Ya |
| Approve/Tolak Request, PO, Adjustment | - | Ya | - | - |
| Input Barang Keluar, Cek/Terima Barang PO, Input Hasil Opname | - | - | Ya | - |
| Buat PO | - | - | - | Ya |
| Kelola Master Data (Barang, Kategori, Warehouse) | Ya | Ya | - | - |
| Kelola Supplier | Ya | Ya | - | Ya |
| Buat Sesi Opname | Ya | Ya | - | - |
| Laporan (PDF/Excel), Audit Log | Ya | Ya | - | - |
| Kelola Pengguna | Ya | - | - | - |

## 1) Siapkan MongoDB Atlas

1. Daftar/login di https://cloud.mongodb.com lalu buat Cluster (Free M0 sudah cukup, mendukung transaksi).
2. Database Access: Add New Database User (catat username dan password).
3. Network Access: Add IP Address. Untuk lokal tambahkan IP Anda; untuk Render pilih "Allow access from anywhere" (0.0.0.0/0).
4. Database, Connect, Drivers: salin connection string, contoh:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   (jika password mengandung karakter khusus seperti `@` `#` `/`, ubah ke bentuk URL-encoded).

Database dan koleksi dibuat otomatis oleh aplikasi saat pertama kali jalan.

## 2) Menjalankan di komputer lokal

Butuh Python 3.10+.

```bash
cd wms-warehouse
python -m venv venv
# Windows:   venv\Scripts\activate
# Linux/Mac: source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # Windows: copy .env.example .env
# edit .env: isi MONGO_URI (dari Atlas) dan SECRET_KEY (string acak panjang)

python app.py
```

Buka http://localhost:5000

### Akun bawaan (dibuat otomatis saat database masih kosong)

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Manager | `manager` | `manager123` |
| Staff Warehouse | `staff` | `staff123` |
| Purchasing | `purchasing` | `purchasing123` |

Segera ganti password lewat menu Pengguna (login sebagai admin). Setelah itu set `SEED_DEFAULTS=false` di `.env` bila tidak ingin data contoh dibuat lagi.

### Mencoba alur lengkap (sekitar 5 menit)
1. Login purchasing, menu Request Barang, klik Request Baru, pilih barang, kirim.
2. Login manager, menu Request Barang, pilih baris, klik Setujui.
3. Login staff, menu Request Barang, pilih baris, klik Input Barang Keluar dan Serahkan. Cek stok berkurang di Kartu Stok.
4. Login purchasing, menu Purchase Order, Buat PO. Login manager, Setujui PO. Login staff, Cek dan Terima Barang.
5. Login admin, menu Stock Opname, Buat Sesi. Staff input hasil hitung, manager setujui adjustment.
6. Login manager, menu Laporan, unduh Excel / PDF.

## 3) Deploy ke Render (gratis)

Render tidak membutuhkan Procfile maupun render.yaml. Semua pengaturan cukup diisi lewat dashboard.

1. Upload folder proyek ke repository GitHub (file `.env` jangan ikut; sudah ada di `.gitignore`).
2. Di https://render.com pilih New, Web Service, lalu hubungkan repository tersebut.
3. Isi pengaturan berikut:
   - Runtime: Python 3
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app:app --workers 2 --threads 4 --timeout 120`
4. Tambahkan Environment Variables: `MONGO_URI` (wajib), `SECRET_KEY` (string acak), `COOKIE_SECURE=true`, dan bila perlu `PYTHON_VERSION=3.12.7`.
5. Pastikan di Atlas Network Access mengizinkan `0.0.0.0/0`.
6. Klik Create Web Service. Aplikasi live di `https://nama-app.onrender.com`.

Cold start: pada paket gratis Render, request pertama setelah aplikasi tertidur 15 menit bisa butuh sekitar 30 detik. Ini wajar.

## Struktur proyek

```
wms-warehouse/
  app.py              entry point (python app.py / gunicorn app:app)
  config.py           konfigurasi dari .env
  requirements.txt
  .env.example
  templates/
    index.html        kerangka HTML (memuat Webix, style.css, app.js)
  static/
    style.css         gaya tampilan
    app.js            seluruh logika frontend Webix
  wms/
    __init__.py       application factory, error handler, session hook
    database.py       class Database (koneksi Atlas, index, transaksi, penomoran)
    models.py         BaseModel + Item, Category, Warehouse, Supplier, User, AuditLog
    auth.py           SessionManager, require(role)
    services.py       StockService, RequestService, POService, OpnameService, DashboardService
    reports.py        ReportBuilder, ExcelExporter, PdfExporter
    routes.py         REST API (MethodView + endpoint aksi)
    seed.py           akun dan data contoh
```

## REST API ringkas

`POST /api/auth/login|logout`, `GET /api/auth/me`, CRUD `/api/items|categories|warehouses|suppliers|users`,
`/api/requests` (+ `/<id>/approve|reject|fulfill`), `/api/purchase-orders` (+ `/<id>/approve|reject|receive`),
`/api/opnames` (+ `/<id>/count|approve|reject`), `GET /api/transactions`, `GET /api/dashboard`,
`GET /api/audit-logs`, `GET /api/reports/<jenis>/<json|xlsx|pdf>`

## Catatan

- Webix dimuat dari CDN resmi (`cdn.webix.com/edge`), sama seperti contoh tugas. Untuk offline atau mengunci versi, unduh `webix.js` dan `webix.css`, simpan di folder `static/`, lalu ubah dua baris link/script Webix di `templates/index.html`.
- Ambang selisih opname diatur lewat `OPNAME_THRESHOLD_PCT`; setelah satu kali hitung ulang, selisih tetap diajukan ke Manager agar tidak berputar tanpa akhir.
- Waktu pada laporan memakai WIB (UTC+7); tampilan di web mengikuti zona waktu browser.
- Cookie session bersifat HttpOnly dan SameSite=Lax; aktifkan `COOKIE_SECURE=true` saat memakai HTTPS.
- Jangan menulis MONGO_URI langsung di kode. Simpan hanya di `.env` atau environment variable Render.

## Troubleshooting

- `ServerSelectionTimeoutError` / gagal konek: IP belum diizinkan di Atlas Network Access, atau `MONGO_URI` salah (cek user/password).
- `MONGO_URI belum diisi`: file `.env` belum dibuat / belum diisi.
- Error DNS pada `mongodb+srv://`: pastikan `pip install -r requirements.txt` sukses dan koneksi internet normal.
