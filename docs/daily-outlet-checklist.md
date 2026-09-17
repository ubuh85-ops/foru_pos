# Daily Outlet Checklist & Leader Review

Menu: Operasional → Checklist Harian; Pengaturan → Checklist.

- CASHIER: centang checklist outlet yang ditugaskan, lihat history.
- SUPERVISOR (Leader): outlet yang ditugaskan, monitoring dan daily review.
- OWNER: seluruh outlet aktif bisnis, monitoring, review opsional, dan pengaturan template.
- Template default: 10 Opening, 7 Operational, 15 Closing; dibuat sekali per outlet saat pertama kali checklist atau pengaturannya dibuka.
- Checklist harian dibuat saat detail hari ini dibuka, menggunakan tanggal zona waktu outlet. Monitoring tidak membuat catatan palsu untuk outlet yang belum membuka checklist.
- Title, section dan urutan adalah snapshot. Edit/nonaktifkan template hanya memengaruhi checklist yang belum dibuat. Pilih outlet pada pengaturan untuk mengatur template outlet tersebut.
- History hanya baca dan tidak membuat checklist untuk tanggal lampau. History menggunakan pagination 30 hari tercatat per halaman.
- Semua perubahan checkbox disimpan langsung; kegagalan ditampilkan dan checkbox tidak mengaku tersimpan. Nama dan timestamp berasal dari server.
- Review belum lengkap membutuhkan konfirmasi; jumlah pending saat review disimpan. Perubahan item setelah review menghapus status/catatan review sebelumnya dan membutuhkan review ulang.
- PIC pada monitoring menunjukkan user yang menyelesaikan item, bukan penugasan PIC terpisah. Monitoring otomatis refresh setiap 30 detik.
- Pembuatan checklist, edit template, centang dan review diserialisasi dengan lock baris outlet dalam transaksi PostgreSQL. Unique constraint membatasi satu checklist per bisnis/outlet/tanggal.

## Deployment

Migration baru: `apps/api/prisma/migrations/20260917000000_daily_outlet_checklist/migration.sql`.

Jalankan pada target deployment sebelum backend baru diaktifkan:

```sh
pnpm --filter api prisma migrate deploy
pnpm db:generate
pnpm build
pnpm test
```

Tidak ada migrasi lama yang diubah. Tidak perlu seed ulang atau reset database. Tidak ada upload foto, KPI, push notification, atau integrasi inventory.

## Validation

`apps/api/src/checklists.test.ts` menguji endpoint dengan Express dan Prisma mock: pembatasan bisnis/outlet/role, snapshot, default, tanggal/zona waktu, auto-save attribution, uncheck, review belum lengkap, history read-only, dan deactivation. Pengujian ini tidak menggantikan smoke test terhadap PostgreSQL pada lingkungan deployment, terutama transaksi concurrent.
