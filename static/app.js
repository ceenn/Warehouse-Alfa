/* ===================================================================
   WMS Warehouse - Frontend Webix
   Semua data diambil dari REST API Flask (JSON) memakai webix.ajax
   =================================================================== */
let userAktif = null;      // user yang sedang login
const HALAMAN = {};        // id halaman -> { muat() }

window.addEventListener("unhandledrejection", e => e.preventDefault());

/* ------------------------------ helper ------------------------------ */
const LABEL_ROLE = { admin: "Admin", manager: "Manager", staff: "Staff Warehouse", purchasing: "Purchasing" };
const WARNA_STATUS = {
    "Menunggu": "warn", "Menunggu Approval": "warn", "Hitung Ulang": "warn",
    "Disetujui": "info", "Ordered": "info", "Partially Received": "info", "Input Hitung": "info",
    "Backorder": "bad", "Ditolak": "bad", "Selesai": "ok", "Received": "ok"
};

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtTanggal(v) { return v ? webix.Date.dateToStr("%d-%m-%Y %H:%i")(new Date(v)) : ""; }
function rupiah(v) { return webix.i18n.numberFormat(v || 0); }
function badge(v) { return `<span class="badge ${WARNA_STATUS[v] || ""}">${esc(v)}</span>`; }
function buatTabel(header, baris) {
    return "<table class='dt'><tr>" + header.map(h => `<th>${esc(h)}</th>`).join("") + "</tr>" +
        baris.map(r => "<tr>" + r.map(c => `<td>${esc(c)}</td>`).join("") + "</tr>").join("") + "</table>";
}

// Pemanggil REST API (JSON). Pesan error dari server otomatis ditampilkan.
function panggilApi(method, url, data) {
    const req = webix.ajax().headers({ "Content-Type": "application/json" });
    const body = data === undefined ? undefined : JSON.stringify(data);
    const p = method === "GET" ? req.get(url)
        : method === "DELETE" ? req.del(url)
        : method === "PUT" ? req.put(url, body)
        : req.post(url, body);
    return p.then(res => res.json()).catch(err => {
        let pesan = "Terjadi kesalahan pada server";
        try { pesan = JSON.parse(err.responseText).error || pesan; } catch (e) { /* abaikan */ }
        if (err && err.status === 401 && !url.includes("/auth/")) {
            webix.message({ type: "error", text: "Sesi berakhir, silakan login ulang", expire: 3000 });
            setTimeout(() => location.reload(), 1200);
        } else {
            webix.message({ type: "error", text: pesan, expire: 5000 });
        }
        throw new Error(pesan);
    });
}

function bukaJendela(config) {
    if ($$(config.id)) $$(config.id).close();
    const w = webix.ui(config);
    w.show();
    return w;
}
function judul(teks) { return { view: "toolbar", elements: [{ view: "label", label: teks }] }; }
function tombol(label, fn, css) { return { view: "button", value: label, autowidth: true, css: css || "", click: fn }; }
function kotakCari(idGrid) {
    return {
        view: "search", placeholder: "Cari...", width: 240,
        on: { onTimedKeyPress() { const q = this.getValue().toLowerCase(); $$(idGrid).filter(o => JSON.stringify(Object.values(o)).toLowerCase().includes(q)); } }
    };
}
function pilihBaris(idGrid) {
    const r = $$(idGrid).getSelectedItem();
    if (!r) webix.message({ type: "error", text: "Pilih satu baris terlebih dahulu" });
    return r;
}
function buatGrid(id, kolom, extra) {
    return Object.assign({ view: "datatable", id: id, columns: kolom, select: true, resizeColumn: true, scroll: "auto", data: [] }, extra || {});
}
function isiGrid(id, data) { $$(id).clearAll(); $$(id).parse(data); }
function tampilDetail(judulJendela, html) {
    bukaJendela({ view: "window", id: "win_detail", head: judulJendela, modal: true, position: "center", width: 680, height: 520, close: true,
        body: { view: "template", scroll: "y", template: html } });
}
function konfirmasi(teks, fn) { webix.confirm({ title: "Konfirmasi", text: teks, ok: "Ya", cancel: "Batal" }).then(fn); }
function mintaAlasan(judulPrompt, fn) {
    webix.prompt({ title: judulPrompt, ok: "Kirim", cancel: "Batal", input: { placeholder: "Alasan (opsional)" } }).then(fn);
}
function dblKlik(fnDetail) {
    return { on: { onItemDblClick(id) { fnDetail(this.getItem(id.row)); } } };
}

/* ------------------------------ login & kerangka aplikasi ------------------------------ */
const formLogin = {
    view: "form", id: "formLogin", width: 360, borderless: false,
    elementsConfig: { labelWidth: 90 },
    elements: [
        { view: "label", label: "Login WMS Warehouse", css: "webix_header" },
        { view: "text", name: "username", label: "Username", required: true },
        { view: "text", name: "password", label: "Password", type: "password", required: true },
        { view: "button", value: "Login", css: "webix_primary", hotkey: "enter", click: prosesLogin }
    ]
};

function hancurkanRoot() {
    ["win_detail"].forEach(id => { if ($$(id)) $$(id).close(); });
    if ($$("root")) $$("root").destructor();
}

function tampilkanLogin() {
    hancurkanRoot();
    webix.ui({ id: "root", rows: [{}, { cols: [{}, formLogin, {}] }, {}] });
}

function prosesLogin() {
    const f = $$("formLogin");
    if (!f.validate()) { webix.message({ type: "error", text: "Username dan password wajib diisi" }); return; }
    panggilApi("POST", "/api/auth/login", f.getValues()).then(res => mulaiAplikasi(res.user));
}

function prosesLogout() {
    panggilApi("POST", "/api/auth/logout", {}).then(() => { userAktif = null; tampilkanLogin(); });
}

