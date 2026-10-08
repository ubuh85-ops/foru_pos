import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { bundleInclude, bundlePreviewInput, priceBundle, resolveBundleSelections, type LoadedBundle } from './bundle-engine.js';
import { bundleAdminInput } from './bundles.js';

function fixture() {
  const product = { id: 'coffee', businessId: 'A', name: 'Coffee', status: 'ACTIVE', category: 'Coffee', categoryId: 'cat',
    categoryRef: { id: 'cat', businessId: 'A', status: 'ACTIVE', name: 'Coffee' }, basePrice: 20000, baseHpp: 4000,
    variants: [{ id: 'large', productId: 'coffee', variantName: 'Large', sellingPrice: 25000, hpp: 6000, status: 'ACTIVE' }],
    variantGroups: [], addons: [], channelPrices: [], outlets: [{ outletId: 'out', isAvailable: true, isActive: true, status: 'ACTIVE', stockMode: 'MANUAL', stockQty: 10, outletPrice: 18000, outletHpp: null }] };
  const bundle = { id: 'bundle', businessId: 'A', name: 'Lunch', categoryId: 'cat', category: product.categoryRef,
    basePrice: 35000, status: 'ACTIVE', availablePOS: true, availableWebOrder: true, startDate: null, endDate: null,
    outlets: [{ outletId: 'out', isActive: true, price: null, gofoodPrice: 40000, grabfoodPrice: null, shopeefoodPrice: null }],
    groups: [{ id: 'food', name: 'Choose food', minSelect: 1, maxSelect: 1, required: true, isFixed: false,
      items: [{ id: 'choice', productId: 'coffee', variantId: null, fixedOptionIds: [], qty: 1, additionalPrice: 7000, isActive: true, product }] }] } as unknown as LoadedBundle;
  const db = { outlet: { findFirst: vi.fn().mockResolvedValue({ id: 'out', businessId: 'A', status: 'ACTIVE' }) },
    productBundle: { findFirst: vi.fn().mockResolvedValue(bundle) },
    product: { findMany: vi.fn().mockResolvedValue([product]), findFirst: vi.fn().mockResolvedValue(product) } };
  const input = bundlePreviewInput.parse({ outletId: 'out', selections: [{ itemId: 'choice', variantId: 'large' }] });
  const run = (businessId = 'A') => priceBundle(db as unknown as Prisma.TransactionClient, businessId, 'bundle', input);
  return { product, bundle, db, input, run };
}
describe('bundle engine pricing and isolation', () => {
  it('prices from master bundle + item + variant, not sum of normal selling prices', async () => {
    const { run } = fixture();
    expect(await run()).toMatchObject({ basePrice: 35000, additionalPrice: 12000, unitPrice: 47000, total: 47000, unitHpp: 6000,
      selections: [{ productId: 'coffee', productName: 'Coffee', variantName: 'Large', qty: 1, unitHpp: 6000 }] });
  });
  it('aggregates component quantities and multiplies HPP by bundle quantity', async () => {
    const { bundle, input, run } = fixture();
    bundle.groups[0]!.items[0]!.qty = 2;
    input.qty = 3;
    expect(await run()).toMatchObject({ additionalPrice: 24000, totalHpp: 36000, components: [{ qty: 6 }] });
  });
  it('uses bundle online price and never the component online selling price', async () => {
    const { input, run } = fixture(); input.channel = 'GOFOOD';
    expect(await run()).toMatchObject({ basePrice: 40000, unitPrice: 52000 });
  });
  it('falls back to outlet bundle price', async () => {
    const { bundle, input, run } = fixture(); input.channel = 'GRABFOOD';
    bundle.outlets[0]!.price = new PrismaDecimal(33000) as never;
    expect(await run()).toMatchObject({ basePrice: 33000 });
  });
  it('scopes lookup to the authenticated tenant', async () => {
    const { db, run } = fixture(); await run();
    expect(db.outlet.findFirst).toHaveBeenCalledWith({ where: { id: 'out', businessId: 'A', status: 'ACTIVE' } });
    expect(db.productBundle.findFirst).toHaveBeenCalledWith({ where: { id: 'bundle', businessId: 'A' }, include: bundleInclude });
  });
  it('rejects a foreign outlet before loading a bundle', async () => {
    const { db, run } = fixture(); db.outlet.findFirst.mockResolvedValue(null);
    await expect(run('B')).rejects.toMatchObject({ status: 403 });
    expect(db.productBundle.findFirst).not.toHaveBeenCalled();
  });
  it('does not reveal another tenant bundle', async () => {
    const { db, run } = fixture(); db.productBundle.findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });
  it('rejects a tenant-mismatched component even if the bundle exists', async () => {
    const { product, run } = fixture(); product.businessId = 'B';
    await expect(run()).rejects.toMatchObject({ status: 409 });
  });
  it.each(['bundle', 'category', 'assignment', 'surface', 'period', 'product-category'] as const)('rejects unavailable %s', async reason => {
    const { bundle, run } = fixture();
    if (reason === 'bundle') bundle.status = 'INACTIVE';
    if (reason === 'category') bundle.category.status = 'INACTIVE';
    if (reason === 'assignment') bundle.outlets[0]!.isActive = false;
    if (reason === 'surface') bundle.availablePOS = false;
    if (reason === 'period') bundle.endDate = new Date('2000-01-01');
    if (reason === 'product-category') bundle.groups[0]!.items[0]!.product.categoryRef!.status = 'INACTIVE';
    await expect(run()).rejects.toMatchObject({ status: 409 });
  });
  it('rejects insufficient underlying stock', async () => {
    const { product, input, run } = fixture(); product.outlets[0]!.stockQty = 1; input.qty = 2;
    await expect(run()).rejects.toMatchObject({ status: 409 });
  });
  it('aggregates the same product selected through two groups', async () => {
    const { bundle, product, input, run } = fixture(); product.outlets[0]!.stockQty = 1;
    bundle.groups.push({ ...bundle.groups[0]!, id: 'drink', items: [{ ...bundle.groups[0]!.items[0]!, id: 'other' }] });
    input.selections.push({ itemId: 'other', variantId: 'large', selectedVariantOptionIds: [] });
    await expect(run()).rejects.toMatchObject({ status: 409 });
  });
  it('rejects an invalid legacy variant', async () => {
    const { input, run } = fixture(); input.selections[0]!.variantId = 'foreign';
    await expect(run()).rejects.toMatchObject({ status: 400 });
  });
  it('uses option HPP and price increments for modern variant groups', async () => {
    const { product, input, run } = fixture();
    Object.assign(product, { variants: [], variantGroups: [{ group: { id: 'size', businessId: 'A', name: 'Size', status: 'ACTIVE', required: true, minSelect: 1, maxSelect: 1,
      options: [{ id: 'option', name: 'Large', status: 'ACTIVE', additionalPrice: 3000, hpp: 1000, outlets: [] }] } }] });
    input.selections[0]!.variantId = undefined; input.selections[0]!.selectedVariantOptionIds = ['option'];
    expect(await run()).toMatchObject({ unitPrice: 45000, unitHpp: 5000 });
  });
  it('honors outlet HPP override over a legacy variant cost', async () => {
    const { product, run } = fixture(); Object.assign(product.outlets[0]!, { outletHpp: 7000 });
    expect(await run()).toMatchObject({ unitHpp: 7000 });
  });
  it('rejects foreign variant groups and legacy IDs on option-group products', async () => {
    const { product, run } = fixture(); Object.assign(product, { variantGroups: [{ group: { businessId: 'B' } }] });
    await expect(run()).rejects.toMatchObject({ status: 403 });
    Object.assign(product, { variantGroups: [{ group: { businessId: 'A' } }] });
    await expect(run()).rejects.toMatchObject({ status: 400 });
  });
  it('rejects missing business', async () => {
    const { db, run } = fixture(); await expect(run('')).rejects.toMatchObject({ status: 403 });
    expect(db.outlet.findFirst).not.toHaveBeenCalled();
  });
});

