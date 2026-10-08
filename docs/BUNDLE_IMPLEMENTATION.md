# Menu Group & Bundle — status implementasi

## Phase 1: database dan backend engine

Menu Group menggunakan Category existing, termasuk urutan per outlet. Tidak menambahkan kembali multiple kategori produk.

Model baru: ProductBundle, ProductBundleOutlet, ProductBundleGroup, ProductBundleChoice. Model Bundle/BundleItem legacy tetap utuh. Tidak ada perubahan data produk, order, atau stok saat migration.

Migration: `apps/api/prisma/migrations/20261008000000_product_bundle_engine/migration.sql`.
Migration perlu diterapkan sebelum endpoint bundle dipakai. Jangan deploy kode tanpa migration, karena penghapusan master produk/tenant juga memeriksa relasi bundle baru.

### API authenticated

- GET /api/bundles — owner/supervisor, filter outletId/status; maksimum 200 konfigurasi.
- GET /api/bundles/:id — owner/supervisor.
- POST /api/bundles — owner/supervisor, membuat konfigurasi lengkap.
- PUT /api/bundles/:id — owner/supervisor, mengganti konfigurasi lengkap secara atomic.
- DELETE /api/bundles/:id — owner/supervisor, nonaktifkan (bukan hapus permanen).
- POST /api/bundles/:id/preview — user yang berhak mengakses outlet, kalkulasi tanpa membuat transaksi atau mengurangi stok.

Business selalu dari token. Body bersifat strict: businessId, baseHpp, dan harga dari customer ditolak. Kategori/outlet/produk/variant/opsi pada konfigurasi diperiksa backend. Paket baru default INACTIVE.

Contoh POST (ganti ID dengan master existing tenant):

```json
{
  "name": "Paket Lunch",
  "categoryId": "CATEGORY_ID",
  "basePrice": 35000,
  "status": "ACTIVE",
  "outlets": [{"outletId": "OUTLET_ID", "gofoodPrice": 40000}],
  "groups": [
    {
      "name": "Pilih makanan",
      "minSelect": 1,
      "maxSelect": 1,
      "items": [
        {"productId": "CHICKEN_ID", "additionalPrice": 0},
        {"productId": "BEEF_ID", "additionalPrice": 5000}
      ]
    },
    {
      "name": "Minuman tetap",
      "isFixed": true,
      "items": [{"productId": "TEA_ID", "variantId": "REGULAR_ID"}]
    }
  ]
}
```

Ambil itemId dari response konfigurasi untuk preview:

```json
{
  "outletId": "OUTLET_ID",
  "surface": "POS",
  "channel": "DINE_IN",
  "qty": 2,
  "selections": [{"itemId": "CHOICE_ID"}]
}
```

Group fixed otomatis dimasukkan. Customer tidak boleh mengganti variantId/fixedOptionIds yang dipatok admin. Produk dengan option group memakai selectedVariantOptionIds existing. Min/max menghitung jumlah pilihan berbeda, bukan jumlah unit komponen. qty pada konfigurasi adalah unit produk per paket; surcharge dan HPP dikalikan qty tersebut.

Harga = harga bundle sesuai outlet/channel + surcharge item + surcharge variant. Harga jual normal komponen tidak dijumlahkan. Variant surcharge menggunakan rule existing dibanding harga dasar dine-in efektif. HPP = HPP actual komponen; outlet HPP override menang, legacy variant memakai HPP absolut jika tidak ada override, option group memakai HPP incremental. Tidak ada stok/HPP master untuk bundle.

Preview memeriksa stok manual gabungan dan availability resep lewat helper existing. Preview bukan reservasi; transaksi fase berikutnya wajib melakukan pemeriksaan/pengurangan atomic, termasuk persaingan bahan bersama antarproduk dan order lain. Snapshot hasil engine telah tersedia, tetapi belum dipersist ke SaleItem.

PUT mengganti ID group/choice. Client harus mengambil konfigurasi terbaru setelah edit; pilihan lama ditolak, bukan dipaksakan menjadi pilihan baru. Menambahkan UI diff/stable ID dapat dilakukan sebelum integrasi cart.