function daftarMenu() {
    const AM = ["admin", "manager"];
    return [
        { id: "dashboard", value: "Dashboard", bangun: halamanDashboard },
        { id: "items", value: "Barang dan Stok", bangun: halamanBarang },
        { id: "categories", value: "Kategori", roles: AM, bangun: halamanKategori },
        { id: "warehouses", value: "Warehouse", roles: AM, bangun: halamanWarehouse },
        { id: "suppliers", value: "Supplier", roles: [...AM, "purchasing"], bangun: halamanSupplier },
        { id: "requests", value: "Request Barang", bangun: halamanRequest },
        { id: "pos", value: "Purchase Order", bangun: halamanPO },
        { id: "opnames", value: "Stock Opname", roles: [...AM, "staff"], bangun: halamanOpname },
        { id: "stockcard", value: "Kartu Stok", bangun: halamanKartuStok },
        { id: "reports", value: "Laporan", roles: AM, bangun: halamanLaporan },
        { id: "audit", value: "Audit Log", roles: AM, bangun: halamanAudit },
        { id: "users", value: "Pengguna", roles: ["admin"], bangun: halamanPengguna }
    ];
}

function mulaiAplikasi(user) {
    userAktif = user;
    hancurkanRoot();
    const menu = daftarMenu().filter(m => !m.roles || m.roles.includes(user.role));
    webix.ui({
        id: "root",
        rows: [
            {
                view: "toolbar", elements: [
                    { view: "label", label: "WMS Warehouse", width: 220 },
                    {},
                    { view: "label", align: "right", width: 380, label: `${esc(user.full_name)} (${LABEL_ROLE[user.role]})` },
                    { view: "button", value: "Logout", width: 90, click: prosesLogout }
                ]
            },
            {
                cols: [
                    {
                        view: "list", id: "menu", width: 220, select: true, scroll: "auto", type: { height: 42 },
                        template: "#value#", data: menu.map(m => ({ id: m.id, value: m.value })),
                        on: { onAfterSelect(id) { $$("halaman").setValue(id); HALAMAN[id].muat(); } }
                    },
                    { view: "multiview", id: "halaman", animate: false, cells: menu.map(m => { const h = m.bangun(); HALAMAN[m.id] = h; return h.ui; }) }
                ]
            }
        ]
    });
    $$("menu").select("dashboard");
}

/* ------------------------------ halaman master data (CRUD) ------------------------------ */
// Pola sama dengan contoh: form tambah di atas, datatable dengan ikon edit/hapus, popup edit.
function buatElemen(prefix, f, mode, opsiSiap) {
    const el = { view: f.view || "text", id: prefix + f.name, name: f.name, label: f.label };
    if (f.placeholder) el.placeholder = f.placeholder;
    if (f.type) el.type = f.type;
    if (f.value !== undefined) el.value = f.value;
    if (f.min !== undefined) el.min = f.min;
    if (f.labelRight) { el.labelRight = f.labelRight; el.labelWidth = 0; el.label = ""; }
    if (f.required || (mode === "tambah" && f.wajibTambah)) el.required = true;
    if (f.options) el.options = f.options;
    if (f.optionsFrom) el.options = (opsiSiap && opsiSiap[f.name]) || [];
    return el;
}

async function ambilOpsi(fields) {
    const hasil = {};
    for (const f of fields.filter(x => x.optionsFrom)) {
        const res = await panggilApi("GET", f.optionsFrom);
        hasil[f.name] = res.data.map(d => d.name);
    }
    return hasil;
}

