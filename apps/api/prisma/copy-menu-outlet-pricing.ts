import { Prisma, PrismaClient, type PaymentMethod, type Status } from '@prisma/client';
import XLSX from 'xlsx';

const prisma = new PrismaClient();

const ONLINE_CHANNELS = ['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'] as const;
type OnlineChannel = (typeof ONLINE_CHANNELS)[number];

type CliOptions = {
  source?: string;
  target?: string;
  business?: string;
  file?: string;
  exportTemplate?: string;
  dryRun: boolean;
  copyVariantOptions: boolean;
};

type PriceRow = {
  sku?: string;
  productName?: string;
  targetPrice?: number;
  targetHpp?: number;
  gofoodPrice?: number | null;
  grabfoodPrice?: number | null;
  shopeefoodPrice?: number | null;
  available?: boolean;
  status?: Status;
};

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { dryRun: false, copyVariantOptions: true };

  for (const arg of args) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-copy-variant-options') opts.copyVariantOptions = false;
    else if (arg.startsWith('--source=')) opts.source = arg.slice('--source='.length).trim();
    else if (arg.startsWith('--target=')) opts.target = arg.slice('--target='.length).trim();
    else if (arg.startsWith('--business=')) opts.business = arg.slice('--business='.length).trim();
    else if (arg.startsWith('--file=')) opts.file = arg.slice('--file='.length).trim();
    else if (arg.startsWith('--export-template=')) opts.exportTemplate = arg.slice('--export-template='.length).trim();
  }

  return opts;
}

function usage(): never {
  console.log(`
Copy menu outlet pricing backdoor

Generate template:
  pnpm copy-menu:outlet-pricing --source="FORU Roti bakar rakyat x burger pejabat" --target="Foru the mozz" --export-template=prisma/copy-menu-outlet-pricing-template.xlsx

Dry run:
  pnpm copy-menu:outlet-pricing --source="FORU Roti bakar rakyat x burger pejabat" --target="Foru the mozz" --file=prisma/copy-menu-outlet-pricing-template.xlsx --dry-run

Apply:
  pnpm copy-menu:outlet-pricing --source="FORU Roti bakar rakyat x burger pejabat" --target="Foru the mozz" --file=prisma/copy-menu-outlet-pricing-template.xlsx

Notes:
  - source/target can be outlet name or outlet code.
  - product SKU remains global per business; this script does not create duplicate products.
  - target_price/target_hpp blank = fallback to source outlet price/HPP, then product base price/HPP.
  - online price blank = remove target channel price so POS falls back to dine-in price.
`);
  process.exit(1);
}

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function text(value: unknown) {
  const s = String(value ?? '').trim();
  return s || undefined;
}

function parseMoney(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  if (!raw) return undefined;

  const withoutCurrency = raw.replace(/rp/gi, '').trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(withoutCurrency)) {
    return Number(withoutCurrency.replace(/\./g, '').replace(',', '.'));
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(withoutCurrency)) {
    return Number(withoutCurrency.replace(/,/g, ''));
  }
  const numeric = Number(withoutCurrency.replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'available', 'active', 'aktif'].includes(v)) return true;
  if (['false', 'no', 'n', '0', 'unavailable', 'inactive', 'nonaktif'].includes(v)) return false;
  return undefined;
}

function parseStatus(value: unknown): Status | undefined {
  const v = String(value ?? '').trim().toUpperCase();
  if (v === 'ACTIVE' || v === 'AKTIF') return 'ACTIVE';
  if (v === 'INACTIVE' || v === 'NONAKTIF' || v === 'NON-AKTIF') return 'INACTIVE';
  return undefined;
}