Force delete produk menghapus referensi choice dan menonaktifkan paket terkait. Hapus biasa menolak produk yang masih direferensikan paket. Hapus tenant menghapus konfigurasi paket lebih dahulu.

## Phase 2: admin UI

Menu **Master Data → Bundle / Combo**, URL `/bundles`, khusus Owner/Supervisor. Cashier tidak melihat menu dan direct URL diarahkan kembali ke POS. Backend tetap memeriksa role/tenant.

Tersedia:

- Daftar paket, cari nama/kategori, filter outlet/status, edit dan nonaktifkan.
- Nama, kategori existing, deskripsi, harga dasar, status default INACTIVE, urutan paket.
- Upload foto/kamera menggunakan endpoint upload produk existing; storage tenant dan kompresi WEBP tetap sama.
- Channel POS/Web Order, periode opsional menggunakan zona waktu perangkat.
- Assignment banyak outlet, toggle aktif setiap outlet, harga Dine In/Take Away dan GoFood/GrabFood/ShopeeFood. Kosong = fallback; angka 0 tetap harga 0.
- Grup tetap atau customer choice, required/min/max, tambah/hapus/reorder grup dan item menggunakan tombol naik/turun.
- Produk existing, search nama/SKU, variant legacy atau opsi variant modern tetap, qty komponen, surcharge per unit, default/aktif.
- Validasi form, status saving/uploading, cegah double submit, dan konfirmasi menutup perubahan yang belum tersimpan.

### Checklist pengujian lokal

1. Terapkan migration Phase 1 pada database lokal lalu jalankan API/frontend.
2. Login Owner atau Supervisor, buka Master Data → Bundle / Combo.
3. Buat paket dengan dua grup (pilih makanan + minuman tetap), kategori dan outlet valid.
4. Pastikan status default INACTIVE, harga kosong pada outlet memakai fallback, harga 0 tetap tersimpan sebagai 0.
5. Simpan, buka Edit, pastikan pilihan/variant, urutan, foto, periode dan harga outlet tetap sama.
6. Ubah urutan grup/item, simpan dan buka ulang.
7. Coba min/max tidak valid, qty 0, produk kosong, dan periode terbalik; form harus menolak.
8. Nonaktifkan paket, gunakan filter INACTIVE untuk melihatnya.
9. Login Cashier: menu tidak tampil dan direct URL `/bundles` tidak boleh membuka editor.
10. POS/Web Order tetap menggunakan menu normal; paket belum tampil pada fase ini.

Unit test memeriksa serialisasi form terhadap schema backend (termasuk edit, fallback/zero, periode dan validasi), bukan pengganti uji CRUD pada database. Migration dan UI end-to-end belum diuji pada database lokal karena Docker lokal tidak berjalan pada pengecekan Phase 1.

## Phase 3: POS dan transaksi

Bundle ACTIVE kini dimuat dari `/api/pos/bundles` sesuai business/outlet aktif, kategori aktif, periode dan channel POS. Kategori yang hanya mempunyai bundle di outlet juga bisa diatur urutannya. Produk biasa tetap berasal dari endpoint existing.