function halamanMaster(o) {
    const idGrid = "grid_" + o.id, idForm = "form_" + o.id;
    const bolehTulis = o.roleTulis.includes(userAktif.role);

    function muatData() {
        panggilApi("GET", o.url).then(res => isiGrid(idGrid, res.data));
        // opsi dropdown pada form tambah (kategori, warehouse) dimuat ulang tiap halaman dibuka
        if (!bolehTulis) return;
        o.fields.filter(f => f.optionsFrom).forEach(f => {
            panggilApi("GET", f.optionsFrom).then(res => {
                const list = $$("tambah_" + o.id + "_" + f.name).getList();
                list.clearAll();
                list.parse(res.data.map(d => ({ id: d.name, value: d.name })));
            });
        });
    }

    function tambahData() {
        const form = $$(idForm);
        if (!form.validate()) { webix.message({ type: "error", text: "Lengkapi isian yang wajib diisi" }); return; }
        panggilApi("POST", o.url, form.getValues()).then(() => {
            webix.message({ type: "success", text: o.judul + " berhasil ditambahkan" });
            form.clear();
            form.clearValidation();
            form.setValues(o.nilaiAwal || {});
            muatData();
        });
    }

    async function bukaFormEdit(item) {
        const prefix = "edit_" + o.id + "_", idWin = "win_edit_" + o.id;
        const opsi = await ambilOpsi(o.fields);
        bukaJendela({
            view: "window", id: idWin, head: "Edit " + o.judul, position: "center", modal: true, width: 420, close: true,
            body: {
                view: "form", id: "formEdit_" + o.id, elementsConfig: { labelWidth: 100 },
                elements: [
                    ...o.fields.map(f => buatElemen(prefix, f, "edit", opsi)),
                    {
                        cols: [
                            { view: "button", value: "Simpan", css: "webix_primary", click: () => simpanEdit(item.id) },
                            { view: "button", value: "Batal", click: () => $$(idWin).close() }
                        ]
                    }
                ]
            }
        });
        $$("formEdit_" + o.id).setValues(o.siapkanEdit ? o.siapkanEdit(item) : item);
    }

    function simpanEdit(id) {
        const form = $$("formEdit_" + o.id);
        if (!form.validate()) { webix.message({ type: "error", text: "Lengkapi isian yang wajib diisi" }); return; }
        panggilApi("PUT", `${o.url}/${id}`, form.getValues()).then(() => {
            webix.message({ type: "success", text: o.judul + " berhasil diperbarui" });
            $$("win_edit_" + o.id).close();
            muatData();
        });
    }

    function hapusData(id) {
        panggilApi("DELETE", `${o.url}/${id}`).then(() => {
            webix.message({ type: "success", text: o.judul + " berhasil dihapus" });
            muatData();
        });
    }

    // form tambah: dua kolom per baris, tombol di baris terakhir (seperti contoh)
    const baris = [];
    for (let i = 0; i < o.fields.length; i += 2) {
        baris.push(o.fields.slice(i, i + 2).map(f => buatElemen("tambah_" + o.id + "_", f, "tambah")));
    }
    const tombolTambah = { view: "button", value: "Tambah Data", css: "webix_primary", width: 150, click: tambahData };
    const terakhir = baris[baris.length - 1];
    if (terakhir.length === 1) terakhir.push(tombolTambah); else baris.push([{}, tombolTambah]);

    const formTambah = {
        view: "form", id: idForm, borderless: true, elementsConfig: { labelWidth: 100 },
        elements: [{ view: "label", label: "Tambah " + o.judul + " Baru", css: "webix_header" }, ...baris.map(r => ({ cols: r }))]
    };

    const kolom = o.columns.slice();
    if (bolehTulis) {
        kolom.push({ id: "edit", header: "", width: 50, template: "{common.editIcon()}" });
        kolom.push({ id: "hapus", header: "", width: 60, template: "{common.trashIcon()}" });
    }

    const grid = buatGrid(idGrid, kolom, {
        onClick: {
            "wxi-pencil": function (ev, id) { bukaFormEdit(this.getItem(id)); return false; },
            "wxi-trash": function (ev, id) {
                const item = this.getItem(id);
                webix.confirm({
                    title: "Konfirmasi Hapus",
                    text: `Yakin ingin menghapus <b>${esc(item[o.kolomNama || "name"])}</b>?`,
                    ok: "Ya, Hapus", cancel: "Batal"
                }).then(() => hapusData(item.id));
                return false;
            }
        }
    });

    const bar = [kotakCari(idGrid)];
    (o.tombolExtra || []).forEach(fn => bar.push(fn(idGrid)));
    bar.push({});

    const isi = [judul(o.judulHalaman)];
    if (bolehTulis) { isi.push(formTambah); isi.push({ view: "resizer" }); }
    isi.push({ view: "toolbar", elements: bar }, grid);

    return { muat: muatData, ui: { id: o.id, rows: isi } };
}

function halamanBarang() {
    return halamanMaster({
        id: "items", judul: "Barang", judulHalaman: "Barang dan Stok", url: "/api/items", roleTulis: ["admin", "manager"],
        nilaiAwal: { unit: "pcs", min_stock: 0 },
        fields: [
            { name: "code", label: "Kode", required: true, placeholder: "cth: BRG-010" },
            { name: "name", label: "Nama Barang", required: true },
            { name: "category", label: "Kategori", view: "richselect", required: true, optionsFrom: "/api/categories" },
            { name: "warehouse", label: "Warehouse", view: "richselect", optionsFrom: "/api/warehouses" },
            { name: "location", label: "Lokasi / Rak" },
            { name: "unit", label: "Satuan", value: "pcs" },
            { name: "min_stock", label: "Stok Min", view: "counter", value: 0, min: 0 }
        ],
        columns: [
            { id: "code", header: "Kode", width: 100, sort: "string" }, { id: "name", header: "Nama Barang", fillspace: true, minWidth: 180, sort: "string" },
            { id: "category", header: "Kategori", width: 130, sort: "string" }, { id: "warehouse", header: "Warehouse", width: 130, sort: "string" },
            { id: "location", header: "Lokasi", width: 80 },
            { id: "stock", header: "Stok", width: 80, sort: "int", template: o => o.stock <= o.min_stock ? `<span class="low">${o.stock}</span>` : o.stock },
            { id: "min_stock", header: "Min", width: 60 }, { id: "unit", header: "Satuan", width: 70 }
        ],
        tombolExtra: [idGrid => tombol("Buat Request dari Barang Terpilih", () => { const r = pilihBaris(idGrid); if (r) bukaFormRequest(r.id); })]
    });
}

function halamanKategori() {
    return halamanMaster({
        id: "categories", judul: "Kategori", judulHalaman: "Kategori Barang", url: "/api/categories", roleTulis: ["admin", "manager"],
        fields: [{ name: "name", label: "Nama", required: true }, { name: "description", label: "Deskripsi" }],
        columns: [{ id: "name", header: "Nama Kategori", width: 260, sort: "string" }, { id: "description", header: "Deskripsi", fillspace: true }]
    });
}

function halamanWarehouse() {
    return halamanMaster({
        id: "warehouses", judul: "Warehouse", judulHalaman: "Warehouse dan Lokasi", url: "/api/warehouses", roleTulis: ["admin", "manager"],
        fields: [{ name: "name", label: "Nama", required: true }, { name: "address", label: "Alamat" }],
        columns: [{ id: "name", header: "Nama Warehouse", width: 260, sort: "string" }, { id: "address", header: "Alamat / Keterangan", fillspace: true }]
    });
}

function halamanSupplier() {
    return halamanMaster({
        id: "suppliers", judul: "Supplier", judulHalaman: "Data Supplier", url: "/api/suppliers", roleTulis: ["admin", "manager", "purchasing"],
        fields: [
            { name: "name", label: "Nama", required: true }, { name: "contact", label: "Kontak" },
            { name: "phone", label: "Telepon" }, { name: "email", label: "Email" }, { name: "address", label: "Alamat" }
        ],
        columns: [
            { id: "name", header: "Nama Supplier", width: 220, sort: "string" }, { id: "contact", header: "Kontak", width: 150 },
            { id: "phone", header: "Telepon", width: 140 }, { id: "email", header: "Email", width: 220 }, { id: "address", header: "Alamat", fillspace: true }
        ]
    });
}

