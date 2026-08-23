# SOP Deploy FORU POS ke VPS / VM Production

Dokumen ini dipakai untuk deploy FORU POS ke VPS/VM production memakai Docker Compose.

Target production saat ini:

- VM IP: `168.110.201.2`
- SSH user: `opc`
- Web: `http://168.110.201.2`
- Domain customer/web order: `https://foru.web.id`
- API internal container: `http://api:3000/api`
- API public via web proxy: `http://168.110.201.2/api`
- PostgreSQL: container internal `postgres:5432`

> Catatan: service reverse proxy berjalan di container `web`. Tidak ada service bernama `nginx` di `docker-compose.prod.yml`.

---

## 0. Prinsip Aman Production

1. Jangan pernah drop database production.
2. Selalu backup database sebelum deploy/migrate.
3. Gunakan `prisma migrate deploy`, bukan `prisma migrate dev`, di VPS production.
4. Jangan edit data langsung di database kecuali benar-benar perlu dan sudah backup.
5. Deploy dilakukan dari folder:

```bash
/opt/foru-pos
```

---

## 1. Login ke VPS

Dari Windows / WSL / terminal:

```bash
ssh opc@168.110.201.2
```

Jika butuh root:

```bash
sudo -i
```

---

## 2. Install Paket Dasar VPS Baru

Jalankan sekali saja pada VM baru.

```bash
sudo dnf update -y || sudo apt update
sudo dnf install -y git curl unzip tar || sudo apt install -y git curl unzip tar
```

Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker opc
```

Logout lalu login ulang agar group Docker aktif:

```bash
exit
ssh opc@168.110.201.2
```

Cek:

```bash
docker --version
docker compose version
```

---

## 3. Clone / Update Source Code

Jika fresh server:

```bash
sudo mkdir -p /opt/foru-pos
sudo chown -R opc:opc /opt/foru-pos
cd /opt/foru-pos
git clone https://github.com/ubuh85-ops/foru_pos.git .
```

Jika folder sudah ada:

```bash
cd /opt/foru-pos
git status
git pull origin main
```

---

## 4. Siapkan Environment Production

File env production berada di:

```bash
/opt/foru-pos/deploy/.env.production
```

Buat jika belum ada:

```bash
cd /opt/foru-pos
cp deploy/.env.production.example deploy/.env.production
nano deploy/.env.production
```

Minimal isi:

```env
POSTGRES_DB=foru_pos
POSTGRES_USER=foru
POSTGRES_PASSWORD=ISI_PASSWORD_DB_PRODUCTION
DATABASE_URL=postgresql://foru:ISI_PASSWORD_DB_PRODUCTION@postgres:5432/foru_pos?schema=public

JWT_SECRET=ISI_SECRET_PANJANG_RANDOM
CORS_ORIGINS=http://168.110.201.2,http://localhost,http://localhost:5173,capacitor://localhost,ionic://localhost
VITE_API_URL=http://168.110.201.2/api
WEB_PORT=80
```

Jika domain `foru.web.id` sudah diarahkan ke VPS dan ingin web memakai domain:

```env
CORS_ORIGINS=http://168.110.201.2,https://foru.web.id,http://localhost,http://localhost:5173,capacitor://localhost,ionic://localhost
VITE_API_URL=https://foru.web.id/api
```

> Untuk Android production, frontend harus dibuild dengan `VITE_API_URL` yang benar sebelum `npx cap sync android`.

---

## 5. Backup Database Sebelum Deploy

Selalu lakukan ini sebelum patch production:

```bash
cd /opt/foru-pos
bash deploy/scripts/backup-postgres.sh
```

Backup tersimpan di:

```bash
/opt/foru-pos/deploy/backups/postgres
```

Cek file backup:

```bash
ls -lah /opt/foru-pos/deploy/backups/postgres
```

---

## 6. Deploy / Patch VPS

Masuk folder deploy:

```bash
cd /opt/foru-pos/deploy
```

Build dan naikkan service:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build postgres api web
```

> Jangan pakai `nginx`, karena service nginx sudah termasuk di container `web`.

---

## 7. Jalankan Prisma Migration Production

Setelah container naik:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production exec api pnpm prisma migrate deploy
```

Generate Prisma client bila diperlukan:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api pnpm prisma generate
```