- Kasir memilih isi paket, variant legacy/option group, dan catatan. Grup tetap otomatis dimasukkan.
- Preview backend menentukan harga, surcharge dan HPP; tombol tambah menunggu preview valid. Pilihan habis/nonaktif tidak dapat dipilih. Isi paket tampil di cart.
- Cart key memuat fingerprint pilihan/variant agar dua konfigurasi paket tidak tercampur. Harga cart mengikuti channel saat order type berubah.
- API POS menerima bundleId + bundleSelections; harga/HPP/snapshot dari client ditolak. Normal product tetap mendukung quantity existing, bundle maksimal 50 per baris.
- Mixed-cart memeriksa stok manual gabungan (produk biasa + seluruh pilihan bundle) dengan query batch.
- SaleItem menyimpan satu baris pendapatan paket dengan itemType=BUNDLE, bundleId dan bundleSelectionsJson. Komponen tidak membuat baris pendapatan tambahan.
- Migration Phase 3: `20261008010000_bundle_sale_snapshot`; historical normal SaleItem otomatis bertipe PRODUCT tanpa mengubah nilai transaksi.
- Harga, snapshot, sale dan coupon usage dibuat dalam transaction. Edit open bill memakai lock/status check; payment mengambil ulang total order setelah lock agar update bersamaan tidak memakai total lama.
- Payment menggunakan snapshot isi order untuk stok. Produk/variant nonaktif atau hilang menolak pembayaran paket. Harga/HPP snapshot tidak dihitung ulang saat bayar tanpa edit; edit bill menghitung ulang sesuai master terbaru.
- Pengurangan stok memakai unit komponen × qty paket. MANUAL mengurangi ProductOutlet; RECIPE mengurangi bahan/sub-resep. Inventory movement tetap menunjuk parent SaleItem. Penjualan dalam outlet diserialisasi dengan advisory transaction lock dan perubahan bahan memakai row lock.
- Open bill tidak mengurangi stok. Cancel open bill tidak mengembalikan stok yang belum dikurangi. Void PAID memakai ledger movement existing (bukan master bundle/resep yang mungkin sudah berubah).
- Force delete produk ditolak jika masih dipakai di snapshot paket pada order aktif.
- Thermal receipt/item list menampilkan parent paket dan isi. Thermal/browser kitchen ticket menampilkan jumlah actual komponen. Printer outlet existing tetap dipakai; routing per komponen/mitra belum ditambahkan.
- Laporan pendapatan tetap menghitung paket sekali, dengan HPP aktual. Laporan component usage khusus belum ditambahkan.

### Checklist lokal Phase 3

1. Jalankan database lokal dan terapkan kedua migration bundle; Prisma generate lalu rebuild API/frontend.
2. Buat bundle ACTIVE, kategori ACTIVE, assignment outlet aktif dan channel POS aktif; buka shift kasir.
3. Buka POS, pilih bundle dengan dua grup; cek min/max, variant dan surcharge sebelum tambah ke cart.
4. Tambahkan pilihan berbeda untuk paket yang sama; harus menjadi baris terpisah. Pilihan identik tanpa catatan boleh digabung.
5. Ganti Dine In ke GoFood/GrabFood/ShopeeFood; harga paket mengikuti konfigurasi outlet/channel plus surcharge.
6. Campurkan bundle + produk biasa yang memakai stok manual sama. Quantity gabungan melebihi stok harus ditolak backend tanpa sale/stock movement parsial.
7. Simpan Open Bill: cart kosong, snapshot isi tersimpan, stok belum berubah. Buka Edit POS lalu update: ID bill tetap, tidak menambah bill baru.
8. Bayar bundle qty 2 dengan component qty 2: stok underlying berkurang 4 unit. Recipe dengan bahan bersama antarproduk tidak boleh oversell; kegagalan harus rollback seluruh sale/stock/coupon.
9. Coba pembayaran ganda/bersamaan: hanya satu sukses. Ini perlu uji database nyata; unit mock bukan bukti concurrency PostgreSQL.
10. Void PAID: manual/bahan kembali sesuai ledger sekali. Perubahan master sesudah penjualan tidak mengubah snapshot historis.
11. Cetak customer/kitchen; kitchen qty actual, catatan tertera. Cek laporan tidak menggandakan pendapatan/HPP komponen.
12. Tenant B tidak boleh memuat/membeli bundle tenant A; user outlet lain harus ditolak.

Unit test memeriksa mixed pricing, agregasi manual stock, snapshot/payment checks, cart fingerprint/restoration, surcharge dan printer. Build/Prisma validation tidak membuktikan migration atau lifecycle PostgreSQL sudah lulus. Docker lokal masih tidak berjalan; migration, test CRUD/paid/void/concurrency dan physical printer belum diverifikasi end-to-end.

## Fase berikutnya

Bundle belum tampil pada customer Web Order/Daily Pre-Order. Endpoint public existing tidak menerima bundle pada fase ini.

- Phase 4: Web Order dan Daily Pre-Order (quota, tanggal layanan, mitra produksi).
- Phase berikutnya: receipt/kitchen, laporan bundle sales dan component usage, pengujian end-to-end.

Belum commit, push, atau deploy VPS. Migration belum dijalankan pada database production.