function halamanPengguna() {
    return halamanMaster({
        id: "users", judul: "Pengguna", judulHalaman: "Manajemen Pengguna", url: "/api/users", roleTulis: ["admin"], kolomNama: "username",
        nilaiAwal: { active: 1 },
        siapkanEdit: r => Object.assign({}, r, { active: r.active ? 1 : 0, password: "" }),
        fields: [
            { name: "username", label: "Username", required: true }, { name: "full_name", label: "Nama Lengkap", required: true },
            { name: "role", label: "Role", view: "richselect", required: true, options: ["admin", "manager", "staff", "purchasing"] },
            { name: "password", label: "Password", type: "password", wajibTambah: true, placeholder: "kosongkan jika tidak diubah" },
            { name: "active", view: "checkbox", labelRight: "Akun aktif", value: 1 }
        ],
        columns: [
            { id: "username", header: "Username", width: 160, sort: "string" }, { id: "full_name", header: "Nama Lengkap", fillspace: true, sort: "string" },
            { id: "role", header: "Role", width: 140, template: o => LABEL_ROLE[o.role] || o.role },
            { id: "active", header: "Aktif", width: 80, template: o => o.active ? "Ya" : "Tidak" }, { id: "created_at", header: "Dibuat", width: 150, format: fmtTanggal }
        ]
    });
}

/* ------------------------------ editor baris barang (Request & PO) ------------------------------ */
function jendelaBaris(o) {
    const T = o.id + "_grid", CB = o.id + "_item", Q = o.id + "_qty", PR = o.id + "_harga", F = o.id + "_form";
    const opsi = o.items.map(i => ({ id: i.id, value: `${i.code} - ${i.name} (stok ${i.stock} ${i.unit})` }));
    const kolom = [
        { id: "code", header: "Kode", width: 100 }, { id: "name", header: "Barang", fillspace: true }, { id: "qty", header: "Qty", width: 70 }
    ];
    if (o.harga) kolom.push({ id: "price", header: "Harga", width: 110, format: webix.i18n.numberFormat });
    kolom.push({ id: "hapus", header: "", width: 50, template: "{common.trashIcon()}" });

    function tambahBaris(item, qty, harga) {
        const ada = $$(T).find(r => r.item_id == item.id)[0];
        if (ada) { ada.qty += qty; if (harga) ada.price = harga; $$(T).updateItem(ada.id, ada); }
        else $$(T).add({ item_id: item.id, code: item.code, name: item.name, qty: qty, price: harga });
    }

    const barisTambah = [
        { view: "combo", id: CB, placeholder: "Cari dan pilih barang...", options: opsi },
        { view: "counter", id: Q, label: "Qty", labelWidth: 36, value: 1, min: 1, width: 130 }
    ];
    if (o.harga) barisTambah.push({ view: "counter", id: PR, label: "Harga", labelWidth: 50, value: 0, min: 0, step: 1000, width: 190 });
    barisTambah.push({
        view: "button", value: "Tambah Barang", width: 130, click: () => {
            const id = $$(CB).getValue();
            if (!id) { webix.message({ type: "error", text: "Pilih barang terlebih dahulu" }); return; }
            tambahBaris(o.items.find(i => i.id == id), +$$(Q).getValue() || 1, o.harga ? (+$$(PR).getValue() || 0) : undefined);
            $$(CB).setValue(""); $$(Q).setValue(1);
        }
    });

    function kirim() {
        const form = $$(F);
        if (!form.validate()) return;
        const baris = $$(T).serialize().map(r => ({ item_id: r.item_id, qty: +r.qty, price: r.price }));
        if (!baris.length) { webix.message({ type: "error", text: "Tambahkan minimal satu barang" }); return; }
        o.onKirim(form.getValues(), baris).then(() => $$(o.id).close());
    }

    bukaJendela({
        view: "window", id: o.id, head: o.judul, modal: true, position: "center", width: 780, close: true,
        body: {
            view: "form", id: F, elementsConfig: { labelWidth: 120 },
            elements: [
                ...(o.fields || []),
                { cols: barisTambah },
                { view: "datatable", id: T, height: 230, columns: kolom, data: [], onClick: { "wxi-trash": function (e, id) { this.remove(id.row); return false; } } },
                { cols: [{}, { view: "button", value: o.labelKirim, width: 150, css: "webix_primary", click: kirim }, { view: "button", value: "Batal", width: 100, click: () => $$(o.id).close() }] }
            ]
        }
    });
    const awal = o.items.find(i => i.id == o.preselect);
    if (awal) tambahBaris(awal, 1, undefined);
}

/* ------------------------------ request barang ------------------------------ */
function bukaFormRequest(preselect) {
    panggilApi("GET", "/api/items").then(res => jendelaBaris({
        id: "win_request", judul: "Request Barang Baru", items: res.data, preselect: preselect, labelKirim: "Kirim Request",
        fields: [{ view: "text", name: "purpose", label: "Keperluan" }],
        onKirim: (v, baris) => panggilApi("POST", "/api/requests", { purpose: v.purpose, lines: baris }).then(() => {
            webix.message({ type: "success", text: "Request terkirim. Status: Menunggu approval Manager" });
            if ($$("grid_requests")) HALAMAN.requests.muat();
        })
    }));
}

function detailRequest(r) {
    return `<div class="dtl"><div class="meta"><b>${esc(r.number)}</b> ${badge(r.status)}<br>Pemohon: ${esc(r.requester)} (${esc(r.requester_role)})<br>
        Keperluan: ${esc(r.purpose || "-")}<br>Dibuat: ${fmtTanggal(r.created_at)}<br>Approver: ${esc(r.approver || "-")} ${r.reject_reason ? " - " + esc(r.reject_reason) : ""}</div>
        <h4>Barang</h4>${buatTabel(["Kode", "Barang", "Qty"], r.lines.map(l => [l.code, l.name, `${l.qty} ${l.unit}`]))}
        <h4>Riwayat</h4>${buatTabel(["Waktu", "Oleh", "Aksi"], r.history.map(h => [fmtTanggal(h.at), h.by, h.action]))}</div>`;
}

