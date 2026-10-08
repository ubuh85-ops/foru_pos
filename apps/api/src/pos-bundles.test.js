import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./bundle-engine.js', async original => ({ ...await original(), priceBundle: vi.fn() }));
vi.mock('./discount.js', async original => ({ ...await original(), priceCart: vi.fn() }));
import { priceBundle } from './bundle-engine.js';
import { priceCart } from './discount.js';
import { assertBundleComponentsForPayment, posCartItemInput, pricePosCart, stockItemsFromSnapshots } from './pos-bundles.js';

const selected = [{ itemId: 'choice', selectedVariantOptionIds: [] }];
const bundle = { productId: 'bundle', bundleId: 'bundle', bundleSelections: selected, qty: 2 };
const snapshot = [{ itemId: 'choice', groupId: 'food', groupName: 'Food', productId: 'coffee', productName: 'Coffee', variantId: null,
  variantName: 'Base', selectedVariants: [], qty: 2, additionalPrice: 7000, variantAdditionalPrice: 0, unitHpp: 4000, totalHpp: 8000 }];
const tx = {productOutlet:{findMany:vi.fn()}};
beforeEach(() => {
  vi.clearAllMocks();
  tx.productOutlet.findMany.mockResolvedValue([{productId:'coffee',product:{name:'Coffee'},isActive:true,isAvailable:true,status:'ACTIVE',stockMode:'MANUAL',stockQty:100}]);
  priceBundle.mockImplementation(async (_tx, _business, id, input) => ({ bundleId: id, bundleName: 'Lunch', categoryId: 'cat', category: 'Lunch category',
    outletId: 'out', channel: input.channel, qty: input.qty, basePrice: 35000, masterBasePrice: 35000, dineInPrice: 49000, additionalPrice: 14000,
    unitPrice: 49000, total: 49000 * input.qty, unitHpp: 8000, totalHpp: 8000 * input.qty, selections: snapshot,
    components: [{ productId: 'coffee', qty: 2 * input.qty }] }));
  priceCart.mockImplementation(async items => items.map(item => ({ ...item, productName: 'Coffee', category: 'Coffee', unitPrice: 10000, hpp: 4000,
    gross: item.qty * 10000, discountAmount: 0, net: item.qty * 10000, addons: [], selectedVariants: [] })));
});
describe('POS mixed bundle pricing', () => {
  it('creates one financial line per bundle, not financial lines for components', async () => {
    const lines = await pricePosCart(tx, 'A', 'out', 'DINE_IN', [bundle]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ bundleId: 'bundle', gross: 98000, hpp: 8000, qty: 2, bundleSelectionsJson: snapshot });
    expect(priceBundle).toHaveBeenCalledWith(tx, 'A', 'bundle', expect.objectContaining({ outletId: 'out', qty: 2, selections: selected }));
  });
  it('checks aggregate component stock across normal products and multiple bundles', async () => {
    await pricePosCart(tx, 'A', 'out', 'DINE_IN', [{ productId: 'coffee', qty: 3 }, bundle, { ...bundle, qty: 1 }]);
    expect(tx.productOutlet.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{outletId:'out',productId:{in:['coffee']},product:{businessId:'A',status:'ACTIVE'}}}));
    tx.productOutlet.findMany.mockResolvedValue([{productId:'coffee',product:{name:'Coffee'},isActive:true,isAvailable:true,status:'ACTIVE',stockMode:'MANUAL',stockQty:8}]);
    await expect(pricePosCart(tx,'A','out','DINE_IN',[{productId:'coffee',qty:3},bundle,{...bundle,qty:1}])).rejects.toMatchObject({status:409});
  });
  it('propagates aggregate stock failure so no sale can be persisted', async () => {
    tx.productOutlet.findMany.mockResolvedValue([]);
    await expect(pricePosCart(tx, 'A', 'out', 'DINE_IN', [bundle])).rejects.toMatchObject({status:409});
  });
  it('applies discount after bundle upgrades while keeping HPP unchanged', async () => {
    const [line] = await pricePosCart(tx, 'A', 'out', 'DINE_IN', [{ ...bundle, discount: { type: 'PERCENTAGE', value: 10 } }]);
    expect(line).toMatchObject({ gross: 98000, discountAmount: 9800, net: 88200, hpp: 8000 });
  });
  it('preserves normal product behavior without invoking bundle pricing', async () => {
    const [line] = await pricePosCart(tx, 'A', 'out', 'DINE_IN', [{ productId: 'coffee', qty: 100 }]);
    expect(line).toMatchObject({ productId: 'coffee', qty: 100, unitPrice: 10000 }); expect(priceBundle).not.toHaveBeenCalled();
  });
  it.each([{ ...bundle, productId: 'other' }, { ...bundle, price: 1 }, { ...bundle, bundleSelectionsJson: [] }, { ...bundle, variantId: 'foreign' }, { ...bundle, qty: 51 }])('rejects ambiguous/forged bundle payload', body => {
    expect(() => posCartItemInput.parse(body)).toThrow();
  });
});
describe('bundle stock snapshots', () => {
  it('expands product quantities and links movements to parent sale item', () => {
    expect(stockItemsFromSnapshots([{ id: 'parent', productId: null, productName: 'Lunch', itemType: 'BUNDLE', qty: 3, bundleSelectionsJson: snapshot },
      { id: 'normal', productId: 'tea', productName: 'Tea', qty: 1 }])).toEqual([
      { id: 'parent', productId: 'coffee', productName: 'Coffee', qty: 6 }, { id: 'normal', productId: 'tea', productName: 'Tea', qty: 1 }]);
  });
  it('does not deduct the synthetic bundle product ID', () => {
    expect(stockItemsFromSnapshots([{ id: 'parent', productId: null, productName: 'Lunch', itemType: 'BUNDLE', qty: 1, bundleSelectionsJson: snapshot }]).map(item => item.productId)).toEqual(['coffee']);
  });
  it('rejects corrupted or missing snapshots rather than skipping deductions', () => {
    expect(() => stockItemsFromSnapshots([{ id: 'parent', itemType: 'BUNDLE', productId: null, qty: 1, bundleSelectionsJson: null }])).toThrow();
  });
  it('validates active tenant products for payment without repricing saved snapshots', async () => {
    const db = { product: { findMany: vi.fn().mockResolvedValue([{ id: 'coffee', variants: [], variantGroups: [] }]) } };
    const saved = structuredClone(snapshot);
    await assertBundleComponentsForPayment(db, 'A', 'out', [{ id: 'parent', itemType: 'BUNDLE', qty: 2, bundleSelectionsJson: saved }]);
    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 'A', status: 'ACTIVE', id: { in: ['coffee'] } }) }));
    expect(saved).toEqual(snapshot);
  });
  it('rejects missing/foreign product or deactivated variant at payment', async () => {
    const db = { product: { findMany: vi.fn().mockResolvedValue([]) } };
    const parent = { id: 'parent', itemType: 'BUNDLE', qty: 1, bundleSelectionsJson: snapshot };
    await expect(assertBundleComponentsForPayment(db, 'A', 'out', [parent])).rejects.toMatchObject({ status: 409 });
    db.product.findMany.mockResolvedValue([{ id: 'coffee', variants: [], variantGroups: [] }]);
    await expect(assertBundleComponentsForPayment(db, 'A', 'out', [{ ...parent, bundleSelectionsJson: [{ ...snapshot[0], variantId: 'disabled' }] }])).rejects.toMatchObject({ status: 409 });
  });
});
