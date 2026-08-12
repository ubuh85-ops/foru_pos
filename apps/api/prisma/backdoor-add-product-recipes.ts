import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Backdoor Recipe Upsert
 *
 * Cara pakai:
 * 1) Edit array RECIPE_JOBS di bawah.
 * 2) Jalankan dari folder apps/api atau dari container api:
 *
 * Local:
 *   pnpm exec tsx prisma/backdoor-add-product-recipes.ts
 *
 * VPS:
 *   cd /opt/foru-pos/deploy
 *   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api \
 *     pnpm exec tsx prisma/backdoor-add-product-recipes.ts
 *
 * Catatan:
 * - Script ini TIDAK menghapus produk/bahan/stok.
 * - mode "replace" hanya mengganti recipe untuk produk yang disebut.
 * - mode "upsert" menambah/update bahan yang disebut, recipe lain di produk tetap ada.
 */

type RecipeJob = {
  mode: 'replace' | 'upsert';
  product: {
    // Isi minimal salah satu: id / sku / name
    id?: string;
    sku?: string;
    name?: string;
  };
  ingredients: Array<{
    // Isi minimal salah satu: id / code / sku / barcode / name
    itemId?: string;
    itemCode?: string;
    itemSku?: string;
    itemBarcode?: string;
    itemName?: string;

    // Qty yang dipakai dalam recipe.
    usageQty: number;

    // Nama satuan recipe, contoh: "Pcs", "Ml", "Gram", "Pack"
    usageUnitName: string;

    // Optional. Tambahan waste, contoh 5 artinya 5%.
    wastePercent?: number;

    // Optional. Default true.
    isActive?: boolean;
  }>;
};

type ResolvedRecipeRow = {
  productId: string;
  inventoryItemId: string;
  usageQty: number;
  usageUnitId: string;
  wastePercent: number;
  isActive: boolean;
  itemName: string;
  itemCode: string;
  unitName: string;
};

const RECIPE_JOBS: RecipeJob[] = [
  {
    mode: 'replace',
    product: {
      // Pilih salah satu yang paling pasti.
      // id: 'product_id_di_database',
      // sku: 'SKU-PRODUK',
      name: 'Roti Bakar Rakyat - Choco Cheese',
    },
    ingredients: [
      {
        itemCode: '001',
        usageQty: 100,
        usageUnitName: 'Ml',
        wastePercent: 5,
      },
      {
        itemCode: 'ROT1 BGR',
        usageQty: 1,
        usageUnitName: 'Pcs',
        wastePercent: 0,
      },
    ],
  },
];

function defined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null && value !== '';
}

async function findProduct(selector: RecipeJob['product']) {
  const where = defined(selector.id)
    ? { id: selector.id }
    : defined(selector.sku)
      ? { sku: selector.sku }
      : defined(selector.name)
        ? { name: selector.name }
        : null;

  if (!where) throw new Error('Product selector wajib isi id, sku, atau name.');

  const product = await prisma.product.findFirst({ where });
  if (!product) throw new Error(`Produk tidak ditemukan: ${JSON.stringify(selector)}`);
  return product;
}

async function findInventoryItem(row: RecipeJob['ingredients'][number]) {
  const where = defined(row.itemId)
    ? { id: row.itemId }
    : defined(row.itemCode)
      ? { code: row.itemCode }
      : defined(row.itemSku)
        ? { sku: row.itemSku }
        : defined(row.itemBarcode)
          ? { barcode: row.itemBarcode }
          : defined(row.itemName)
            ? { name: row.itemName }
            : null;

  if (!where) {
    throw new Error('Ingredient selector wajib isi itemId, itemCode, itemSku, itemBarcode, atau itemName.');
  }

  const item = await prisma.inventoryItem.findFirst({
    where: { ...where, status: 'ACTIVE' },
    include: { unit: true },
  });

  if (!item) throw new Error(`Bahan baku tidak ditemukan / inactive: ${JSON.stringify(where)}`);
  return item;
}

async function findUnit(name: string) {
  const unit = await prisma.inventoryUnit.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, status: 'ACTIVE' },
  });
  if (!unit) throw new Error(`Satuan recipe tidak ditemukan / inactive: ${name}`);
  return unit;
}

async function run() {
  if (!RECIPE_JOBS.length) {
    console.log('RECIPE_JOBS kosong. Tidak ada yang diproses.');
    return;
  }

  for (const job of RECIPE_JOBS) {
    if (!job.ingredients.length) throw new Error('Recipe minimal memiliki 1 bahan.');

    const product = await findProduct(job.product);
    const rows: ResolvedRecipeRow[] = [];
    const seenItemIds = new Set<string>();

    for (const ingredient of job.ingredients) {
      if (!(ingredient.usageQty > 0)) {
        throw new Error(`usageQty wajib lebih dari 0 untuk ${JSON.stringify(ingredient)}`);
      }

      const item = await findInventoryItem(ingredient);
      const unit = await findUnit(ingredient.usageUnitName);

      if (seenItemIds.has(item.id)) {
        throw new Error(`Bahan duplicate di recipe produk ${product.name}: ${item.name}`);
      }
      seenItemIds.add(item.id);

      rows.push({
        productId: product.id,
        inventoryItemId: item.id,
        usageQty: ingredient.usageQty,
        usageUnitId: unit.id,
        wastePercent: ingredient.wastePercent ?? 0,
        isActive: ingredient.isActive ?? true,
        itemName: item.name,
        itemCode: item.code,
        unitName: unit.name,
      });
    }

    await prisma.$transaction(async tx => {
      if (job.mode === 'replace') {
        await tx.productRecipe.deleteMany({ where: { productId: product.id } });
        await tx.productRecipe.createMany({
          data: rows.map(({ itemName, itemCode, unitName, ...data }) => data),
        });
      } else {
        for (const row of rows) {
          const { itemName, itemCode, unitName, ...data } = row;
          await tx.productRecipe.upsert({
            where: {
              productId_inventoryItemId: {
                productId: product.id,
                inventoryItemId: row.inventoryItemId,
              },
            },
            create: data,
            update: {
              usageQty: row.usageQty,
              usageUnitId: row.usageUnitId,
              wastePercent: row.wastePercent,
              isActive: row.isActive,
            },
          });
        }
      }
    });

    console.log(`OK ${job.mode.toUpperCase()} recipe: ${product.name}`);
    for (const row of rows) {
      console.log(`- ${row.itemName} (${row.itemCode}) ${row.usageQty} ${row.unitName}, waste ${row.wastePercent}%`);
    }
  }
}

run()
  .catch(error => {
    console.error('FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