function halamanRequest() {
    const G = "grid_requests";
    const muat = () => panggilApi("GET", "/api/requests").then(res => isiGrid(G, res.data));
    function aksi(nama, teks, tanyaAlasan) {
        const r = pilihBaris(G); if (!r) return;
        const jalankan = alasan => panggilApi("POST", `/api/requests/${r.id}/${nama}`, { reason: alasan }).then(() => {
            webix.message({ type: "success", text: "Berhasil" }); muat();
        });
        if (tanyaAlasan) mintaAlasan(`${teks} ${r.number}`, jalankan); else konfirmasi(`${teks} ${esc(r.number)}?`, () => jalankan(""));
    }
    const bar = [kotakCari(G), tombol("Refresh", muat), tombol("Request Baru", () => bukaFormRequest(), "webix_primary"),
        tombol("Detail", () => { const r = pilihBaris(G); if (r) tampilDetail(r.number, detailRequest(r)); })];
    if (userAktif.role === "manager") bar.push(tombol("Setujui", () => aksi("approve", "Setujui request", false)), tombol("Tolak", () => aksi("reject", "Tolak request", true)));
    if (userAktif.role === "staff") bar.push(tombol("Input Barang Keluar dan Serahkan", () => aksi("fulfill", "Input barang keluar dan serahkan untuk", false), "webix_primary"));
    bar.push({});
    return {
        muat: muat,
        ui: {
            id: "requests", rows: [judul("Request Barang"), { view: "toolbar", elements: bar }, buatGrid(G, [
                { id: "number", header: "No. Request", width: 120, sort: "string" }, { id: "requester", header: "Pemohon", width: 160, sort: "string" },
                { id: "lines", header: "Barang", fillspace: true, minWidth: 220, template: o => esc(o.lines.map(l => `${l.name} x${l.qty}`).join(", ")) },
                { id: "status", header: "Status", width: 130, sort: "string", template: o => badge(o.status) },
                { id: "created_at", header: "Dibuat", width: 150, format: fmtTanggal }, { id: "approver", header: "Approver", width: 140 }
            ], dblKlik(r => tampilDetail(r.number, detailRequest(r))))]
        }
    };
}

/* ------------------------------ purchase order ------------------------------ */
function detailPO(p) {
    return `<div class="dtl"><div class="meta"><b>${esc(p.number)}</b> ${badge(p.status)}<br>Supplier: ${esc(p.supplier)}<br>Dibuat oleh: ${esc(p.creator)} - ${fmtTanggal(p.created_at)}<br>
        Approver: ${esc(p.approver || "-")}<br>Catatan: ${esc(p.note || "-")}<br>Total: Rp ${rupiah(p.total)}</div>
        <h4>Barang</h4>${buatTabel(["Kode", "Barang", "Dipesan", "Diterima", "Harga"], p.lines.map(l => [l.code, l.name, l.qty, l.received || 0, rupiah(l.price)]))}
        ${p.claims && p.claims.length ? `<h4>Retur / Klaim ke Supplier</h4>${buatTabel(["Waktu", "Barang", "Qty", "Catatan", "Oleh"], p.claims.map(c => [fmtTanggal(c.at), c.name, c.qty, c.note, c.by]))}` : ""}
        <h4>Riwayat</h4>${buatTabel(["Waktu", "Oleh", "Aksi"], p.history.map(h => [fmtTanggal(h.at), h.by, h.action]))}</div>`;
}

function bukaFormPO() {
    Promise.all([panggilApi("GET", "/api/items"), panggilApi("GET", "/api/suppliers")]).then(([it, sp]) => jendelaBaris({
        id: "win_po", judul: "Purchase Order Baru", items: it.data, harga: true, labelKirim: "Ajukan PO",
        fields: [
            { view: "richselect", name: "supplier_id", label: "Supplier", required: true, options: sp.data.map(s => ({ id: s.id, value: s.name })) },
            { view: "text", name: "note", label: "Catatan" }
        ],
        onKirim: (v, baris) => panggilApi("POST", "/api/purchase-orders", { supplier_id: v.supplier_id, note: v.note, lines: baris }).then(() => {
            webix.message({ type: "success", text: "PO diajukan. Status: Menunggu approval Manager" });
            HALAMAN.pos.muat();
        })
    }));
}

function jendelaTerima(po) {
    const T = "grid_terima";
    const baris = po.lines.map(l => ({
        id: l.item_id, item_id: l.item_id, code: l.code, name: l.name, ordered: l.qty, received: l.received || 0,
        qty: l.qty - (l.received || 0), condition: "Sesuai", note: ""
    })).filter(r => r.qty > 0);
    bukaJendela({
        view: "window", id: "win_terima", head: "Cek dan Terima Barang - " + po.number, modal: true, position: "center", width: 900, close: true,
        body: {
            rows: [
                { template: "Isi <b>Qty Terima</b> dan <b>Kondisi</b> (klik sel untuk mengubah). <b>Sesuai</b>: stok bertambah. <b>Tidak Sesuai</b>: dicatat sebagai retur/klaim ke supplier (stok tidak bertambah).", height: 56, borderless: true },
                {
                    view: "datatable", id: T, height: 260, editable: true, editaction: "click", data: baris, columns: [
                        { id: "code", header: "Kode", width: 90 }, { id: "name", header: "Barang", fillspace: true },
                        { id: "ordered", header: "Dipesan", width: 80 }, { id: "received", header: "Sudah diterima", width: 110 },
                        { id: "qty", header: "Qty Terima", width: 100, editor: "text" },
                        { id: "condition", header: "Kondisi", width: 130, editor: "select", options: ["Sesuai", "Tidak Sesuai"] },
                        { id: "note", header: "Catatan klaim", width: 170, editor: "text" }
                    ]
                },
                {
                    cols: [{}, {
                        view: "button", value: "Simpan Penerimaan", width: 190, css: "webix_primary", click: () => {
                            $$(T).editStop();
                            const lines = $$(T).serialize().map(r => ({ item_id: r.item_id, qty: +r.qty || 0, condition: r.condition, note: r.note }));
                            panggilApi("POST", `/api/purchase-orders/${po.id}/receive`, { lines: lines }).then(() => {
                                $$("win_terima").close();
                                webix.message({ type: "success", text: "Penerimaan tersimpan" });
                                HALAMAN.pos.muat();
                            });
                        }
                    }, { view: "button", value: "Batal", width: 100, click: () => $$("win_terima").close() }]
                }
            ]
        }
    });
}

