import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';

const prisma = new PrismaClient();

/**
 * Import Product Recipe dari Excel.
 *
 * Template:
 *   outputs/recipe-import-template/foru-product-recipe-import-template.xlsx
 *
 * Cara pakai local:
 *   cd apps/api
 *   pnpm exec tsx prisma/backdoor-import-product-recipes-from-excel.ts ../../outputs/recipe-import-template/foru-product-recipe-import-template.xlsx
 *
 * Cara pakai VPS:
 *   1) Upload file Excel ke VPS, misalnya /tmp/recipe-import.xlsx
 *   2) Jalankan:
 *      cd /opt/foru-pos/deploy
 *      docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
 *        -v /tmp/recipe-import.xlsx:/tmp/recipe-import.xlsx api \
 *        pnpm exec tsx prisma/backdoor-import-product-recipes-from-excel.ts /tmp/recipe-import.xlsx
 *
 * Output:
 * - Recipe masuk/update ke database.
 * - File Excel akan ditulis ulang dengan kolom result_status dan result_message.
 */

type LookupType = 'id' | 'sku' | 'name' | 'code' | 'barcode';
type ImportMode = 'replace' | 'upsert';

type ExcelRecipeRow = {
  rowNumber: number;
  mode: ImportMode;
  product_lookup_type: LookupType;
  product_lookup_value: string;
  ingredient_lookup_type: LookupType;
  ingredient_lookup_value: string;
  usage_qty: number;
  usage_unit_name: string;
  waste_percent: number;
  is_active: boolean;
};

type ResolvedRecipeRow = {
  sourceRow: number;
  productId: string;
  productName: string;
  inventoryItemId: string;
  itemName: string;
  itemCode: string;
  usageQty: number;
  usageUnitId: string;
  unitName: string;
  wastePercent: number;
  isActive: boolean;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeLookup(value: unknown): LookupType {
  const next = normalize(value).toLowerCase() as LookupType;
  if (!['id', 'sku', 'name', 'code', 'barcode'].includes(next)) throw new Error(`lookup_type tidak valid: ${value}`);
  return next;
}

function normalizeMode(value: unknown): ImportMode {
  const next = normalize(value).toLowerCase() as ImportMode;
  if (!['replace', 'upsert'].includes(next)) throw new Error(`mode tidak valid: ${value}`);
  return next;
}

function normalizeBoolean(value: unknown) {
  const next = normalize(value).toLowerCase();
  if (!next) return true;
  return ['true', '1', 'yes', 'y', 'aktif', 'active'].includes(next);
}

function numberValue(value: unknown, fieldName: string) {
  const raw = normalize(value).replace(',', '.');
  const next = Number(raw);
  if (!Number.isFinite(next)) throw new Error(`${fieldName} harus angka: ${value}`);
  return next;
}

function firstSheet(workbook: XLSX.WorkBook) {
  const sheetName = workbook.SheetNames.includes('Recipe Import') ? 'Recipe Import' : workbook.SheetNames[0];
  if (!sheetName) throw new Error('Workbook tidak memiliki sheet.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet tidak ditemukan: ${sheetName}`);
  return { sheetName, sheet };
}

function parseRows(sheet: XLSX.WorkSheet): ExcelRecipeRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  const parsed: ExcelRecipeRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const productValue = normalize(row.product_lookup_value);
    const ingredientValue = normalize(row.ingredient_lookup_value);

    if (!productValue && !ingredientValue) return;

    parsed.push({
      rowNumber,
      mode: normalizeMode(row.mode || 'upsert'),
      product_lookup_type: normalizeLookup(row.product_lookup_type || 'name'),
      product_lookup_value: productValue,
      ingredient_lookup_type: normalizeLookup(row.ingredient_lookup_type || 'code'),
      ingredient_lookup_value: ingredientValue,
      usage_qty: numberValue(row.usage_qty, 'usage_qty'),
      usage_unit_name: normalize(row.usage_unit_name),
      waste_percent: row.waste_percent === '' ? 0 : numberValue(row.waste_percent, 'waste_percent'),
      is_active: normalizeBoolean(row.is_active),
    });
  });

  return parsed;
}

function productWhere(type: LookupType, value: string) {
  if (type === 'id') return { id: value };
  if (type === 'sku') return { sku: value };
  if (type === 'name') return { name: value };
  throw new Error(`product_lookup_type hanya boleh id, sku, atau name. Diterima: ${type}`);
}

function itemWhere(type: LookupType, value: string) {
  if (type === 'id') return { id: value };
  if (type === 'code') return { code: value };
  if (type === 'sku') return { sku: value };
  if (type === 'barcode') return { barcode: value };
  if (type === 'name') return { name: value };
  throw new Error(`ingredient_lookup_type tidak valid: ${type}`);
}