function getByAliases(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function readPriceRows(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error(`Sheet pertama tidak ditemukan di ${filePath}`);
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) throw new Error(`Sheet pertama tidak ditemukan di ${filePath}`);

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows = rawRows
    .map((raw) => {
      const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeHeader(key), value]));
      const available = parseBoolean(getByAliases(row, ['available', 'is_available', 'tersedia']));
      const status = parseStatus(getByAliases(row, ['status']));
      const priceRow: PriceRow = {
        sku: text(getByAliases(row, ['sku', 'product_code', 'kode_produk', 'code'])),
        productName: text(getByAliases(row, ['product_name', 'nama_produk', 'menu', 'product'])),
        targetPrice: parseMoney(getByAliases(row, ['target_price', 'dine_in_price', 'outlet_price', 'harga_dine_in', 'harga_baru'])),
        targetHpp: parseMoney(getByAliases(row, ['target_hpp', 'outlet_hpp', 'hpp_baru', 'hpp'])),
        gofoodPrice: parseMoney(getByAliases(row, ['gofood_price', 'harga_gofood', 'gofood'])) ?? null,
        grabfoodPrice: parseMoney(getByAliases(row, ['grabfood_price', 'harga_grabfood', 'grabfood'])) ?? null,
        shopeefoodPrice: parseMoney(getByAliases(row, ['shopeefood_price', 'harga_shopeefood', 'shopeefood'])) ?? null,
        available,
        status,
      };
      return priceRow;
    })
    .filter((row) => row.sku || row.productName);

  return rows;
}

function rowKeys(row: PriceRow) {
  const keys: string[] = [];
  if (row.sku) keys.push(`sku:${row.sku.toLowerCase()}`);
  if (row.productName) keys.push(`name:${row.productName.toLowerCase()}`);
  return keys;
}

function buildRowMap(rows: PriceRow[]) {
  const map = new Map<string, PriceRow>();
  const duplicates: string[] = [];

  for (const row of rows) {
    for (const key of rowKeys(row)) {
      if (map.has(key)) duplicates.push(key);
      map.set(key, row);
    }
  }

  return { map, duplicates };
}

function money(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

async function findBusiness(codeOrName?: string) {
  if (!codeOrName) return null;
  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { code: { equals: codeOrName, mode: 'insensitive' } },
        { name: { equals: codeOrName, mode: 'insensitive' } },
      ],
      status: 'ACTIVE',
    },
  });
  if (businesses.length !== 1) {
    throw new Error(`Business "${codeOrName}" ${businesses.length ? 'lebih dari satu' : 'tidak ditemukan'}.`);
  }
  return businesses[0];
}

async function findOutlet(label: string, businessId?: string) {
  const outlets = await prisma.outlet.findMany({
    where: {
      ...(businessId ? { businessId } : {}),
      status: 'ACTIVE',
      OR: [
        { name: { equals: label, mode: 'insensitive' } },
        { code: { equals: label, mode: 'insensitive' } },
      ],
    },
    include: { business: true },
  });

  if (outlets.length !== 1) {
    throw new Error(`Outlet "${label}" ${outlets.length ? 'lebih dari satu' : 'tidak ditemukan'}. Gunakan --business jika perlu.`);
  }

  const outlet = outlets[0];
  if (!outlet) throw new Error(`Outlet "${label}" tidak ditemukan.`);
  return outlet;
}

async function getOutletPair(opts: CliOptions) {
  if (!opts.source || !opts.target) usage();
  const sourceLabel = opts.source;
  const targetLabel = opts.target;

  const business = await findBusiness(opts.business);
  const source = await findOutlet(sourceLabel, business?.id);
  const target = await findOutlet(targetLabel, source.businessId);

  if (source.businessId !== target.businessId) {
    throw new Error('Source outlet dan target outlet harus dalam business/tenant yang sama.');
  }

  return { source, target };
}