function halamanPO() {
    const G = "grid_pos";
    const muat = () => panggilApi("GET", "/api/purchase-orders").then(res => isiGrid(G, res.data));
    function aksi(nama, teks, tanyaAlasan) {
        const r = pilihBaris(G); if (!r) return;
        const jalankan = alasan => panggilApi("POST", `/api/purchase-orders/${r.id}/${nama}`, { reason: alasan }).then(() => {
            webix.message({ type: "success", text: "Berhasil" }); muat();
        });
        if (tanyaAlasan) mintaAlasan(`${teks} ${r.number}`, jalankan); else konfirmasi(`${teks} ${esc(r.number)}?`, () => jalankan(""));
    }
    const bar = [kotakCari(G), tombol("Refresh", muat), tombol("Detail", () => { const r = pilihBaris(G); if (r) tampilDetail(r.number, detailPO(r)); })];
    if (userAktif.role === "purchasing") bar.push(tombol("Buat PO", bukaFormPO, "webix_primary"));
    if (userAktif.role === "manager") bar.push(tombol("Setujui PO", () => aksi("approve", "Setujui", false)), tombol("Tolak PO", () => aksi("reject", "Tolak", true)));
    if (userAktif.role === "staff") bar.push(tombol("Cek dan Terima Barang", () => {
        const r = pilihBaris(G); if (!r) return;
        if (!["Ordered", "Partially Received"].includes(r.status)) { webix.message({ type: "error", text: "PO harus berstatus Ordered / Partially Received" }); return; }
        jendelaTerima(r);
    }, "webix_primary"));
    bar.push({});
    return {
        muat: muat,
        ui: {
            id: "pos", rows: [judul("Purchase Order dan Barang Masuk"), { view: "toolbar", elements: bar }, buatGrid(G, [
                { id: "number", header: "No. PO", width: 110, sort: "string" }, { id: "supplier", header: "Supplier", width: 180, sort: "string" },
                { id: "lines", header: "Barang (diterima/dipesan)", fillspace: true, minWidth: 220, template: o => esc(o.lines.map(l => `${l.name} ${l.received || 0}/${l.qty}`).join(", ")) },
                { id: "total", header: "Total (Rp)", width: 120, format: webix.i18n.numberFormat, css: { "text-align": "right" } },
                { id: "status", header: "Status", width: 150, sort: "string", template: o => badge(o.status) },
                { id: "creator", header: "Dibuat oleh", width: 140 }, { id: "created_at", header: "Tanggal", width: 150, format: fmtTanggal }
            ], dblKlik(r => tampilDetail(r.number, detailPO(r))))]
        }
    };
}

/* ------------------------------ stock opname ------------------------------ */
function detailOpname(p) {
    return `<div class="dtl"><div class="meta"><b>${esc(p.number)}</b> ${badge(p.status)}<br>Warehouse: ${esc(p.warehouse)}<br>Dibuat oleh: ${esc(p.created_by)} - ${fmtTanggal(p.created_at)}<br>
        Penghitung: ${esc(p.counted_by || "-")} (putaran hitung ke-${p.round})<br>Approver: ${esc(p.approver || "-")}</div>
        <h4>Hasil Hitung</h4>${buatTabel(["Kode", "Barang", "Sistem", "Fisik", "Selisih"], p.lines.map(l => [l.code, l.name, l.system_qty, l.counted == null ? "-" : l.counted, l.diff == null ? "-" : l.diff]))}
        <h4>Riwayat</h4>${buatTabel(["Waktu", "Oleh", "Aksi"], p.history.map(h => [fmtTanggal(h.at), h.by, h.action]))}</div>`;
}

function jendelaHitung(op) {
    const T = "grid_hitung";
    const baris = op.lines.map(l => ({
        id: l.item_id, item_id: l.item_id, code: l.code, name: l.name, system_qty: l.system_qty,
        counted: l.counted == null ? "" : l.counted, diff: l.diff == null ? "" : l.diff
    }));
    bukaJendela({
        view: "window", id: "win_hitung", head: `Input Hasil Hitung Fisik - ${op.number} (putaran ${op.round})`, modal: true, position: "center", width: 820, close: true,
        body: {
            rows: [
                { template: "Klik kolom <b>Hitung Fisik</b> untuk mengisi hasil hitung. Semua barang wajib diisi. Selisih dihitung otomatis oleh sistem.", height: 44, borderless: true },
                {
                    view: "datatable", id: T, height: 340, editable: true, editaction: "click", data: baris,
                    columns: [
                        { id: "code", header: "Kode", width: 100 }, { id: "name", header: "Barang", fillspace: true },
                        { id: "system_qty", header: "Stok Sistem", width: 100 }, { id: "counted", header: "Hitung Fisik", width: 110, editor: "text", css: { background: "#fffbe6" } },
                        { id: "diff", header: "Selisih", width: 90, template: o => o.diff === "" ? "" : (o.diff != 0 ? `<span class="low">${o.diff}</span>` : "0") }
                    ],
                    on: { onAfterEditStop(state, ed) { const r = this.getItem(ed.row); r.diff = r.counted === "" ? "" : (+r.counted - r.system_qty); this.refresh(ed.row); } }
                },
                {
                    cols: [{}, {
                        view: "button", value: "Kirim Hasil Hitung", width: 180, css: "webix_primary", click: () => {
                            $$(T).editStop();
                            const counts = $$(T).serialize().map(r => ({ item_id: r.item_id, counted: r.counted }));
                            panggilApi("POST", `/api/opnames/${op.id}/count`, { counts: counts }).then(res => {
                                $$("win_hitung").close();
                                webix.message({ text: "Hasil hitung dikirim. Status: " + res.status, expire: 5000 });
                                HALAMAN.opnames.muat();
                            });
                        }
                    }, { view: "button", value: "Batal", width: 100, click: () => $$("win_hitung").close() }]
                }
            ]
        }
    });
}

