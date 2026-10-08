export type BundleCategory = { id: string; name: string; status: string };
export type BundleProduct = { id: string; name: string; sku?: string | null; status: string;
  variants: { id: string; variantName: string; status: string }[];
  variantGroups: { group: { id: string; name: string; status: string; required: boolean; minSelect: number; maxSelect: number;
    options: { id: string; name: string; status: string }[] } }[] };
export type BundleOutlet = { outletId: string; isActive: boolean; price: string | number | null; gofoodPrice: string | number | null;
  grabfoodPrice: string | number | null; shopeefoodPrice: string | number | null };
export type BundleChoice = { productId: string; variantId: string | null; fixedOptionIds: string[]; qty: number;
  additionalPrice: string | number; isDefault: boolean; isActive: boolean };
export type BundleGroup = { name: string; required: boolean; isFixed: boolean; minSelect: number; maxSelect: number; items: BundleChoice[] };
export type BundleRecord = { id: string; name: string; description: string | null; imageUrl: string | null; categoryId: string;
  category: BundleCategory; basePrice: string | number; status: 'ACTIVE' | 'INACTIVE'; availablePOS: boolean; availableWebOrder: boolean;
  startDate: string | null; endDate: string | null; sortOrder: number; outlets: BundleOutlet[]; groups: BundleGroup[] };
export type BundleDraft = Omit<BundleRecord, 'id' | 'category'> & { id?: string };

export const newBundleChoice = (): BundleChoice => ({ productId: '', variantId: null, fixedOptionIds: [], qty: 1, additionalPrice: 0, isDefault: false, isActive: true });
export const newBundleGroup = (): BundleGroup => ({ name: '', required: true, isFixed: false, minSelect: 1, maxSelect: 1, items: [newBundleChoice()] });
export const newBundle = (outletId = ''): BundleDraft => ({ name: '', description: '', imageUrl: '', categoryId: '', basePrice: '', status: 'INACTIVE',
  availablePOS: true, availableWebOrder: true, startDate: '', endDate: '', sortOrder: 0,
  outlets: outletId ? [{ outletId, isActive: true, price: null, gofoodPrice: null, grabfoodPrice: null, shopeefoodPrice: null }] : [], groups: [newBundleGroup()] });

export function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
export function editBundle(row: BundleRecord): BundleDraft {
  return { ...row, startDate: localDateTime(row.startDate), endDate: localDateTime(row.endDate),
    outlets: row.outlets.map(outlet => ({ ...outlet })),
    groups: row.groups.map(group => ({ ...group, items: group.items.map(item => ({ ...item, fixedOptionIds: [...item.fixedOptionIds] })) })) };
}
function amount(value: string | number | null, label: string, optional = false): number | null {
  if (value === null || value === '') {
    if (optional) return null;
    throw new Error(`${label} wajib diisi.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 999999999999.99) throw new Error(`${label} tidak valid.`);
  return number;
}
export function bundlePayload(draft: BundleDraft) {
  if (!draft.name.trim() || !draft.categoryId) throw new Error('Nama paket dan kategori wajib diisi.');
  if (!draft.outlets.length) throw new Error('Pilih minimal satu outlet.');
  if (!draft.groups.length || draft.groups.length > 20) throw new Error('Paket wajib mempunyai 1–20 grup.');
  const groups = draft.groups.map(group => {
    if (!group.name.trim() || !group.items.length) throw new Error('Nama grup dan isi grup wajib diisi.');
    const active = group.items.filter(item => item.isActive);
    const minimum = group.required ? Math.max(1, group.minSelect) : group.minSelect;
    if (!Number.isInteger(group.minSelect) || !Number.isInteger(group.maxSelect) || group.minSelect < 0 || group.maxSelect > 50 ||
      group.maxSelect < 1 || group.minSelect > group.maxSelect || (!group.isFixed && (minimum > group.maxSelect || minimum > active.length))) throw new Error(`${group.name}: min/max pilihan tidak valid atau item aktif tidak cukup.`);
    if (group.isFixed && !active.length) throw new Error(`${group.name}: isi paket tetap tidak boleh kosong.`);
    if (!group.isFixed && active.filter(item => item.isDefault).length > group.maxSelect) throw new Error(`${group.name}: default melebihi maksimum.`);
    return { name: group.name.trim(), required: group.required, isFixed: group.isFixed, minSelect: group.minSelect, maxSelect: group.maxSelect,
      items: group.items.map(item => {
        if (!item.productId || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 50) throw new Error(`${group.name}: produk/qty tidak valid.`);
        return { productId: item.productId, variantId: item.variantId || null, fixedOptionIds: [...item.fixedOptionIds], qty: item.qty,
          additionalPrice: amount(item.additionalPrice, 'Biaya tambahan')!, isDefault: item.isDefault, isActive: item.isActive };
      }) };
  });
  if (groups.reduce((sum, group) => sum + group.items.length, 0) > 100) throw new Error('Maksimal 100 pilihan per paket.');
  const startDate = draft.startDate ? new Date(draft.startDate).toISOString() : null;
  const endDate = draft.endDate ? new Date(draft.endDate).toISOString() : null;
  if (startDate && endDate && startDate > endDate) throw new Error('Tanggal akhir harus setelah tanggal mulai.');
  return { name: draft.name.trim(), description: draft.description?.trim() || null, imageUrl: draft.imageUrl || null,
    categoryId: draft.categoryId, basePrice: amount(draft.basePrice, 'Harga dasar')!, status: draft.status,
    availablePOS: draft.availablePOS, availableWebOrder: draft.availableWebOrder, startDate, endDate, sortOrder: draft.sortOrder,
    outlets: draft.outlets.map(outlet => ({ outletId: outlet.outletId, isActive: outlet.isActive,
      price: amount(outlet.price, 'Harga outlet', true), gofoodPrice: amount(outlet.gofoodPrice, 'Harga GoFood', true),
      grabfoodPrice: amount(outlet.grabfoodPrice, 'Harga GrabFood', true), shopeefoodPrice: amount(outlet.shopeefoodPrice, 'Harga ShopeeFood', true) })), groups };
}
