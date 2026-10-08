import { describe, expect, it, vi } from 'vitest';
import { bundleSelectionError, bundleSelectionSurcharge, bundleSelectionsKey, selectionsFromSnapshot } from '../../web/src/posBundle.ts';
vi.mock('../../web/src/api', () => ({ api: vi.fn(), dt: () => 'date' }));
vi.mock('../../web/src/components/ui/AppDialog', () => ({ appAlert: vi.fn() }));
import { buildPrintText } from '../../web/src/printer.ts';

const product = { id: 'coffee', name: 'Coffee', basePrice: 18000, masterBasePrice: 20000, variants: [{ id: 'large', variantName: 'Large', sellingPrice: 25000 }], variantGroups: [] };
const item = { id: 'choice', productId: 'coffee', product, variantId: null, fixedOptionIds: [], qty: 2, additionalPrice: 7000, isActive: true, isAvailable: true };
const bundle = { groups: [{ id: 'food', name: 'Food', isFixed: false, required: true, minSelect: 1, maxSelect: 1, items: [item] }] };
const pick = [{ itemId: 'choice', variantId: 'large', selectedVariantOptionIds: [] }];
describe('POS bundle cart helpers', () => {
  it('builds stable keys independent of selection/option order', () => {
    const selections = [...pick, { itemId: 'tea', selectedVariantOptionIds: ['sugar', 'ice'] }];
    expect(bundleSelectionsKey('bundle', selections)).toBe(bundleSelectionsKey('bundle', [selections[1], selections[0]].map(row => ({ ...row, selectedVariantOptionIds: [...row.selectedVariantOptionIds].reverse() }))));
    expect(bundleSelectionsKey('bundle', pick)).not.toBe(bundleSelectionsKey('bundle', [{ ...pick[0], variantId: 'regular' }]));
  });
  it('restores server selections from an open bill without trusting snapshot prices', () => {
    expect(selectionsFromSnapshot([{ itemId: 'choice', variantId: null, selectedVariants: [{ optionId: 'ice' }], additionalPrice: 999 }])).toEqual([{ itemId: 'choice', variantId: undefined, selectedVariantOptionIds: ['ice'] }]);
  });
  it('validates required selections and sold-out choices', () => {
    expect(bundleSelectionError(bundle, [])).toContain('Food');
    expect(bundleSelectionError(bundle, pick)).toBe('');
    expect(bundleSelectionError({ groups: [{ ...bundle.groups[0], items: [{ ...item, isAvailable: false }] }] }, pick)).toContain('tidak tersedia');
  });
  it('recalculates upgrade charges but not normal component selling prices', () => {
    expect(bundleSelectionSurcharge(bundle, pick)).toBe(24000);
  });
  it('includes fixed groups and modern option surcharges', () => {
    const modern = { groups: [{ ...bundle.groups[0], isFixed: true, items: [{ ...item, fixedOptionIds: ['size'], product: { ...product, variants: [], variantGroups: [{ group: { id: 'size-group', name: 'Size', required: true, minSelect: 1, maxSelect: 1, options: [{ id: 'size', name: 'Large', additionalPrice: 3000 }] } }] } }] }] };
    expect(bundleSelectionSurcharge(modern, [])).toBe(20000);
    expect(bundleSelectionError(modern, [])).toBe('');
  });
  it('rejects incomplete modern option selections', () => {
    const modern = { groups: [{ ...bundle.groups[0], items: [{ ...item, product: { ...product, variants: [], variantGroups: [{ group: { id: 'size', name: 'Size', required: true, minSelect: 1, maxSelect: 1, options: [{ id: 'large', name: 'Large', additionalPrice: 0 }] } }] } }] }] };
    expect(bundleSelectionError(modern, pick)).toContain('Size');
  });
});
describe('bundle printing', () => {
  const doc = { id: 'sale', outlet: { name: 'Outlet' }, cashier: { name: 'Cashier' }, createdAt: '2026-10-08', items: [{ productName: 'Lunch', qty: 3, itemType: 'BUNDLE', subtotalAfterDiscount: 100000,
    bundleSelectionsJson: [{ productName: 'Coffee', variantName: 'Large', qty: 2 }] }] };
  it('prints actual multiplied component quantities for the kitchen', () => {
    const text = buildPrintText(doc, 'kitchen-ticket', 'MM80');
    expect(text).toContain('3x Lunch'); expect(text).toContain('6x Coffee Large');
  });
  it('keeps receipt revenue on the parent bundle only', () => {
    const text = buildPrintText(doc, 'customer-receipt', 'MM80');
    expect(text).toContain('3x Lunch'); expect(text).toContain('2x Coffee Large');
  });
});
