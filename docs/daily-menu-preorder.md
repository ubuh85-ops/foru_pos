# Daily Menu Pre-Order

## Mengaktifkan

1. Terapkan migration baru `20260929000000_daily_menu_preorder` menggunakan prosedur deployment database proyek: `pnpm --filter api prisma migrate deploy`.
2. Generate Prisma Client (`pnpm db:generate`), build (`pnpm build`), lalu restart API dan sajikan frontend hasil build.
3. Di **Outlet → konfigurasi Web Order**, aktifkan Web Order dan Pre-Order. Pilih `PREORDER_ONLY` atau `NORMAL_AND_PREORDER`, lalu tentukan jumlah hari yang ditampilkan.
4. Buka **Daily Menu Schedule**, pilih outlet/tanggal, kemudian tambahkan Master Product. Harga kosong memakai harga outlet; kuota kosong tanpa batas; cutoff kosong berarti tanpa cutoff tambahan selama tanggal masih dalam rentang pemesanan.
5. Buka Web Order outlet. Pilih tanggal dan produk secara individual. Satu checkout dapat memuat beberapa tanggal.
6. Gunakan **Rekap Daily Pre-Order** untuk produksi, drill-down customer, packing, pencarian customer, dan status penyerahan per tanggal. Filter order/pembayaran/produk tersedia.

Migration ini menambah tabel/kolom dan tidak menghapus order lama. Outlet default `NORMAL_ONLY`. Rekap pre-order lama tetap tersedia pada menu **Rekap Pre-Order** dan tautan **Rekap jadwal lama**.

## Keputusan operasional

- Satu tanggal menyimpan satu jadwal per produk/outlet. Varian dan add-on tetap memakai master existing. Harga override mengganti harga dasar efektif; tambahan varian dan add-on tetap berlaku.
- Batas tampilan mengikuti kalender zona waktu outlet, mulai hari ini hingga sebelum hari ini + `preorderDisplayDays`.
- Cutoff pada editor ditampilkan dalam zona waktu perangkat admin dan dikirim sebagai waktu ISO dengan offset. Label input menyatakan zona waktu tersebut.
- Stok reguler hari ini tidak menentukan ketersediaan Daily Menu; jadwal dan kuota menentukan ketersediaan. Proses pembayaran tetap menggunakan aturan pengurangan inventory existing.
- Kuota dicadangkan saat checkout, termasuk order yang belum dibayar. Pembatalan, penolakan, dan void mengembalikan kuota satu kali. Kupon Daily Menu juga dicatat dalam transaksi checkout, dan tidak dihitung dua kali saat pembayaran.
- Pengeditan item Daily Menu melalui POS diblokir agar tanggal dan reservasi tidak hilang. Halaman detail order menyediakan terima/bayar dengan nilai pesanan tersimpan. Untuk mengganti isi pesanan, batalkan lalu buat pesanan baru.
- Rekap menyediakan dropdown pada setiap item: Belum diproses, Sedang diproses, Sudah dipacking, dan Sudah diserahkan. Status tersimpan per item; ringkasan menunjukkan progres berdasarkan quantity. Rekap diperbarui otomatis setiap 15 detik saat halaman aktif. Status pembayaran header tetap terpisah; mengubah satu item tidak mengubah item lain maupun tanggal lain.
- Hapus jadwal yang sudah pernah dipesan akan menonaktifkannya, menjaga riwayat order. Copy jadwal tidak menimpa tanggal/produk yang sudah ada dan menggeser cutoff sesuai selisih hari.
- Keranjang normal dan Daily Menu disimpan terpisah selama sesi halaman; pergantian mode tidak menggabungkan keduanya.

## API

Public API mengikuti URL business/outlet slug existing:

- `GET /api/public/order/:businessSlug/:outletSlug` — konfigurasi mode, enable switch, dan hari tampilan.
- `GET /api/public/order/:businessSlug/:outletSlug/preorder/dates`
- `GET /api/public/order/:businessSlug/:outletSlug/preorder/menu?date=YYYY-MM-DD`
- `POST /api/public/order/:businessSlug/:outletSlug/preview`
- `POST /api/public/order/:businessSlug/:outletSlug/orders`

Preview/checkout Daily Menu menerima `orderMode: "PREORDER"`; setiap item membawa `productId`, `dailyMenuScheduleId`, `serviceDate`, `qty`, dan pilihan varian/add-on existing. Harga dan HPP diambil ulang dari database. Request ID checkout dapat digunakan ulang untuk retry tanpa membuat reservasi ganda.

Admin API (autentikasi dan scope outlet/tenant wajib):

- `GET /api/admin/preorder/schedules?outletId=...&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/admin/preorder/schedules`
- `PUT /api/admin/preorder/schedules/:id` — konfigurasi harga, kuota, cutoff, status, urutan; identitas tanggal/produk immutable.
- `DELETE /api/admin/preorder/schedules/:id`
- `POST /api/admin/preorder/schedules/copy` — `outletId`, `sourceDate`, `targetDates`.
- `GET /api/admin/preorder/recap` — item dengan tanggal dan informasi customer/order.
- `GET /api/admin/preorder/recap/production` — agregasi tanggal/produk beserta rincian.
- `GET /api/admin/preorder/recap/customers` — agregasi tanggal/order customer beserta rincian.
- `POST /api/admin/preorder/orders/:id/fulfill` — `serviceDate`, `status`: `PENDING`, `PROCESSING`, `READY`, atau `COMPLETED`; dropdown per item mengirim `itemId` dan `expectedStatus`. Perubahan yang berbenturan dengan status terbaru ditolak dengan HTTP 409. Permintaan lama tanpa `itemId` tetap mendukung pembaruan seluruh tanggal. Order harus diterima terlebih dahulu sebelum status item dapat diubah.

Rekap menerima `outletId`, `from`, `to`, serta filter opsional `status`, `paymentStatus` (`PAID`/`UNPAID`), `productId`, dan `customer`. Pengelolaan jadwal memerlukan akses owner/supervisor; operasi rekap mengikuti akses outlet user.

## Verifikasi

`pnpm build` dan `pnpm test` digunakan untuk verifikasi. Tes Daily Menu mencakup kalender dan zona waktu, pemisahan mode, pilihan satu produk, lintas tanggal, cutoff, kuota gabungan antar-varian, harga override/fallback, harga/HPP server, varian tidak valid, preview tanpa reservasi, kegagalan reservasi atomik, serta pelepasan kuota satu kali.

Tes unit menggunakan database mock. Pada deployment 29 September 2026, migration diuji pada database sementara yang menyalin struktur produksi; smoke test PostgreSQL nyata untuk concurrency, idempotency, lintas tanggal, kupon, pembayaran, fulfillment, batal/void, mode normal, serta isolasi tenant berhasil. Setelah itu migration diterapkan ke produksi dan layanan diperbarui. Pemeriksaan read-only produksi memastikan menu normal, autentikasi, aset frontend baru, dan data pre-order lama tetap tersedia.

Smoke test database: buat kuota 1, checkout bersamaan dari dua sesi, pastikan hanya satu berhasil dan `soldQty = 1`; batalkan pemenang, pastikan kuota kembali 0; ulangi request checkout yang sama dan pastikan tidak muncul order/reservasi baru. Verifikasi dua tanggal dalam satu order dapat diserahkan secara terpisah dan rekap lama masih menampilkan order sebelumnya.
