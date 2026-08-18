import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'node:path';

const prisma = new PrismaClient();

type Row = {
  rowNumber: number;
  category: string;
  categoryId: string;
  ingredientCode: string;
  ingredientSku: string;
  ingredientName: string;
  qty: number;
  unit: string;
  wastePercent: number;
};

type Result = {
  row: number;
  status: 'ADDED' | 'SKIPPED' | 'ERROR' | 'WOULD_ADD';
  category: string;
  product: string;
  ingredient: string;
  message: string;
};

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find(x => x.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function numberValue(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).replace(/\./g, '').replace(',', '.').trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function firstValue(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);
  for (const key of keys) {
    const found = entries.find(([k]) => k.trim().toLowerCase() === key.trim().toLowerCase());
    if (found) return found[1];
  }
  return '';
}

function readRows(filePath: string): Row[] {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('Sheet pertama tidak ditemukan.');
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) throw new Error('Sheet pertama tidak ditemukan.');
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return rawRows.map((row, index) => {
    const qty = numberValue(firstValue(row, ['qty', 'usage_qty', 'jumlah']));
    const wastePercent = numberValue(firstValue(row, ['waste_percent', 'waste %', 'waste']), 0);
    return {
      rowNumber: index + 2,
      category: clean(firstValue(row, ['category', 'category_name', 'kategori', 'nama kategori'])),
      categoryId: clean(firstValue(row, ['category_id', 'id kategori'])),
      ingredientCode: clean(firstValue(row, ['ingredient_code', 'kode bahan'])),
      ingredientSku: clean(firstValue(row, ['ingredient_sku', 'sku bahan', 'barcode bahan'])),
      ingredientName: clean(firstValue(row, ['ingredient_name', 'nama bahan'])),
      qty,
      unit: clean(firstValue(row, ['unit', 'satuan'])),
      wastePercent,
    };
  }).filter(row => row.category || row.categoryId || row.ingredientCode || row.ingredientSku || row.ingredientName);
}

async function findProducts(row: Row) {
  if (row.categoryId) {
    return prisma.product.findMany({
      where: { categoryId: row.categoryId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }

  if (row.category) {
    return prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { category: { equals: row.category, mode: 'insensitive' } },
          { categoryRef: { name: { equals: row.category, mode: 'insensitive' } } },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  return [];
}

async function findIngredient(row: Row) {
  if (row.ingredientCode) {
    const byCode = await prisma.inventoryItem.findFirst({
      where: { code: { equals: row.ingredientCode, mode: 'insensitive' }, status: 'ACTIVE' },
    });
    if (byCode) return byCode;
  }
  if (row.ingredientSku) {
    const bySku = await prisma.inventoryItem.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          { sku: { equals: row.ingredientSku, mode: 'insensitive' } },
          { barcode: { equals: row.ingredientSku, mode: 'insensitive' } },
        ],
      },
    });
    if (bySku) return bySku;
  }
  if (row.ingredientName) {
    const byName = await prisma.inventoryItem.findFirst({
      where: { name: { equals: row.ingredientName, mode: 'insensitive' }, status: 'ACTIVE' },
    });
    if (byName) return byName;
  }
  return null;
}

async function findUnit(name: string) {
  if (!name) return null;
  return prisma.inventoryUnit.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, status: 'ACTIVE' } });
}

async function main() {
  const positionalArgs = process.argv.slice(2).filter(x => x !== '--' && !x.startsWith('--'));
  const filePath = positionalArgs[0] || arg('file');
  const apply = hasFlag('apply') || String(process.env.APPLY || '').toLowerCase() === 'true';
  if (!filePath) {
    throw new Error('File wajib diisi. Contoh: pnpm exec tsx prisma/import-product-recipes-by-category.ts ./category-recipe-import.xlsx --apply');
  }

  const rows = readRows(path.resolve(filePath));
  const results: Result[] = [];
  const plannedKeys = new Set<string>();

  for (const row of rows) {
    const categoryLabel = row.category || row.categoryId || '-';
    const ingredientLabel = row.ingredientCode || row.ingredientSku || row.ingredientName || '-';
    try {
      if (!categoryLabel || categoryLabel === '-') throw new Error('Kategori wajib diisi.');
      if (!Number.isFinite(row.qty) || row.qty <= 0) throw new Error('Qty wajib angka lebih dari 0.');
      if (!Number.isFinite(row.wastePercent) || row.wastePercent < 0 || row.wastePercent > 100) throw new Error('Waste percent wajib 0 - 100.');

      const [products, ingredient, unit] = await Promise.all([
        findProducts(row),
        findIngredient(row),
        findUnit(row.unit),
      ]);

      if (!products.length) throw new Error(`Tidak ada produk aktif untuk kategori: ${categoryLabel}`);
      if (!ingredient) throw new Error(`Bahan tidak ditemukan: ${ingredientLabel}`);
      if (!unit) throw new Error(`Satuan tidak ditemukan: ${row.unit || '-'}`);

      for (const product of products) {
        const recipeKey = `${product.id}:${ingredient.id}`;
        const existing = await prisma.productRecipe.findUnique({
          where: { productId_inventoryItemId: { productId: product.id, inventoryItemId: ingredient.id } },
        });

        if (existing || plannedKeys.has(recipeKey)) {
          results.push({
            row: row.rowNumber,
            status: 'SKIPPED',
            category: categoryLabel,
            product: product.name,
            ingredient: ingredient.name,
            message: existing
              ? 'Bahan sudah ada di recipe produk. Dilewati agar tidak double.'
              : 'Bahan sudah ada di file import untuk produk ini. Dilewati agar tidak double.',
          });
          continue;
        }

        if (!apply) {
          plannedKeys.add(recipeKey);
          results.push({
            row: row.rowNumber,
            status: 'WOULD_ADD',
            category: categoryLabel,
            product: product.name,
            ingredient: ingredient.name,
            message: `Preview tambah ${row.qty} ${unit.name}, waste ${row.wastePercent}%.`,
          });
          continue;
        }

        await prisma.productRecipe.create({
          data: {
            productId: product.id,
            inventoryItemId: ingredient.id,
            usageQty: row.qty,
            usageUnitId: unit.id,
            wastePercent: row.wastePercent,
            isActive: true,
          },
        });
        plannedKeys.add(recipeKey);

        results.push({
          row: row.rowNumber,
          status: 'ADDED',
          category: categoryLabel,
          product: product.name,
          ingredient: ingredient.name,
          message: `Ditambahkan ${row.qty} ${unit.name}, waste ${row.wastePercent}%.`,
        });
      }
    } catch (error) {
      results.push({
        row: row.rowNumber,
        status: 'ERROR',
        category: categoryLabel,
        product: '-',
        ingredient: ingredientLabel,
        message: (error as Error).message,
      });
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  console.table(results);
  console.log(JSON.stringify({ apply, totalRows: rows.length, summary }, null, 2));

  if (results.some(row => row.status === 'ERROR')) {
    process.exitCode = 1;
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
