# Codex Instructions - FORU POS

Project: FORU POS

FORU POS adalah web service point-of-sale responsive untuk owner, supervisor, dan kasir.

## Tech Stack

- Frontend: React 19, Vite, TypeScript, Tailwind CSS
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL + Prisma
- Auth: JWT
- Responsive web app, PWA-ready

## Main Features Phase 1

Codex harus fokus menjaga dan mengembangkan fitur berikut:

- Multi outlet
- Role owner, supervisor, cashier
- Shift kasir / cash session
- Product master
- Product variant
- HPP per product / variant
- Transaction / sale
- Product discount
- Transaction discount
- Coupon validation
- Sales history
- Gross-to-net report
- Gross profit report
- Void transaction
- Coupon usage tracking

## Business Rules

- Browser/client tidak boleh dipercaya untuk harga dan HPP.
- Server harus selalu mengambil ulang harga dan HPP dari database.
- Gross sales adalah total sebelum diskon.
- Product discount dihitung per item/baris.
- Transaction discount dihitung setelah product discount.
- Coupon harus divalidasi berdasarkan:
  - status aktif
  - tanggal berlaku
  - minimum transaksi
  - outlet
  - product/category rule
  - usage limit
- Net sales = gross sales - semua diskon.
- Gross profit = net sales - HPP.
- Void sale harus mengembalikan used_count coupon.
- Sale creation dan coupon usage harus dalam satu database transaction.

## Development Rules

- Gunakan TypeScript strict style.
- Jangan hardcode role, outlet, product price, atau HPP di frontend.
- Semua validasi penting harus ada di backend.
- Gunakan Prisma transaction untuk proses sale.
- Jangan mengubah migration lama kecuali benar-benar perlu.
- Jika menambah schema Prisma, buat migration baru.
- Jaga struktur monorepo tetap rapi.
- Pastikan command berikut tetap berhasil:

```bash
pnpm build
pnpm test