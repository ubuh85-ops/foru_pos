# FORU POS

FORU POS adalah web service point-of-sale responsive untuk owner, supervisor, dan kasir. Proyek ini mencakup multi-outlet, shift kasir, transaksi, diskon produk/transaksi, kupon dengan aturan, riwayat, dan laporan gross-to-net.

## Stack

- React 19 + Vite + TypeScript + Tailwind CSS
- Node.js + Express + TypeScript
- PostgreSQL + Prisma
- JWT authentication
- PWA-ready responsive web app

## Menjalankan lokal

Prasyarat: Node.js 20+, pnpm 10+, Docker (opsional), dan PostgreSQL 15+.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Buka `http://localhost:5173`. API tersedia di `http://localhost:4000/api`, dengan health check di `/api/health`.

> Prisma membaca `DATABASE_URL` dari environment. Jika perintah workspace tidak membaca `.env` root pada environment Anda, set `DATABASE_URL` di shell atau salin `.env` ke `apps/api/.env`.

## Akun seed

| Role | Username | Password | Akses |
|---|---|---|---|
| Owner | `owner` | `owner123` | Semua outlet dan master data |
| Cashier | `kasir` | `kasir123` | FORU LRT |

Kupon demo: `FORUHEMAT` — diskon 10%, maksimum Rp10.000, minimum transaksi Rp50.000.

## Perhitungan diskon

Server mengambil ulang harga dan HPP dari database; nilai harga dari browser tidak dipercaya.

1. Gross sales = total harga sebelum diskon.
2. Diskon produk dihitung per baris dan dibatasi maksimal subtotal baris.
3. Diskon transaksi dihitung setelah diskon produk.
4. Kupon divalidasi terhadap status, tanggal, minimum transaksi, outlet, produk/kategori, dan usage limit.
5. Net sales / grand total = gross sales - seluruh diskon.
6. Gross profit = net sales - HPP.

Void transaksi mengembalikan `used_count` kupon. Pembuatan sale dan pencatatan penggunaan kupon dilakukan dalam satu database transaction.

## Endpoint utama

- Auth: `POST /api/auth/login`, `GET /api/auth/me`
- Outlet: `GET|POST /api/outlets`, `PUT|DELETE /api/outlets/:id`
- Product: `GET|POST /api/products`, `GET /api/pos/products`, variants CRUD
- Coupon: `GET|POST /api/coupons`, `PUT|DELETE /api/coupons/:id`, `POST /api/coupons/validate`
- Sale: `POST /api/sales`, `GET /api/sales`, `GET /api/sales/:id`, `POST /api/sales/:id/void`
- Shift: open, active, dan close di `/api/cash-sessions`
- Reports: daily, dashboard, products, outlets di `/api/reports`

## Validasi proyek

```bash
pnpm build
pnpm test
```

Migration awal tersimpan di `apps/api/prisma/migrations/20260621160000_init/migration.sql`.

## Build Android APK

Frontend web berada di `apps/web` dan sudah dikonfigurasi sebagai aplikasi Android Capacitor dengan:

- App name: `FORU POS`
- Package name: `com.foru.pos`
- Web build output: `dist`
- Android project: `apps/web/android`

Konfigurasi API untuk Android dibuat lewat environment Vite. Untuk emulator Android gunakan:

```env
VITE_API_URL=http://10.0.2.2:3000/api
```

Untuk device fisik, ganti host dengan IP LAN backend, misalnya:

```env
VITE_API_URL=http://192.168.x.x:3000/api
```

Untuk server API `103.253.244.190`:

```env
VITE_API_URL=http://103.253.244.190:3000/api
```

Jika backend lokal repo ini berjalan di port default `4000`, gunakan `http://10.0.2.2:4000/api` untuk emulator atau `http://192.168.x.x:4000/api` untuk device fisik. File contoh tersedia di `apps/web/.env.android.example`.

Untuk Android WebView/Capacitor, backend Express membaca origin yang diizinkan dari `CORS_ORIGINS`. Development default mengizinkan `http://localhost`, `http://localhost:5173`, `http://192.168.1.24:5173`, `capacitor://localhost`, dan `ionic://localhost`. Production sebaiknya memakai HTTPS dan origin yang lebih ketat.

Build dan sync Android. Gunakan script Android agar Vite memuat `.env.android` lewat `--mode android`:

```bash
cd apps/web
pnpm install
pnpm cap:sync
```

Build debug APK di Linux/macOS:

```bash
cd android
./gradlew assembleDebug
```

Build debug APK di Windows PowerShell:

```powershell
cd android
.\gradlew.bat assembleDebug
```

Output APK:

```text
apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

Catatan printer: browser/PWA print fallback tetap tersedia dan tidak diubah. Android WebView tidak selalu mendukung Web Bluetooth secara konsisten, jadi direct native Bluetooth printer sebaiknya diintegrasikan kemudian lewat Capacitor plugin native tanpa memutus flow print browser yang sudah ada.

## Catatan data pelanggan

Field `usage_per_customer` sudah tersedia pada kupon. Karena spesifikasi Phase 1 belum mempunyai entitas/customer ID pada sale maupun coupon usage, pembatasan total global sudah aktif, sedangkan pembatasan per pelanggan perlu diaktifkan setelah modul pelanggan menyediakan identitas yang stabil. Ini menghindari penggunaan cashier ID sebagai identitas pelanggan yang keliru.
