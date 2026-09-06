# Internal Web Analytics

Menu owner: **Laporan → Web Analytics** (`/reports/web-analytics`). Mengikuti akses laporan existing; tidak menambahkan role Admin baru. Tidak menggunakan layanan analytics pihak ketiga.

## Files changed

- `apps/api/prisma/schema.prisma`: model event, relasi Business/Outlet/Product/Sale, atribusi JSON pada Sale.
- `apps/api/prisma/migrations/20260906000000_web_analytics/migration.sql`: migration baru; migration lama tidak diubah.
- `apps/api/src/web-analytics.ts`: validasi, public tracking, agregasi owner, penulisan event order dan rekonsiliasi.
- `apps/api/src/index.ts`: registrasi endpoint, atribusi saat create order, worker rekonsiliasi.
- `apps/web/src/webAnalytics.ts`: identitas anonim, sesi/source, pengiriman event non-blocking.
- `apps/web/src/pages/CustomerOrderPage.tsx`: page view, penambahan item/quantity, metadata checkout.
- `apps/web/src/pages/WebAnalyticsPage.tsx`: dashboard, filter, funnel dan tabel.
- `apps/web/src/App.tsx`: menu dan route owner.
- `apps/api/src/web-analytics.test.ts`: pengujian endpoint, tenant, validasi, agregasi dan recovery.
- `apps/api/src/web-analytics-browser.test.js`: pengujian helper browser dan kegagalan storage/network.

## Database

Tabel `web_analytics_events` menyimpan business/outlet, visitor/session anonim, jenis event, source, product/order opsional, dan waktu server. Foreign key mengikuti model existing. `event_id` unik mencegah duplikasi request event yang sama; `order_id` unik menjamin satu event per order.

Index tersedia untuk business/outlet/waktu, business/waktu, visitor, serta event/waktu. Agregasi menggunakan PostgreSQL `GROUPING SETS`, tanpa mengambil seluruh event ke aplikasi atau query per outlet.

Kolom nullable `sales.web_analytics` menyimpan atribusi valid bersama transaksi order. Sesudah commit, backend menulis `ORDER_CREATED` tanpa menunggu respons analytics untuk mengirim respons checkout. Jika write gagal atau proses restart setelah commit, worker mengambil hingga 100 order tertunda per batch setiap 30 detik dan menulis event secara idempotent. Waktu event mengikuti waktu order dibuat, bukan waktu retry. Worker tidak berjalan tumpang tindih dalam satu proses; unique constraint melindungi beberapa proses.

Data order lama memiliki atribusi null dan tidak di-backfill. Analytics mulai dihitung setelah fitur diterapkan. Void/cancel tidak menghapus event `ORDER_CREATED`: metrik ini mengukur order yang berhasil dibuat, bukan penjualan lunas.

## Endpoints

### Public: `POST /api/public/web-analytics/events`

```json
{
  "businessSlug": "foru",
  "outletSlug": "huis",
  "visitorId": "foru_web_0123456789abcdef0123456789abcdef",
  "sessionId": "0123456789abcdef0123456789abcdef",
  "eventId": "abcdef0123456789abcdef0123456789",
  "eventType": "ADD_TO_CART",
  "source": "qr",
  "productId": "PRODUCT_ID"
}
```

`productId` opsional. Endpoint hanya menerima `PAGE_VIEW` dan `ADD_TO_CART`, menolak `businessId`, `outletId`, `orderId` dan event `ORDER_CREATED` dari browser. Backend memakai resolver slug Web Order existing, mengecek hubungan business/outlet dan status Web Order. Produk harus aktif dan terdaftar pada outlet dalam business tersebut.

Respons sukses `204`. Validation error `400`, outlet tidak diizinkan `403`, slug tidak ditemukan `404`, rate limit `429`. Limit dasar 180 request/menit per alamat koneksi, terpisah dari limit checkout. Bucket dibatasi dan kedaluwarsa; alamat koneksi hanya dipakai sementara di memori, tidak ditulis ke database. Limit ini per proses, bukan limiter terdistribusi.

Endpoint create order existing menerima field tambahan opsional `analytics: { visitorId, sessionId, source }`. Metadata tidak valid diabaikan dan diganti identitas anonim server sehingga checkout tetap berjalan. Backend tidak mempercayai business/outlet atau harga dari metadata tersebut.

### Protected: `GET /api/admin/web-analytics`

JWT owner dari business aktif wajib tersedia. Parameters:

- `startDate`, `endDate`: wajib `YYYY-MM-DD`, tanggal akhir inklusif.
- `outletId`: opsional; tidak disertakan berarti semua outlet business aktif.

Tanggal menggunakan WIB/Asia/Jakarta sesuai pola laporan existing, termasuk saat memilih outlet dengan timezone operasional lain. Outlet business lain ditolak sebelum agregasi. Semua SQL menggunakan parameter business dari autentikasi, bukan query client.

Response: `uniqueVisitors`, `pageViews`, `addToCart`, `orders`, `conversionRate`, `visitorToCart`, `cartToOrder`, `timezone`, `outlets`, `outletComparison`, `trafficSources`. Daftar outlet berasal dari database business aktif, termasuk outlet nonaktif yang mungkin masih memiliki histori.

## Visitor tracking dan perhitungan