function halamanOpname() {
    const G = "grid_opnames";
    const muat = () => panggilApi("GET", "/api/opnames").then(res => isiGrid(G, res.data));
    function aksi(nama, teks, tanyaAlasan) {
        const r = pilihBaris(G); if (!r) return;
        const jalankan = alasan => panggilApi("POST", `/api/opnames/${r.id}/${nama}`, { reason: alasan }).then(() => {
            webix.message({ type: "success", text: "Berhasil" }); muat();
        });
        if (tanyaAlasan) mintaAlasan(`${teks} ${r.number}`, jalankan); else konfirmasi(`${teks} ${esc(r.number)}? Stok akan disesuaikan.`, () => jalankan(""));
    }
    function buatSesi() {
        panggilApi("GET", "/api/warehouses").then(res => bukaJendela({
            view: "window", id: "win_sesi", head: "Buat Sesi Stock Opname", modal: true, position: "center", width: 420, close: true,
            body: {
                view: "form", id: "form_sesi", elementsConfig: { labelWidth: 100 }, elements: [
                    { view: "richselect", name: "warehouse", label: "Warehouse", value: "", options: [{ id: "", value: "Semua warehouse" }, ...res.data.map(x => ({ id: x.name, value: x.name }))] },
                    { view: "text", name: "note", label: "Catatan" },
                    {
                        cols: [
                            { view: "button", value: "Buat Sesi", css: "webix_primary", click: () => panggilApi("POST", "/api/opnames", $$("form_sesi").getValues()).then(() => { $$("win_sesi").close(); webix.message({ type: "success", text: "Sesi opname dibuat" }); muat(); }) },
                            { view: "button", value: "Batal", click: () => $$("win_sesi").close() }
                        ]
                    }
                ]
            }
        }));
    }
    const bar = [kotakCari(G), tombol("Refresh", muat), tombol("Detail", () => { const r = pilihBaris(G); if (r) tampilDetail(r.number, detailOpname(r)); })];
    if (["admin", "manager"].includes(userAktif.role)) bar.push(tombol("Buat Sesi Opname", buatSesi, "webix_primary"));
    if (userAktif.role === "staff") bar.push(tombol("Input Hasil Hitung", () => {
        const r = pilihBaris(G); if (!r) return;
        if (!["Input Hitung", "Hitung Ulang"].includes(r.status)) { webix.message({ type: "error", text: "Sesi ini tidak dalam tahap input hitung" }); return; }
        jendelaHitung(r);
    }, "webix_primary"));
    if (userAktif.role === "manager") bar.push(tombol("Setujui Adjustment", () => aksi("approve", "Setujui adjustment", false)), tombol("Tolak (hitung ulang)", () => aksi("reject", "Tolak adjustment", true)));
    bar.push({});
    return {
        muat: muat,
        ui: {
            id: "opnames", rows: [judul("Stock Opname"), { view: "toolbar", elements: bar }, buatGrid(G, [
                { id: "number", header: "No. Opname", width: 120, sort: "string" }, { id: "warehouse", header: "Warehouse", width: 160 },
                { id: "status", header: "Status", width: 160, sort: "string", template: o => badge(o.status) },
                { id: "round", header: "Putaran", width: 80 },
                { id: "diffs", header: "Item Selisih", width: 100, template: o => o.lines.filter(l => l.diff).length },
                { id: "counted_by", header: "Penghitung", width: 150 }, { id: "created_by", header: "Dibuat oleh", width: 150 },
                { id: "created_at", header: "Tanggal", width: 150, format: fmtTanggal }, { id: "note", header: "Catatan", fillspace: true }
            ], dblKlik(r => tampilDetail(r.number, detailOpname(r))))]
        }
    };
}

/* ------------------------------ kartu stok ------------------------------ */
function halamanKartuStok() {
    const G = "grid_kartu";
    const muatTransaksi = () => {
        const id = $$("filter_kartu").getValue();
        panggilApi("GET", "/api/transactions" + (id ? "?item_id=" + id : "")).then(res => isiGrid(G, res.data));
    };
    const muat = () => panggilApi("GET", "/api/items").then(res => {
        const list = $$("filter_kartu").getList();
        list.clearAll();
        list.parse([{ id: "", value: "Semua barang" }, ...res.data.map(i => ({ id: i.id, value: `${i.code} - ${i.name}` }))]);
        muatTransaksi();
    });
    return {
        muat: muat,
        ui: {
            id: "stockcard", rows: [judul("Kartu Stok"), {
                view: "toolbar", elements: [
                    { view: "combo", id: "filter_kartu", width: 360, placeholder: "Filter barang...", options: [], on: { onChange: muatTransaksi } },
                    tombol("Refresh", muat), {}
                ]
            }, buatGrid(G, [
                { id: "at", header: "Tanggal", width: 150, format: fmtTanggal }, { id: "code", header: "Kode", width: 100 }, { id: "name", header: "Barang", fillspace: true },
                { id: "type", header: "Tipe", width: 70, template: o => `<span class="badge ${o.type === "IN" ? "ok" : o.type === "OUT" ? "bad" : "warn"}">${o.type}</span>` },
                { id: "qty", header: "Qty", width: 80 }, { id: "balance", header: "Saldo", width: 80 },
                { id: "ref_no", header: "Referensi", width: 120 }, { id: "by", header: "Oleh", width: 160 }
            ])]
        }
    };
}