Restart API setelah migrate:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
```

---

## 8. Validasi Service

Cek container:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Cek health API:

```bash
curl http://168.110.201.2/api/health
```

Expected:

```json
{"ok":true}
```

Cek logs:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 api
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 web
```

---

## 9. Test Setelah Deploy

Minimal test:

1. Buka web:

```text
http://168.110.201.2
```

2. Login owner.
3. Pilih outlet.
4. Buka POS.
5. Pastikan produk tampil.
6. Buat transaksi kecil.
7. Cek Orders tab `PAID`.
8. Cek Reports.
9. Cek Inventory.
10. Cek Customer Web Order:

```text
https://foru.web.id/order/{businessSlug}/{outletSlug}
```

atau jika domain belum aktif:

```text
http://168.110.201.2/order/{businessSlug}/{outletSlug}
```

---

## 10. SOP Patch dari Local ke VPS

Jika perubahan sudah ada di GitHub:

```bash
ssh opc@168.110.201.2
cd /opt/foru-pos
git pull origin main
bash deploy/scripts/backup-postgres.sh
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build postgres api web
docker compose -f docker-compose.prod.yml --env-file .env.production exec api pnpm prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
curl http://168.110.201.2/api/health
```

Jika ada perubahan frontend saja, tetap aman menjalankan command yang sama.

Jika ada perubahan Prisma schema/migration, wajib jalankan `migrate deploy`.

---

## 11. SOP Upload File Excel / Script Backdoor ke VPS

Contoh upload file Excel dari local Windows/WSL ke VPS:

```bash
scp "/mnt/c/Users/sbh/Documents/Codex/2026-06-21/tambahan-feature-coupon-product-discount-tambahkan/apps/api/prisma/product-recipe-import-template.xlsx" opc@168.110.201.2:/opt/foru-pos/apps/api/prisma/
```

Jalankan script dalam container API:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api pnpm exec tsx prisma/NAMA_SCRIPT.ts
```

Contoh dry-run jika script mendukung:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api pnpm exec tsx prisma/NAMA_SCRIPT.ts --dry-run
```

---

## 12. Troubleshooting

