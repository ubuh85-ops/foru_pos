# Product Recipe Import Backdoor

Import ini dipakai untuk menambah bahan resep ke produk dari file Excel tanpa lewat UI.

Importer wajib menerima `--business=<kode/id/nama>` dan seluruh pencarian produk,
bahan, serta satuan hanya dilakukan di dalam bisnis tersebut. Gunakan kode bisnis
untuk hasil paling presisi, misalnya `--business=DPC`.

## File Template

Template Excel:

```text
apps/api/prisma/product-recipe-import-template.xlsx
```

Kolom:

| Kolom | Keterangan |
| --- | --- |
| product_sku | SKU produk POS. Diprioritaskan untuk mencari produk. |
| product_name | Nama produk POS. Dipakai jika product_sku kosong. |
| ingredient_code | Kode bahan baku. Diprioritaskan untuk mencari bahan. |
| ingredient_sku | SKU/barcode bahan. Dipakai jika ingredient_code kosong. |
| ingredient_name | Nama bahan. Dipakai jika code dan SKU kosong. |
| qty | Jumlah pemakaian bahan di resep. |
| unit | Satuan resep, contoh Pcs, Ml, Gram, Pack. |
| waste_percent | Persentase waste, contoh 5 untuk 5%. |

## Anti Double

Script akan skip otomatis jika bahan sudah ada di recipe produk.

Rule duplicate:

```text
product_id + inventory_item_id
```

Jadi bahan yang sama tidak akan masuk dua kali ke produk yang sama.

## Local Preview

Dari folder `apps/api`:

```bash
pnpm run recipe:import -- prisma/product-recipe-import-template.xlsx --business=DPC
```

Default adalah preview/dry-run. Belum insert ke database.

## Local Apply

```bash
pnpm run recipe:import -- prisma/product-recipe-import-template.xlsx --business=DPC --apply
```

## Generate Template Ulang

```bash
pnpm run recipe:template -- prisma/product-recipe-import-template.xlsx
```

## Import Berdasarkan Kategori Produk

Gunakan ini kalau ingin menambahkan bahan resep ke semua produk aktif di kategori tertentu.

Template Excel:

```text
apps/api/prisma/product-category-recipe-import-template.xlsx
```

Kolom:

| Kolom | Keterangan |
| --- | --- |
| category | Nama kategori produk POS, contoh Iced Coffee. |
| category_id | Optional. Jika diisi, dipakai untuk cari kategori lebih presisi. |
| ingredient_code | Kode bahan baku. Diprioritaskan untuk mencari bahan. |
| ingredient_sku | SKU/barcode bahan. Dipakai jika ingredient_code kosong. |
| ingredient_name | Nama bahan. Dipakai jika code dan SKU kosong. |
| qty | Jumlah pemakaian bahan di resep. |
| unit | Satuan resep, contoh Pcs, Ml, Gram, Pack. |
| waste_percent | Persentase waste, contoh 5 untuk 5%. |

Generate template:

```bash
pnpm run recipe:category-template -- prisma/product-category-recipe-import-template.xlsx
```

Preview lokal:

```bash
pnpm run recipe:category-import -- prisma/product-category-recipe-import-template.xlsx
```

Apply lokal:

```bash
pnpm run recipe:category-import -- prisma/product-category-recipe-import-template.xlsx --apply
```

Anti-double tetap aktif. Jika bahan sudah ada di recipe produk, baris produk tersebut akan `SKIPPED`.

## VPS Preview

Upload file ke VPS, contoh:

```text
/tmp/product-recipe-import.xlsx
```

Lalu jalankan:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -v /tmp/product-recipe-import.xlsx:/tmp/product-recipe-import.xlsx \
  api pnpm run recipe:import -- /tmp/product-recipe-import.xlsx --business=DPC
```

## VPS Apply

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -v /tmp/product-recipe-import.xlsx:/tmp/product-recipe-import.xlsx \
  api pnpm run recipe:import -- /tmp/product-recipe-import.xlsx --business=DPC --apply
```

## VPS Import Berdasarkan Kategori

Upload file category import ke VPS, contoh:

```text
/tmp/product-category-recipe-import.xlsx
```

Preview:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -v /tmp/product-category-recipe-import.xlsx:/tmp/product-category-recipe-import.xlsx \
  api pnpm run recipe:category-import -- /tmp/product-category-recipe-import.xlsx
```

Apply:

```bash
cd /opt/foru-pos/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -v /tmp/product-category-recipe-import.xlsx:/tmp/product-category-recipe-import.xlsx \
  api pnpm run recipe:category-import -- /tmp/product-category-recipe-import.xlsx --apply
```

## Output

Script menampilkan tabel hasil:

- `WOULD_ADD`: akan ditambahkan saat apply.
- `ADDED`: berhasil ditambahkan.
- `SKIPPED`: bahan sudah ada di recipe, dilewati agar tidak double.
- `ERROR`: gagal, misalnya produk/bahan/unit tidak ditemukan.