- Visitor dibuat dengan `crypto.getRandomValues` dan disimpan sebagai `foru_web_visitor_id` di localStorage. Reload mempertahankan visitor.
- Session disimpan di sessionStorage, dipisahkan per business/outlet dan berakhir setelah 30 menit tanpa aktivitas. Source pertama pada sesi berasal dari `?src=`, default `direct`; source dikenal: `qr`, `whatsapp`, `instagram`, `table`, `flyer`, `direct`. Nilai lain menjadi `other`.
- Efek page view memiliki guard lokasi navigasi sehingga render ulang dan replay efek React StrictMode tidak menambah event. Reload atau kunjungan navigasi baru menghasilkan page view baru.
- `ADD_TO_CART` berarti aksi penambahan item atau peningkatan quantity, bukan jumlah unit. Membuka modal produk, mengurangi quantity, atau mengedit catatan tidak menambah event.
- Tracking memakai fetch asinkron dengan `keepalive`, tanpa await di alur UI. Storage tidak tersedia memakai identitas di memori; secure randomness tidak tersedia menonaktifkan tracking browser. Kegagalan fetch diabaikan. Public page/cart events bersifat best effort, tanpa antrean offline; order events memiliki recovery backend.
- Unique visitors = `COUNT(DISTINCT visitor_id)` dari semua event dalam business/outlet/periode yang dipilih. Satu visitor lintas outlet dihitung sekali di total; penjumlahan baris outlet/source bisa berbeda dari total.
- Conversion = `orders / uniqueVisitors × 100`; Visitor → Cart = `addToCart / uniqueVisitors × 100`; Cart → Order = `orders / addToCart × 100`. Penyebut nol menghasilkan 0. Rasio dibulatkan dua desimal dan dapat melampaui 100% karena satu visitor dapat melakukan beberapa aksi/order.
- Tidak menyimpan IP, password, payment credentials, customer name/phone, full URL, atau user agent di event analytics.

## Deployment dan verification

Jalankan migration sebelum menjalankan versi aplikasi baru, dengan `DATABASE_URL` yang benar:

```sh
pnpm --filter api prisma validate
pnpm --filter api prisma migrate deploy
pnpm --filter api prisma generate
pnpm build
pnpm test
```

Verifikasi lokal implementasi: schema valid, Prisma Client berhasil dibuat, SQL migration sesuai hasil `prisma migrate diff`, build backend/frontend berhasil, dan 45 test lulus (29 test analytics baru). Test endpoint menggunakan database mock, bukan PostgreSQL nyata.

PostgreSQL lokal `localhost:5433` tidak tersedia (`ECONNREFUSED`). Migration kemudian berhasil diterapkan ke VPS production `168.110.201.2` pada 6 September 2026. Build API/web, seluruh 45 test, validasi Prisma, dan HTTPS health check berhasil di VPS.

Smoke test production memverifikasi endpoint owner, penolakan tanpa autentikasi/non-owner, isolasi terhadap outlet business lain yang benar-benar ada, public page/cart tracking, deduplikasi event, penolakan payload palsu/produk tidak valid, filter outlet/source, dan perhitungan conversion. Constraint order diuji dalam transaksi PostgreSQL yang di-rollback seluruhnya; event public percobaan dibersihkan setelah pemeriksaan. Tidak membuat order customer nyata atau mengirim notifikasi checkout untuk smoke test.

Backup sebelum deployment: `/opt/foru-pos/deploy/backups/web-analytics-20260906T045142Z` (database, source, dan referensi image sebelumnya). Script patch `deploy/scripts/deploy-web-analytics-patch.sh` memakai konfigurasi Compose HTTPS secara eksplisit. Deteksi berdasarkan akses file sertifikat sempat menonaktifkan HTTPS saat restart awal; konfigurasi diperbaiki dan HTTPS kembali sehat sebelum submit.

## Manual acceptance test

1. Terapkan migration dan jalankan API/web. Login owner business A dan buka Web Analytics.
2. Buka Web Order outlet A dengan `?src=qr`. Periksa satu `PAGE_VIEW`; reload menambah page view tetapi visitor tetap sama. Mengganti kategori atau mengetik pencarian tidak menambah page view.
3. Tambahkan produk sederhana, produk dengan variant, dan naikkan quantity. Periksa `ADD_TO_CART` dengan productId yang benar; sekadar membuka modal tidak menambah event.
4. Buat order berhasil. Periksa tepat satu `ORDER_CREATED` dengan orderId, businessId, outletId, visitor/session dan source yang sesuai. Reload halaman status atau replay request order dengan request ID sama tidak menambah event order.
5. Blok request `/public/web-analytics/events` di browser. Menu, cart dan checkout tetap dapat digunakan.
6. Simulasikan kegagalan penulisan event backend, lalu pulihkan. Order tetap tersimpan; rekonsiliasi menghasilkan satu event dengan timestamp order asli.
7. Cek Today, Yesterday, Last 7 Days, This Month, Custom, All Outlets dan outlet tertentu. Periksa filter tanggal WIB, ringkasan, funnel, sumber traffic dan outlet tanpa event.
8. Dengan JWT business A, minta report outlet business B: harus `403`. Public payload dengan businessId bebas atau produk outlet/business lain harus ditolak. JWT cashier/supervisor tidak dapat membaca endpoint owner.