/* ------------------------------ dashboard ------------------------------ */
function halamanDashboard() {
    function kartu(d) {
        const s = d.stats || {};
        const k = (v, l, css) => `<div class="card ${css || ""}"><div class="v">${v == null ? "-" : v}</div><div class="l">${l}</div></div>`;
        return `<div class="cards">${k(s.items, "Jenis barang")}${k(s.total_stock, "Total unit stok", "ok")}${k(s.low_stock, "Barang stok menipis", "bad")}
            ${k(s.pending_requests, "Request menunggu approval", "warn")}${k(s.ready_requests, "Request siap diserahkan / backorder", "warn")}
            ${k(s.pending_pos, "PO menunggu approval", "warn")}${k(s.open_pos, "PO dalam pengiriman supplier")}${k(s.pending_opnames, "Adjustment opname menunggu approval", "warn")}</div>`;
    }
    const muat = () => panggilApi("GET", "/api/dashboard").then(d => {
        $$("kartu_dashboard").setValues(d);
        isiGrid("grid_stok_menipis", d.low_items);
        isiGrid("grid_transaksi_terakhir", d.recent);
    });
    return {
        muat: muat,
        ui: {
            id: "dashboard", rows: [
                judul("Dashboard - " + LABEL_ROLE[userAktif.role]),
                { view: "template", id: "kartu_dashboard", height: 210, borderless: true, scroll: false, template: kartu, data: {} },
                {
                    cols: [
                        {
                            rows: [{ template: "Barang di bawah stok minimum", type: "header" }, buatGrid("grid_stok_menipis", [
                                { id: "code", header: "Kode", width: 90 }, { id: "name", header: "Barang", fillspace: true },
                                { id: "stock", header: "Stok", width: 70, css: "low" }, { id: "min_stock", header: "Min", width: 60 }, { id: "unit", header: "Satuan", width: 70 }
                            ])]
                        },
                        {
                            rows: [{ template: "Transaksi stok terakhir", type: "header" }, buatGrid("grid_transaksi_terakhir", [
                                { id: "at", header: "Waktu", width: 140, format: fmtTanggal }, { id: "name", header: "Barang", fillspace: true },
                                { id: "type", header: "Tipe", width: 60 }, { id: "qty", header: "Qty", width: 60 }, { id: "ref_no", header: "Ref", width: 100 }
                            ])]
                        }
                    ]
                }
            ]
        }
    };
}

/* ------------------------------ laporan ------------------------------ */
function halamanLaporan() {
    const jenis = () => $$("jenis_laporan").getValue();
    const tampilkan = () => panggilApi("GET", `/api/reports/${jenis()}/json`).then(res => {
        const kolom = res.headers.map((h, i) => ({ id: "c" + i, header: h, fillspace: true, minWidth: 90 }));
        const data = res.rows.map((baris, idx) => { const o = { id: idx + 1 }; baris.forEach((v, i) => { o["c" + i] = v; }); return o; });
        $$("grid_laporan").refreshColumns(kolom);
        isiGrid("grid_laporan", data);
    });
    const unduh = format => window.open(`/api/reports/${jenis()}/${format}`, "_blank");
    return {
        muat: tampilkan,
        ui: {
            id: "reports", rows: [judul("Monitoring dan Laporan"), {
                view: "toolbar", elements: [
                    {
                        view: "richselect", id: "jenis_laporan", width: 300, value: "inventory", options: [
                            { id: "inventory", value: "Stok dan Saldo Inventory" }, { id: "low_stock", value: "Barang di Bawah Stok Minimum" },
                            { id: "stock_card", value: "Kartu Stok (IN / OUT / ADJ)" }, { id: "requests", value: "Rekap Request Barang" }, { id: "purchase_orders", value: "Rekap Purchase Order" }
                        ],
                        on: { onChange: tampilkan }
                    },
                    tombol("Tampilkan", tampilkan), tombol("Unduh Excel (.xlsx)", () => unduh("xlsx"), "webix_primary"), tombol("Unduh PDF", () => unduh("pdf"), "webix_primary"), {}
                ]
            }, buatGrid("grid_laporan", [{ id: "c0", header: "" }])]
        }
    };
}

/* ------------------------------ audit log ------------------------------ */
function halamanAudit() {
    const G = "grid_audit";
    const muat = () => panggilApi("GET", "/api/audit-logs").then(res => isiGrid(G, res.data));
    return {
        muat: muat,
        ui: {
            id: "audit", rows: [judul("Audit Log"), { view: "toolbar", elements: [kotakCari(G), tombol("Refresh", muat), {}] }, buatGrid(G, [
                { id: "at", header: "Waktu", width: 150, format: fmtTanggal }, { id: "user", header: "User", width: 120 }, { id: "role", header: "Role", width: 100 },
                { id: "action", header: "Aksi", width: 100 }, { id: "entity", header: "Entitas", width: 140 }, { id: "ref", header: "Ref ID", width: 210 }, { id: "detail", header: "Detail", fillspace: true }
            ])]
        }
    };
}

/* ------------------------------ mulai ------------------------------ */
panggilApi("GET", "/api/auth/me").then(res => res.user ? mulaiAplikasi(res.user) : tampilkanLogin());
