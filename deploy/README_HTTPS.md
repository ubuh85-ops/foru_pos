# FORU POS HTTPS production

Target public URL: `https://foru.web.id`.

## Prasyarat

DNS harus mengarah ke VM:

```bash
nslookup foru.web.id 8.8.8.8
```

Buka hanya port `22`, `80`, dan `443`. Port `3000` serta `5432` tetap internal Docker.

## Sertifikat Let's Encrypt pertama kali

Jalankan dari `/opt/foru-pos/deploy`. Hentikan web sementara agar Certbot standalone memakai port 80.

```bash
sudo dnf install -y certbot
docker compose -f docker-compose.prod.yml --env-file .env.production stop web
sudo certbot certonly --standalone --preferred-challenges http \
  -d foru.web.id --agree-tos --no-eff-email -m admin@foru.web.id
docker compose -f docker-compose.prod.yml --env-file .env.production \
  -f docker-compose.https.yml up -d --build api web
```

Pada Ubuntu, gunakan `sudo apt-get update && sudo apt-get install -y certbot`.

## Environment production

Di `/opt/foru-pos/deploy/.env.production`, pertahankan secret database/JWT yang aktif dan pastikan nilai berikut:

```env
PUBLIC_HOST=foru.web.id
WEB_PORT=80
HTTPS_PORT=443
VITE_API_URL=/api
APP_URL=https://foru.web.id
FRONTEND_URL=https://foru.web.id
CORS_ORIGINS=https://foru.web.id,https://localhost,capacitor://localhost,ionic://localhost
```

## Deploy update

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api pnpm prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production \
  -f docker-compose.https.yml up -d --build api web
```

Tidak ada `migrate reset`, `db push --force-reset`, atau penghapusan volume database.

## Renewal sertifikat

Gunakan systemd timer/cron host:

```bash
sudo certbot renew --deploy-hook \
  'cd /opt/foru-pos/deploy && docker compose -f docker-compose.prod.yml --env-file .env.production -f docker-compose.https.yml restart web'
```

## Smoke test

```bash
curl -I http://foru.web.id/
curl -fsS https://foru.web.id/api/health
```

HTTP harus redirect ke HTTPS, API health harus berhasil, dan browser tidak boleh menampilkan mixed-content.

## Rollback entrypoint

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production \
  -f docker-compose.https.yml down
docker compose -f docker-compose.prod.yml --env-file .env.production up -d web api
```

Rollback ini hanya mengubah entrypoint web dan tidak menyentuh data PostgreSQL.