### API mati

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=200 api
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
```

### Database credential error

Cek `.env.production`:

```bash
cat /opt/foru-pos/deploy/.env.production
```

Pastikan:

```env
POSTGRES_USER
POSTGRES_PASSWORD
DATABASE_URL
```

selaras dengan database container yang sudah berjalan.

### Disk penuh / Docker cache besar

Cek:

```bash
df -h
docker system df
```

Bersihkan cache Docker yang tidak dipakai:

```bash
docker image prune -f
docker builder prune -f
```

Jangan menjalankan `docker volume prune` di production karena bisa menghapus volume database.

### Memory kecil / OOM

Cek:

```bash
free -h
```

Jika swap belum ada, buat swap 4GB:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Port 80 belum bisa diakses

Cek firewall/security list cloud provider.

Di VM:

```bash
sudo ss -tlnp | grep ':80'
```

---

## 13. Rollback Aman

Rollback code:

```bash
cd /opt/foru-pos
git log --oneline -5
git checkout <COMMIT_SEBELUMNYA>
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build api web
docker compose -f docker-compose.prod.yml --env-file .env.production restart api web
```

Rollback database hanya dilakukan jika benar-benar perlu dan harus memakai file backup.

---

## 14. Push Perubahan Local ke GitHub

Gunakan SOP ini jika perubahan sudah selesai dites di local dan ingin dinaikkan ke repository GitHub.

### 14.1 Cek perubahan

Dari komputer local:

```bash
cd /mnt/c/Users/sbh/Documents/Codex/2026-06-21/tambahan-feature-coupon-product-discount-tambahkan
git status
git diff --stat
```

Jika memakai PowerShell Windows:

```powershell
cd "C:\Users\sbh\Documents\Codex\2026-06-21\tambahan-feature-coupon-product-discount-tambahkan"
git status
git diff --stat
```

### 14.2 Build dan test sebelum commit

```bash
pnpm --filter api build
pnpm --dir apps/web build
pnpm test
```

Jika build web di Windows terkena error akses Vite/esbuild, jalankan dari terminal yang punya akses normal atau ulang melalui environment Codex yang sudah diizinkan.

### 14.3 Commit perubahan

```bash
git add .
git commit -m "update foru pos"
```

Gunakan message yang lebih jelas jika memungkinkan:

```bash
git commit -m "feat: update customer web order grouped menu"
```

### 14.4 Push ke GitHub

```bash
git push origin main
```

Repository production:

```text
https://github.com/ubuh85-ops/foru_pos.git
```

Setelah push selesai, lanjut patch VPS menggunakan SOP section 10 atau section 16.

---

## 15. Patch Langsung dari Local ke VPS tanpa GitHub

Gunakan SOP ini jika ingin mengirim perubahan local langsung ke VPS, misalnya perubahan cepat yang belum/pending push GitHub.

> Tetap disarankan push ke GitHub setelah patch agar source VPS dan repository tidak berbeda terlalu lama.

### 15.1 Buat archive dari local

Dari komputer local / WSL:

```bash
cd /mnt/c/Users/sbh/Documents/Codex/2026-06-21/tambahan-feature-coupon-product-discount-tambahkan
git status
tar --exclude='.git' --exclude='node_modules' --exclude='apps/web/node_modules' --exclude='apps/api/node_modules' --exclude='apps/web/dist' --exclude='apps/web/android/app/build' --exclude='deploy/backups' --exclude='deploy/storage' -czf /tmp/foru-pos-patch.tgz .
```

Jika memakai PowerShell Windows dan punya `tar`:

```powershell
cd "C:\Users\sbh\Documents\Codex\2026-06-21\tambahan-feature-coupon-product-discount-tambahkan"
tar --exclude=".git" --exclude="node_modules" --exclude="apps/web/node_modules" --exclude="apps/api/node_modules" --exclude="apps/web/dist" --exclude="apps/web/android/app/build" --exclude="deploy/backups" --exclude="deploy/storage" -czf "$env:TEMP\foru-pos-patch.tgz" .
```

### 15.2 Upload archive ke VPS

Dari WSL:

```bash
scp /tmp/foru-pos-patch.tgz opc@168.110.201.2:/tmp/foru-pos-patch.tgz
```

Dari PowerShell:

```powershell
scp "$env:TEMP\foru-pos-patch.tgz" opc@168.110.201.2:/tmp/foru-pos-patch.tgz
```

### 15.3 Backup dan extract di VPS

Login ke VPS:

```bash
ssh opc@168.110.201.2
```

Backup database dulu:

```bash
cd /opt/foru-pos
bash deploy/scripts/backup-postgres.sh
```

Backup source folder lama:

```bash
cd /opt
sudo tar --exclude='foru-pos/deploy/backups' --exclude='foru-pos/deploy/storage' -czf /tmp/foru-pos-source-before-patch.tgz foru-pos
```

Extract patch ke folder aplikasi:

```bash
cd /opt/foru-pos
tar -xzf /tmp/foru-pos-patch.tgz
```

Pastikan `.env.production`, backup, dan storage tidak tertimpa. Archive command di atas sudah mengecualikan:

- `deploy/backups`
- `deploy/storage`
- `node_modules`
- build output

### 15.4 Rebuild dan migrate

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build postgres api web
docker compose -f docker-compose.prod.yml --env-file .env.production exec api pnpm prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
```

### 15.5 Validasi

```bash
curl http://168.110.201.2/api/health
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 api
```

Expected:

```json
{"ok":true}
```

### 15.6 Jika patch langsung gagal

Rollback source folder dari backup:

```bash
cd /opt
sudo rm -rf /opt/foru-pos
sudo tar -xzf /tmp/foru-pos-source-before-patch.tgz -C /opt
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build api web
docker compose -f docker-compose.prod.yml --env-file .env.production restart api web
```

Rollback database hanya dilakukan jika migration/data berubah dan benar-benar perlu.

---

## 16. Commands Ringkas Harian

Patch normal:

```bash
cd /opt/foru-pos
git pull origin main
bash deploy/scripts/backup-postgres.sh
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build postgres api web
docker compose -f docker-compose.prod.yml --env-file .env.production exec api pnpm prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
curl http://168.110.201.2/api/health
```

Lihat log:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

Restart semua:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production restart api web
```
