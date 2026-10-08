import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError, money } from './lib.js';
import { priceCart, type CartLine, type PriceChannel } from './discount.js';

export const bundleSelectionInput = z.object({
  itemId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  selectedVariantOptionIds: z.array(z.string().min(1)).max(50).default([]),
}).strict();
export const bundlePreviewInput = z.object({
  outletId: z.string().min(1),
  surface: z.enum(['POS', 'WEB_ORDER']).default('POS'),
  channel: z.enum(['DINE_IN', 'TAKE_AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD']).default('DINE_IN'),
  qty: z.number().int().min(1).max(50).default(1),
  selections: z.array(bundleSelectionInput).max(100).default([]),
}).strict();
export type BundleSelection = z.infer<typeof bundleSelectionInput>;
export const bundleInclude = {
  category: true,
  outlets: true,
  groups: { orderBy: { sortOrder: 'asc' as const }, include: {
    items: { orderBy: { sortOrder: 'asc' as const }, include: {
      product: { include: { categoryRef: true, variants: true, variantGroups: { include: { group: true } } } },
    } },
  } },
} satisfies Prisma.ProductBundleInclude;
export type LoadedBundle = Prisma.ProductBundleGetPayload<{ include: typeof bundleInclude }>;

// No price, HPP, productId or quantity supplied by the customer is trusted.
export function resolveBundleSelections(groups: LoadedBundle['groups'], selections: BundleSelection[]) {
  const requested = new Map<string, BundleSelection>();
  for (const selection of selections) {
    if (requested.has(selection.itemId)) throw new ApiError(400, 'Pilihan paket duplikat');
    requested.set(selection.itemId, selection);
  }
  const resolved: { group: LoadedBundle['groups'][number]; item: LoadedBundle['groups'][number]['items'][number]; selection: BundleSelection }[] = [];
  for (const group of groups) {
    const active = group.items.filter(item => item.isActive);
    const picks = group.isFixed ? active : active.filter(item => requested.has(item.id));
    const minimum = group.required ? Math.max(1, group.minSelect) : group.minSelect;
    if (!group.isFixed && (picks.length < minimum || picks.length > group.maxSelect)) {
      throw new ApiError(400, `${group.name}: pilih ${minimum}–${group.maxSelect} item`);
    }
    if (group.isFixed && !picks.length) throw new ApiError(409, `${group.name}: isi paket tidak tersedia`);
    for (const item of picks) {
      const selection = requested.get(item.id) ?? { itemId: item.id, selectedVariantOptionIds: [] };
      requested.delete(item.id);
      if (item.variantId && selection.variantId && selection.variantId !== item.variantId) throw new ApiError(400, 'Variant tetap paket tidak boleh diganti');
      if (item.fixedOptionIds.length && selection.selectedVariantOptionIds.length &&
        (selection.selectedVariantOptionIds.length !== item.fixedOptionIds.length || selection.selectedVariantOptionIds.some(id => !item.fixedOptionIds.includes(id)))) {
        throw new ApiError(400, 'Opsi tetap paket tidak boleh diganti');
      }
      resolved.push({ group, item, selection });
    }
  }
  if (requested.size) throw new ApiError(400, 'Pilihan bukan anggota paket atau sudah nonaktif');
  if (!resolved.length) throw new ApiError(400, 'Paket harus mempunyai isi');
  return resolved;
}

export function bundlePriceForChannel(base: number, outlet: LoadedBundle['outlets'][number], channel: PriceChannel) {
  const override = channel === 'GOFOOD' ? outlet.gofoodPrice : channel === 'GRABFOOD' ? outlet.grabfoodPrice : channel === 'SHOPEEFOOD' ? outlet.shopeefoodPrice : null;
  return money(override ?? outlet.price ?? base);
}

