# Report Harian

Menu owner: **Laporan → Report Harian** (`/reports/daily`). Filter bulan/tahun default bulan berjalan WIB, Semua Outlet/outlet milik business, serta Omset/Metode Pembayaran.

## Definisi angka

- Hanya `Sale.status = PAID`, menggunakan `grandTotal` setelah diskon dan sebelum fee channel. Pending, cancelled, rejected, completed yang tidak berstatus PAID, serta void tidak dihitung.
- Tanggal menggunakan `createdAt` dalam WIB (Asia/Jakarta), konsisten dengan laporan penjualan existing. Order yang dibuat kemarin dan dibayar hari ini masuk ke tanggal dibuatnya. Hal ini ditampilkan pada halaman.
- Semua tanggal bulan muncul, termasuk tanggal mendatang dan hari nol transaksi.
- AOV harian = omset hari / jumlah order hari. AOV TOTAL = omset bulan / jumlah order bulan, bukan rata-rata AOV harian. Pembagi nol menghasilkan 0.
- Metode pembayaran berasal dari enum Prisma `PaymentMethod`; tidak menambahkan metode fiktif seperti Transfer/E-Wallet. Transaksi legacy yang metode pembayarannya null masuk `OTHER` / Lainnya. Jumlah seluruh metode = total omset.
- Metode terbesar memakai total nominal bulan dan persentase nominal / total pembayaran. Bulan kosong menampilkan belum ada pembayaran.

## API

`GET /api/reports/daily?month=9&year=2026&type=revenue&outletId=...`

- `month`: 1–12; `year`: 2000–9999.
- `type`: `revenue` atau `payment-method`, default revenue.
- `outletId` opsional; tanpa outlet berarti seluruh outlet business.
- Response: `rows`, `totals`, `paymentMethods`, `topPaymentMethod`, `outlets`, metadata bulan/timezone/dateBasis.
- Endpoint lama `/api/reports/daily?date=YYYY-MM-DD&outletId=...` tetap kompatibel saat month/year tidak diberikan.

`GET /api/reports/daily/transactions?date=2026-09-04&outletId=...&page=1&pageSize=25`

- Detail berhalaman (maksimal 100 transaksi per halaman), memakai status/tanggal/outlet/tenant yang sama dengan ringkasan.
- Response memuat waktu, nomor order/transaksi, customer, order type, payment method, total, kasir dan outlet, serta total halaman.
- Count dan daftar transaksi dibaca dalam snapshot RepeatableRead.
- Klik nomor membuka `/sales/:id`. Owner dapat membuka transaksi historis milik business sendiri walaupun outlet sudah nonaktif. Akses kasir/supervisor tetap mengikuti batas outlet aktif existing.

Kedua endpoint baru khusus OWNER. Business berasal dari user yang terautentikasi; businessId query ditolak. Outlet business lain ditolak sebelum agregasi. Query SQL memakai parameter, bukan interpolasi input user.

## Database dan performa

Backend mengagregasi `SUM(grand_total)` dan `COUNT(*)` per tanggal/metode langsung di PostgreSQL. Aplikasi hanya melengkapi baris tanggal nol dan menjumlahkan grup kecil untuk TOTAL. Frontend tidak mengunduh semua transaksi untuk menghitung laporan.

Migration `20260907000000_daily_report_indexes` menambahkan index `sales(business_id,status,created_at)` dan `sales(business_id,outlet_id,status,created_at)`. Index lama tetap ada. Filter waktu memakai rentang UTC setengah terbuka, sementara konversi tanggal WIB hanya pada grouping.

## UI dan pengujian

Format uang memakai pemisah ribuan Indonesia. Mobile memiliki filter bertumpuk, tabel horizontal scroll, kolom tanggal sticky, dan TOTAL dengan warna berbeda. Filter dan tanggal drill-down disimpan di URL agar tetap tersedia saat browser kembali dari detail transaksi.

Pemeriksaan: `pnpm build`, `pnpm test`, dan `pnpm --filter api prisma validate`. Suite Report Harian mencakup akses role/tenant/outlet, bulan invalid, Februari dan leap year, tanggal kosong, AOV tertimbang, metode null, persentase metode terbesar, parameter/grouping SQL, pagination, serta detail null kasir. Browser QA memakai fixture lokal, memeriksa tampilan desktop/mobile dan klik tanggal; bukan transaksi customer nyata.

## Perbaikan nomor checkout

Pada 7 September 2026, checkout ditemukan mencoba memakai `FORU-Foru1-20260907-0001` yang sudah dipakai order hari sebelumnya yang baru dibayar. Penyebab: penghitung lama memakai jumlah sale dengan `createdAt` hari ini.

Allocator baru memakai counter database atomik per prefix/kode outlet/tanggal. Counter awal mengambil suffix nomor existing dari semua tanggal pembuatan sale, sehingga pembayaran order lama tetap diperhitungkan. Reservasi nomor tidak ikut rollback sale; gap nomor bisa terjadi ketika transaksi gagal, tetapi nomor tidak dipakai ulang. Namespace counter global mengikuti unique constraint nomor sale, termasuk saat kode outlet sama di business berbeda.

Migration counter terpisah dari index laporan. Terapkan migration sebelum restart API versi baru. Tidak mengubah atau menghapus transaksi existing.

## Verifikasi production — 7 September 2026

Build API/web, 81 tes, validasi Prisma, dan kedua migration berhasil di VPS. HTTPS health serta halaman Report Harian aktif. Angka agregasi semua outlet dan outlet tertentu cocok dengan database; jumlah metode pembayaran sama dengan omset, AOV dan drill-down sesuai, serta akses outlet tenant lain ditolak.

Uji PostgreSQL nyata berhasil mereservasi 20 nomor bersamaan tanpa duplikasi. Regresi order dibuat kemarin dan dibayar hari ini menghasilkan suffix berikutnya; fixture transaksi di-rollback dan counter verifikasi dibersihkan.

Backup sebelum deployment: /opt/foru-pos/deploy/backups/daily-report-checkout-20260907T091914Z.