async function resolveRow(row: ExcelRecipeRow): Promise<ResolvedRecipeRow> {
  if (!row.product_lookup_value) throw new Error('product_lookup_value wajib diisi.');
  if (!row.ingredient_lookup_value) throw new Error('ingredient_lookup_value wajib diisi.');
  if (!(row.usage_qty > 0)) throw new Error('usage_qty wajib lebih dari 0.');
  if (!row.usage_unit_name) throw new Error('usage_unit_name wajib diisi.');
  if (row.waste_percent < 0 || row.waste_percent > 100) throw new Error('waste_percent harus 0 - 100.');

  const product = await prisma.product.findFirst({ where: productWhere(row.product_lookup_type, row.product_lookup_value) });
  if (!product) throw new Error(`Produk tidak ditemukan: ${row.product_lookup_type}=${row.product_lookup_value}`);

  const item = await prisma.inventoryItem.findFirst({
    where: { ...itemWhere(row.ingredient_lookup_type, row.ingredient_lookup_value), status: 'ACTIVE' },
    include: { unit: true },
  });
  if (!item) throw new Error(`Bahan tidak ditemukan / inactive: ${row.ingredient_lookup_type}=${row.ingredient_lookup_value}`);

  const unit = await prisma.inventoryUnit.findFirst({
    where: { name: { equals: row.usage_unit_name, mode: 'insensitive' }, status: 'ACTIVE' },
  });
  if (!unit) throw new Error(`Satuan tidak ditemukan / inactive: ${row.usage_unit_name}`);

  return {
    sourceRow: row.rowNumber,
    productId: product.id,
    productName: product.name,
    inventoryItemId: item.id,
    itemName: item.name,
    itemCode: item.code,
    usageQty: row.usage_qty,
    usageUnitId: unit.id,
    unitName: unit.name,
    wastePercent: row.waste_percent,
    isActive: row.is_active,
  };
}

function setResult(sheet: XLSX.WorkSheet, rowNumber: number, status: string, message: string) {
  sheet[`K${rowNumber}`] = { t: 's', v: status };
  sheet[`L${rowNumber}`] = { t: 's', v: message };
}

async function main() {
  const excelPath = process.argv[2];
  if (!excelPath) {
    throw new Error('Path file Excel wajib dikirim. Contoh: pnpm exec tsx prisma/backdoor-import-product-recipes-from-excel.ts ./recipe.xlsx');
  }

  const resolvedPath = path.resolve(excelPath);
  const workbook = XLSX.readFile(resolvedPath);
  const { sheet } = firstSheet(workbook);
  const rows = parseRows(sheet);

  if (!rows.length) throw new Error('Tidak ada baris recipe yang bisa diproses.');

  const successRows: ResolvedRecipeRow[] = [];
  const failedRows: Array<{ rowNumber: number; message: string }> = [];

  for (const row of rows) {
    try {
      successRows.push(await resolveRow(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedRows.push({ rowNumber: row.rowNumber, message });
      setResult(sheet, row.rowNumber, 'FAILED', message);
    }
  }

  const rowsByProduct = new Map<string, ResolvedRecipeRow[]>();
  for (const row of successRows) {
    rowsByProduct.set(row.productId, [...(rowsByProduct.get(row.productId) || []), row]);
  }

  for (const [productId, productRows] of rowsByProduct) {
    const productName = productRows[0]?.productName || productId;
    const sourceRows = productRows.map(row => row.sourceRow);
    const mode: ImportMode = rows.find(row => row.rowNumber === productRows[0]?.sourceRow)?.mode || 'upsert';
    const duplicateItem = productRows.find((row, idx) => productRows.findIndex(other => other.inventoryItemId === row.inventoryItemId) !== idx);

    if (duplicateItem) {
      for (const row of productRows) setResult(sheet, row.sourceRow, 'FAILED', `Duplicate bahan untuk produk ${productName}: ${duplicateItem.itemName}`);
      continue;
    }

    try {
      await prisma.$transaction(async tx => {
        if (mode === 'replace') {
          await tx.productRecipe.deleteMany({ where: { productId } });
          await tx.productRecipe.createMany({
            data: productRows.map(row => ({
              productId,
              inventoryItemId: row.inventoryItemId,
              usageQty: row.usageQty,
              usageUnitId: row.usageUnitId,
              wastePercent: row.wastePercent,
              isActive: row.isActive,
            })),
          });
        } else {
          for (const row of productRows) {
            await tx.productRecipe.upsert({
              where: {
                productId_inventoryItemId: {
                  productId,
                  inventoryItemId: row.inventoryItemId,
                },
              },
              create: {
                productId,
                inventoryItemId: row.inventoryItemId,
                usageQty: row.usageQty,
                usageUnitId: row.usageUnitId,
                wastePercent: row.wastePercent,
                isActive: row.isActive,
              },
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

      for (const sourceRow of sourceRows) setResult(sheet, sourceRow, 'OK', `${mode.toUpperCase()} recipe ${productName} berhasil.`);
      console.log(`OK ${mode.toUpperCase()}: ${productName} (${productRows.length} bahan)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const sourceRow of sourceRows) setResult(sheet, sourceRow, 'FAILED', message);
      failedRows.push(...sourceRows.map(rowNumber => ({ rowNumber, message })));
      console.error(`FAILED ${productName}: ${message}`);
    }
  }

  XLSX.writeFile(workbook, resolvedPath);
  console.log(`Done. Success rows: ${successRows.length - failedRows.length}. Failed rows: ${failedRows.length}.`);
  console.log(`Result written to: ${resolvedPath}`);

  if (failedRows.length) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error('FAILED:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