// Decimal-shaped value for fixture overrides without leaking DB implementation into assertions.
class PrismaDecimal { constructor(private value: number) {} valueOf() { return this.value; } }

describe('bundle choice constraints', () => {
  it('rejects missing required selection', () => {
    const { bundle } = fixture(); expect(() => resolveBundleSelections(bundle.groups, [])).toThrow('Choose food');
  });
  it('rejects duplicate and foreign choices', () => {
    const { bundle, input } = fixture();
    expect(() => resolveBundleSelections(bundle.groups, [...input.selections, ...input.selections])).toThrow('duplikat');
    expect(() => resolveBundleSelections(bundle.groups, [...input.selections, { itemId: 'foreign', selectedVariantOptionIds: [] }])).toThrow('bukan anggota');
  });
  it('automatically fills a fixed group but rejects replacing its variant', () => {
    const { bundle, input } = fixture(); const group = bundle.groups[0]!;
    group.isFixed = true; group.items[0]!.variantId = 'regular';
    expect(resolveBundleSelections(bundle.groups, [])).toHaveLength(1);
    expect(() => resolveBundleSelections(bundle.groups, input.selections)).toThrow('tidak boleh diganti');
  });
  it('rejects inactive choices and max-selection violations', () => {
    const { bundle, input } = fixture(); const group = bundle.groups[0]!;
    group.items.push({ ...group.items[0]!, id: 'other' });
    expect(() => resolveBundleSelections(bundle.groups, [...input.selections, { itemId: 'other', selectedVariantOptionIds: [] }])).toThrow('pilih');
    group.items[0]!.isActive = false;
    expect(() => resolveBundleSelections(bundle.groups, input.selections)).toThrow();
  });
  it('rejects client-supplied pricing, quantity and tenant fields', () => {
    expect(() => bundlePreviewInput.parse({ outletId: 'out', basePrice: 1 })).toThrow();
    expect(() => bundlePreviewInput.parse({ outletId: 'out', selections: [{ itemId: 'choice', qty: 999 }] })).toThrow();
    expect(() => bundlePreviewInput.parse({ outletId: 'out', businessId: 'B' })).toThrow();
  });
});
describe('bundle admin configuration', () => {
  const valid = { name: 'Lunch', categoryId: 'cat', basePrice: 35000, outlets: [{ outletId: 'out' }], groups: [{ name: 'Food', items: [{ productId: 'food' }] }] };
  it('defaults to inactive until explicitly enabled', () => expect(bundleAdminInput.parse(valid).status).toBe('INACTIVE'));
  it('rejects impossible selection constraints', () => expect(() => bundleAdminInput.parse({ ...valid, groups: [{ name: 'Food', minSelect: 2, maxSelect: 1, items: [{ productId: 'food' }] }] })).toThrow());
  it('rejects duplicate outlets and a reversed period', () => {
    expect(() => bundleAdminInput.parse({ ...valid, outlets: [{ outletId: 'out' }, { outletId: 'out' }] })).toThrow();
    expect(() => bundleAdminInput.parse({ ...valid, startDate: '2026-10-10T00:00:00Z', endDate: '2026-10-09T00:00:00Z' })).toThrow();
  });
  it('rejects businessId and master HPP in the body', () => {
    expect(() => bundleAdminInput.parse({ ...valid, businessId: 'B' })).toThrow();
    expect(() => bundleAdminInput.parse({ ...valid, baseHpp: 1 })).toThrow();
  });
});
