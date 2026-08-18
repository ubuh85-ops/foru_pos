import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'node:path';

const prisma = new PrismaClient();

type Row = {
  rowNumber: number;
  productSku: string;
  productName: string;
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
      productSku: clean(firstValue(row, ['product_sku', 'sku produk'])),
      productName: clean(firstValue(row, ['product_name', 'nama produk'])),
      ingredientCode: clean(firstValue(row, ['ingredient_code', 'kode bahan'])),
      ingredientSku: clean(firstValue(row, ['ingredient_sku', 'sku bahan', 'barcode bahan'])),
      ingredientName: clean(firstValue(row, ['ingredient_name', 'nama bahan'])),
      qty,
      unit: clean(firstValue(row, ['unit', 'satuan'])),
      wastePercent,
    };
  }).filter(row => row.productSku || row.productName || row.ingredientCode || row.ingredientSku || row.ingredientName);
}

async function findProduct(row: Row) {
  if (row.productSku) {
    const bySku = await prisma.product.findFirst({ where: { sku: { equals: row.productSku, mode: 'insensitive' } } });
    if (bySku) return bySku;
  }
  if (row.productName) {
    const byName = await prisma.product.findFirst({ where: { name: { equals: row.productName, mode: 'insensitive' } } });
    if (byName) return byName;
  }
  return null;
}

async function findIngredient(row: Row) {
  if (row.ingredientCode) {
    const byCode = await prisma.inventoryItem.findFirst({ where: { code: { equals: row.ingredientCode, mode: 'insensitive' }, status: 'ACTIVE' } });
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
    const byName = await prisma.inventoryItem.findFirst({ where: { name: { equals: row.ingredientName, mode: 'insensitive' }, status: 'ACTIVE' } });
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
    throw new Error('File wajib diisi. Contoh: pnpm exec tsx prisma/import-product-recipes.ts ./recipe-import.xlsx --apply');
  }

  const rows = readRows(path.resolve(filePath));
  const results: Result[] = [];

  for (const row of rows) {
    const productLabel = row.productSku || row.productName || '-';
    const ingredientLabel = row.ingredientCode || row.ingredientSku || row.ingredientName || '-';
    try {
      if (!Number.isFinite(row.qty) || row.qty <= 0) throw new Error('Qty wajib angka lebih dari 0.');
      if (!Number.isFinite(row.wastePercent) || row.wastePercent < 0 || row.wastePercent > 100) throw new Error('Waste percent wajib 0 - 100.');

      const [product, ingredient, unit] = await Promise.all([
        findProduct(row),
        findIngredient(row),
        findUnit(row.unit),
      ]);

      if (!product) throw new Error(`Produk tidak ditemukan: ${productLabel}`);
      if (!ingredient) throw new Error(`Bahan tidak ditemukan: ${ingredientLabel}`);
      if (!unit) throw new Error(`Satuan tidak ditemukan: ${row.unit || '-'}`);

      const existing = await prisma.productRecipe.findUnique({
        where: { productId_inventoryItemId: { productId: product.id, inventoryItemId: ingredient.id } },
      });

      if (existing) {
        results.push({
          row: row.rowNumber,
          status: 'SKIPPED',
          product: product.name,
          ingredient: ingredient.name,
          message: 'Bahan sudah ada di recipe produk. Dilewati agar tidak double.',
        });
        continue;
      }

      if (!apply) {
        results.push({
          row: row.rowNumber,
          status: 'WOULD_ADD',
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

      results.push({
        row: row.rowNumber,
        status: 'ADDED',
        product: product.name,
        ingredient: ingredient.name,
        message: `Ditambahkan ${row.qty} ${unit.name}, waste ${row.wastePercent}%.`,
      });
    } catch (error) {
      results.push({
        row: row.rowNumber,
        status: 'ERROR',
        product: productLabel,
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