async function getSourceMenu(sourceOutletId: string, businessId: string) {
  const rows = await prisma.productOutlet.findMany({
    where: {
      outletId: sourceOutletId,
      isAvailable: true,
      isActive: true,
      status: 'ACTIVE',
      product: { businessId, status: 'ACTIVE' },
    },
    include: {
      product: {
        include: {
          categoryRef: true,
          channelPrices: { where: { outletId: sourceOutletId, status: 'ACTIVE' } },
          variantGroups: { include: { group: { include: { options: { include: { outlets: { where: { outletId: sourceOutletId } } } } } } } },
        },
      },
    },
  });

  return rows.sort((a, b) => a.product.name.localeCompare(b.product.name));
}

function writeTemplate(
  outputPath: string,
  source: { name: string; code: string },
  target: { name: string; code: string },
  sourceMenu: Awaited<ReturnType<typeof getSourceMenu>>,
) {
  const rows = sourceMenu.map((po) => {
    const product = po.product;
    const channelPrices = new Map(product.channelPrices.map((cp) => [cp.channel, money(cp.price)]));
    const sourcePrice = money(po.outletPrice ?? product.basePrice);
    const sourceHpp = money(po.outletHpp ?? product.baseHpp);
    return {
      sku: product.sku ?? '',
      product_name: product.name,
      category: product.categoryRef?.name ?? product.category,
      source_outlet: `${source.name} (${source.code})`,
      target_outlet: `${target.name} (${target.code})`,
      source_price: sourcePrice,
      source_hpp: sourceHpp,
      target_price: sourcePrice,
      target_hpp: sourceHpp,
      gofood_price: channelPrices.get('GOFOOD') ?? '',
      grabfood_price: channelPrices.get('GRABFOOD') ?? '',
      shopeefood_price: channelPrices.get('SHOPEEFOOD') ?? '',
      available: 'TRUE',
      status: 'ACTIVE',
      notes: '',
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 24 },
    { wch: 36 },
    { wch: 24 },
    { wch: 36 },
    { wch: 30 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 28 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Copy Menu Pricing');
  XLSX.writeFile(workbook, outputPath);
}

function channelValue(row: PriceRow | undefined, channel: OnlineChannel) {
  if (!row) return undefined;
  if (channel === 'GOFOOD') return row.gofoodPrice;
  if (channel === 'GRABFOOD') return row.grabfoodPrice;
  return row.shopeefoodPrice;
}

async function main() {
  const opts = parseArgs();
  const { source, target } = await getOutletPair(opts);
  const sourceMenu = await getSourceMenu(source.id, source.businessId);

  console.log(`Business : ${source.business.name} (${source.business.code})`);
  console.log(`Source   : ${source.name} (${source.code})`);
  console.log(`Target   : ${target.name} (${target.code})`);
  console.log(`Menu     : ${sourceMenu.length} product aktif`);

  if (opts.exportTemplate) {
    writeTemplate(opts.exportTemplate, source, target, sourceMenu);
    console.log(`Template berhasil dibuat: ${opts.exportTemplate}`);
    return;
  }

  if (!opts.file) usage();

  const priceRows = readPriceRows(opts.file);
  const { map, duplicates } = buildRowMap(priceRows);
  if (duplicates.length) {
    throw new Error(`Duplicate row key di Excel: ${duplicates.slice(0, 10).join(', ')}`);
  }

  const plans = sourceMenu.map((po) => {
    const product = po.product;
    const row =
      (product.sku ? map.get(`sku:${product.sku.toLowerCase()}`) : undefined) ??
      map.get(`name:${product.name.toLowerCase()}`);
    const targetPrice = row?.targetPrice ?? money(po.outletPrice ?? product.basePrice);
    const targetHpp = row?.targetHpp ?? money(po.outletHpp ?? product.baseHpp);
    const available = row?.available ?? true;
    const status: Status = row?.status ?? (available ? 'ACTIVE' : 'INACTIVE');

    return { po, product, row, targetPrice, targetHpp, available, status };
  });

  const matchedRows = new Set<string>();
  for (const plan of plans) {
    if (plan.row) rowKeys(plan.row).forEach((key) => matchedRows.add(key));
  }
  const unmatchedRows = priceRows.filter((row) => !rowKeys(row).some((key) => matchedRows.has(key)));

  console.table(
    plans.map((plan) => ({
      sku: plan.product.sku ?? '-',
      product: plan.product.name,
      price: plan.targetPrice,
      hpp: plan.targetHpp,
      available: plan.available,
      status: plan.status,
      excel: plan.row ? 'MATCH' : 'FALLBACK_SOURCE',
    })),
  );

  if (unmatchedRows.length) {
    console.log('Row Excel yang tidak match product sumber:');
    console.table(unmatchedRows.map((row) => ({ sku: row.sku ?? '-', product: row.productName ?? '-' })));
  }

  if (opts.dryRun) {
    console.log('DRY RUN selesai. Tidak ada data yang diubah.');
    return;
  }

  let productOutletCount = 0;
  let channelUpsertCount = 0;
  let channelDeleteCount = 0;
  let variantOptionCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      await tx.productOutlet.upsert({
        where: { productId_outletId: { productId: plan.product.id, outletId: target.id } },
        update: {
          isAvailable: plan.available,
          isActive: plan.available && plan.status === 'ACTIVE',
          status: plan.status,
          outletPrice: new Prisma.Decimal(plan.targetPrice),
          outletHpp: new Prisma.Decimal(plan.targetHpp),
        },
        create: {
          productId: plan.product.id,
          outletId: target.id,
          isAvailable: plan.available,
          isActive: plan.available && plan.status === 'ACTIVE',
          status: plan.status,
          outletPrice: new Prisma.Decimal(plan.targetPrice),
          outletHpp: new Prisma.Decimal(plan.targetHpp),
        },
      });
      productOutletCount += 1;

      for (const channel of ONLINE_CHANNELS) {
        const price = channelValue(plan.row, channel);
        if (price === null || price === undefined) {
          const deleted = await tx.productChannelPrice.deleteMany({
            where: { productId: plan.product.id, outletId: target.id, channel: channel as PaymentMethod },
          });
          channelDeleteCount += deleted.count;
        } else {
          await tx.productChannelPrice.upsert({
            where: { productId_outletId_channel: { productId: plan.product.id, outletId: target.id, channel: channel as PaymentMethod } },
            update: { price: new Prisma.Decimal(price), status: 'ACTIVE' },
            create: { productId: plan.product.id, outletId: target.id, channel: channel as PaymentMethod, price: new Prisma.Decimal(price), status: 'ACTIVE' },
          });
          channelUpsertCount += 1;
        }
      }

      if (opts.copyVariantOptions) {
        const sourceOptionRows = plan.product.variantGroups.flatMap((vg) =>
          vg.group.options.flatMap((option) =>
            option.outlets.map((outletRow) => ({
              variantOptionId: option.id,
              additionalPrice: outletRow.additionalPrice,
              hpp: outletRow.hpp,
              status: outletRow.status,
            })),
          ),
        );

        for (const optionRow of sourceOptionRows) {
          await tx.variantOptionOutlet.upsert({
            where: { variantOptionId_outletId: { variantOptionId: optionRow.variantOptionId, outletId: target.id } },
            update: {
              additionalPrice: optionRow.additionalPrice,
              hpp: optionRow.hpp,
              status: optionRow.status,
            },
            create: {
              variantOptionId: optionRow.variantOptionId,
              outletId: target.id,
              additionalPrice: optionRow.additionalPrice,
              hpp: optionRow.hpp,
              status: optionRow.status,
            },
          });
          variantOptionCount += 1;
        }
      }
    }
  });

  console.log('Selesai copy menu outlet pricing.');
  console.log(`Product outlet di-upsert : ${productOutletCount}`);
  console.log(`Channel price di-upsert   : ${channelUpsertCount}`);
  console.log(`Channel price dihapus     : ${channelDeleteCount}`);
  console.log(`Variant option di-copy    : ${variantOptionCount}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
