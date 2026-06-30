# FORU POS - Deploy Web + API + Database ke VPS

Target default:

- VPS IP: `103.253.244.190`
- Web: `http://103.253.244.190`
- API: `http://103.253.244.190/api`
- PostgreSQL: container internal `postgres:5432`

## 1. Upload project ke VPS

Contoh:

```bash
ssh root@103.253.244.190
mkdir -p /opt/foru-pos
cd /opt/foru-pos
git clone <REPO_URL> .
```

Jika tidak pakai Git, upload folder project ke `/opt/foru-pos`.

## 2. Install Docker di VPS

```bash
cd /opt/foru-pos
sudo bash deploy/scripts/vps-install-deps.sh
```

Logout/login ulang jika perlu.

## 3. Siapkan environment production

```bash
cd /opt/foru-pos
cp deploy/.env.production.example deploy/.env.production
nano deploy/.env.production
```

Minimal ganti:

```env
POSTGRES_PASSWORD=...
DATABASE_URL=postgresql://foru:PASSWORD_SAMA@postgres:5432/foru_pos?schema=public
JWT_SECRET=...
```

Default frontend memakai reverse proxy:

```env
VITE_API_URL=http://103.253.244.190/api
```

## 4. Deploy semua service

```bash
cd /opt/foru-pos
bash deploy/scripts/deploy.sh
```

Script akan:

- build Docker image API
- build Docker image Web
- start PostgreSQL
- start API
- run Prisma migration
- start Web/Nginx

## 5. Cek status

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

Cek endpoint:

```bash
curl http://103.253.244.190/api/health
```

## 6. Seed data awal, jika dibutuhkan

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production exec api pnpm prisma db seed
```

## 7. Update aplikasi setelah ada perubahan

```bash
cd /opt/foru-pos
git pull
bash deploy/scripts/deploy.sh
```

## 8. Backup database

Manual:

```bash
cd /opt/foru-pos
bash deploy/scripts/backup-postgres.sh
```

Cron harian:

```bash
crontab -e
```

Tambahkan:

```cron
0 2 * * * cd /opt/foru-pos && bash deploy/scripts/backup-postgres.sh >> /var/log/foru-pos-backup.log 2>&1
```

## 9. Catatan HTTPS

Untuk production beneran, pasang domain lalu aktifkan HTTPS. Jika masih pakai IP dan HTTP, Android sudah disiapkan untuk cleartext HTTP ke `103.253.244.190`, tetapi HTTPS tetap lebih aman.
