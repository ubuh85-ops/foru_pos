# FORU POS v0.13.0

Tanggal rilis: 21 Juli 2026

## Ringkasan

Rilis ini menjadikan kondisi aplikasi saat ini sebagai release resmi FORU POS, dengan fokus pada stabilitas operasional, user experience, product import/export, Android branding, dan handling session timeout yang lebih rapi.

## Perubahan utama

- Menambahkan handler global untuk sesi berakhir:
  - jika API mengembalikan 401 karena token expired/session invalid, aplikasi menampilkan dialog `Sesi Berakhir`;
  - user diarahkan login ulang setelah menekan tombol;
  - token, data user, dan outlet aktif dibersihkan.
- Memperbaiki permission inventory entry point agar menu Inventory mengikuti `inventory.view`.
- Menambahkan/memperbarui Product Import & Export:
  - export semua produk;
  - export produk terpilih;
  - download template;
  - import CSV/XLS/XLSX;
  - preview validasi import;
  - SKU kosong dibuat otomatis;
  - kategori kosong/baru ditangani otomatis.
- Menambahkan dukungan SKU pada produk.
- Merapikan Orders page dan action flow yang sudah ada dalam working version.
- Memperbarui asset Android:
  - launcher icon;
  - foreground icon;
  - round icon;
  - splash image.
- Menambahkan ignore untuk file log dan folder IDE lokal agar release bersih.

## Validasi

- `pnpm build` berhasil.

## Catatan deployment

- Jalankan migration database sebelum backend production digunakan jika belum diterapkan.
- Rilis ini tidak dimaksudkan untuk drop data production.
- Pastikan environment production tetap memakai database dan `DATABASE_URL` yang benar.
