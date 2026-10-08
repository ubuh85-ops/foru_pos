import { describe, expect, it } from 'vitest';
import { bundlePayload, editBundle, localDateTime, newBundle, newBundleChoice } from '../../web/src/bundleAdmin.ts';
import { bundleAdminInput } from './bundles.js';

function validDraft() {
  const draft = newBundle('out');
  Object.assign(draft, { name: 'Lunch', categoryId: 'cat', basePrice: '35000' });
  draft.groups[0].name = 'Food'; draft.groups[0].items[0].productId = 'food';
  return draft;
}
describe('bundle admin form payload', () => {
  it('serializes a new draft to the strict backend schema', () => {
    const body = bundlePayload(validDraft());
    expect(bundleAdminInput.parse(body)).toMatchObject({ basePrice: 35000, status: 'INACTIVE', outlets: [{ outletId: 'out', price: null }] });
  });
  it('does not turn an empty base price into free bundle', () => {
    const draft = validDraft(); draft.basePrice = '';
    expect(() => bundlePayload(draft)).toThrow('wajib diisi');
  });
  it('preserves explicit zero overrides and leaves blank override as null', () => {
    const draft = validDraft(); draft.outlets[0].price = '0'; draft.outlets[0].gofoodPrice = '';
    expect(bundlePayload(draft).outlets[0]).toMatchObject({ price: 0, gofoodPrice: null });
  });
  it('strips response-only relations, IDs and tenant fields from edit payload', () => {
    const record = { ...validDraft(), id: 'bundle', businessId: 'A', category: { id: 'cat', name: 'Food' },
      groups: [{ ...validDraft().groups[0], id: 'group', bundleId: 'bundle', items: [{ ...validDraft().groups[0].items[0], id: 'item', product: { name: 'Food' } }] }] };
    const payload = bundlePayload(editBundle(record));
    expect(bundleAdminInput.parse(payload)).toBeDefined();
    expect(payload).not.toHaveProperty('businessId'); expect(payload.groups[0]).not.toHaveProperty('id');
    expect(payload.groups[0].items[0]).not.toHaveProperty('product');
  });
  it('clones edit choices so cancel does not mutate the list', () => {
    const record = validDraft(); record.groups[0].items[0].fixedOptionIds = ['size'];
    const draft = editBundle(record); draft.groups[0].items[0].fixedOptionIds.push('sugar');
    expect(record.groups[0].items[0].fixedOptionIds).toEqual(['size']);
  });
  it('rejects impossible group choices, invalid quantities and incomplete products', () => {
    const draft = validDraft(); draft.groups[0].minSelect = 2;
    expect(() => bundlePayload(draft)).toThrow('min/max');
    draft.groups[0].minSelect = 1; draft.groups[0].items[0].qty = 0;
    expect(() => bundlePayload(draft)).toThrow('qty');
    draft.groups[0].items[0].qty = 1; draft.groups[0].items[0].productId = '';
    expect(() => bundlePayload(draft)).toThrow('produk');
  });
  it('rejects defaults exceeding max selection', () => {
    const draft = validDraft(); draft.groups[0].items[0].isDefault = true;
    draft.groups[0].items.push({ ...newBundleChoice(), productId: 'tea', isDefault: true });
    expect(() => bundlePayload(draft)).toThrow('default');
  });
  it('supports fixed combos with more components than choice max', () => {
    const draft = validDraft(); draft.groups[0].isFixed = true;
    draft.groups[0].items.push({ ...newBundleChoice(), productId: 'tea' });
    expect(bundleAdminInput.parse(bundlePayload(draft)).groups[0].items).toHaveLength(2);
  });
  it('rejects a reversed period and preserves UTC instant on an edit roundtrip', () => {
    const draft = validDraft(); draft.startDate = '2026-10-09T08:00'; draft.endDate = '2026-10-08T08:00';
    expect(() => bundlePayload(draft)).toThrow('Tanggal akhir');
    const instant = '2026-10-08T07:30:12.345Z';
    expect(new Date(localDateTime(instant)).toISOString()).toBe(instant);
  });
  it('rejects empty outlets, negative surcharge and nonfinite price', () => {
    const draft = validDraft(); draft.outlets = [];
    expect(() => bundlePayload(draft)).toThrow('outlet');
    draft.outlets = validDraft().outlets; draft.groups[0].items[0].additionalPrice = '-100';
    expect(() => bundlePayload(draft)).toThrow('tidak valid');
    draft.groups[0].items[0].additionalPrice = 0; draft.basePrice = 'Infinity';
    expect(() => bundlePayload(draft)).toThrow('tidak valid');
  });
});