export async function priceBundle(db: Prisma.TransactionClient, businessId: string, bundleId: string, input: z.infer<typeof bundlePreviewInput>, now = new Date()) {
  input = bundlePreviewInput.parse(input);
  if (!businessId) throw new ApiError(403, 'Business tidak valid');
  const outlet = await db.outlet.findFirst({ where: { id: input.outletId, businessId, status: 'ACTIVE' } });
  if (!outlet) throw new ApiError(403, 'Outlet tidak diizinkan');
  const bundle = await db.productBundle.findFirst({ where: { id: bundleId, businessId }, include: bundleInclude });
  if (!bundle) throw new ApiError(404, 'Paket tidak ditemukan');
  const assignment = bundle.outlets.find(row => row.outletId === input.outletId && row.isActive);
  if (!assignment || bundle.status !== 'ACTIVE' || bundle.category.businessId !== businessId || bundle.category.status !== 'ACTIVE' ||
    (bundle.startDate && now < bundle.startDate) || (bundle.endDate && now > bundle.endDate) ||
    (input.surface === 'POS' ? !bundle.availablePOS : !bundle.availableWebOrder)) {
    throw new ApiError(409, 'Paket tidak tersedia pada outlet, channel, atau periode ini');
  }
  const resolved = resolveBundleSelections(bundle.groups, input.selections);
  const components: CartLine[] = resolved.map(({ item, selection }) => {
    if (item.product.businessId !== businessId || item.product.categoryRef?.status === 'INACTIVE') throw new ApiError(409, 'Produk paket tidak tersedia');
    if (item.product.variantGroups.some(row => row.group.businessId !== businessId)) throw new ApiError(403, 'Group variant tidak diizinkan');
    if (item.product.variantGroups.length && (item.variantId || selection.variantId)) throw new ApiError(400, 'Produk ini menggunakan opsi variant, bukan legacy variant');
    return { productId: item.productId, variantId: item.variantId ?? selection.variantId,
      selectedVariantOptionIds: item.fixedOptionIds.length ? item.fixedOptionIds : selection.selectedVariantOptionIds,
      qty: item.qty * input.qty };
  });
  // Reuse normal product/outlet/variant validation and aggregate manual stock checks.
  // Dine-in component price is used only to determine variant surcharge, never bundle base price.
  const lines = await priceCart(components, input.outletId, 'DINE_IN', businessId, undefined, db);
  const snapshots = lines.map((line, index) => {
    const { item, group } = resolved[index]!;
    const variant = line.variantId ? item.product.variants.find(row => row.id === line.variantId) : undefined;
    // Legacy variant HPP is an absolute cost; modern option HPP is incremental.
    const hpp = variant ? (line.outletHpp ?? Number(variant.hpp)) : line.hpp;
    return { itemId: item.id, groupId: group.id, groupName: group.name,
      productId: line.productId, productName: line.productName, variantId: line.variantId ?? null,
      variantName: line.variantName, selectedVariants: line.selectedVariants,
      qty: item.qty, additionalPrice: money(item.additionalPrice), variantAdditionalPrice: line.variantPriceTotal,
      unitHpp: money(hpp), totalHpp: money(hpp * item.qty) };
  });
  const basePrice = bundlePriceForChannel(Number(bundle.basePrice), assignment, input.channel);
  const additionalPrice = money(snapshots.reduce((sum, item) => sum + (item.additionalPrice + item.variantAdditionalPrice) * item.qty, 0));
  const unitHpp = money(snapshots.reduce((sum, item) => sum + item.totalHpp, 0));
  const unitPrice = money(basePrice + additionalPrice);
  const dineInPrice = money(bundlePriceForChannel(Number(bundle.basePrice), assignment, 'DINE_IN') + additionalPrice);
  if (unitPrice < 0) throw new ApiError(400, 'Harga paket tidak boleh negatif');
  return { type: 'BUNDLE' as const, bundleId: bundle.id, bundleName: bundle.name, categoryId: bundle.categoryId,
    category: bundle.category.name, outletId: input.outletId, channel: input.channel, qty: input.qty,
    basePrice, masterBasePrice: Number(bundle.basePrice), outletPrice: assignment.price === null ? undefined : Number(assignment.price), dineInPrice,
    additionalPrice, unitPrice, total: money(unitPrice * input.qty), unitHpp,
    totalHpp: money(unitHpp * input.qty), selections: snapshots, components };
}
