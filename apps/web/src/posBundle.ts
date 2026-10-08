export type PosBundleSelection = { itemId: string; variantId?: string; selectedVariantOptionIds: string[] };
export type PosBundleProduct = { id: string; name: string; basePrice: number; masterBasePrice: number;
  variants: { id: string; variantName: string; sellingPrice: number }[];
  variantGroups: { group: { id: string; name: string; minSelect: number; maxSelect: number; required: boolean;
    options: { id: string; name: string; additionalPrice: number }[] } }[] };
export type PosBundleItem = { id: string; productId: string; variantId: string | null; fixedOptionIds: string[];
  qty: number; additionalPrice: number; isActive: boolean; isAvailable: boolean; isDefault: boolean; product: PosBundleProduct | null };
export type PosBundleCatalog = { groups: { id: string; name: string; required: boolean; isFixed: boolean; minSelect: number; maxSelect: number; items: PosBundleItem[] }[] };
export type PosBundleSnapshot = { itemId: string; groupId: string; productId: string; productName: string; variantId: string | null;
  variantName: string; selectedVariants: { optionId: string }[]; qty: number; additionalPrice: number; variantAdditionalPrice: number };
export type PosBundleQuote = { bundleId: string; unitPrice: number; additionalPrice: number; selections: PosBundleSnapshot[] };

export function bundleSelectionsKey(bundleId: string, selections: PosBundleSelection[] = []) {
  return `bundle:${bundleId}:${JSON.stringify(selections.map(selection => ({ itemId: selection.itemId, variantId: selection.variantId || '',
    options: [...selection.selectedVariantOptionIds].sort() })).sort((a, b) => a.itemId.localeCompare(b.itemId)))}`;
}
export function selectionsFromSnapshot(snapshot: PosBundleSnapshot[]): PosBundleSelection[] {
  return snapshot.map(item => ({ itemId: item.itemId, variantId: item.variantId || undefined, selectedVariantOptionIds: (item.selectedVariants || []).map(option => option.optionId) }));
}
export function bundleSelectionError(bundle: PosBundleCatalog, selections: PosBundleSelection[]) {
  for (const group of bundle.groups) {
    const picks = group.isFixed ? group.items.filter(item => item.isActive) : group.items.filter(item => selections.some(selection => selection.itemId === item.id));
    const minimum = group.required ? Math.max(1, group.minSelect) : group.minSelect;
    if (!group.isFixed && (picks.length < minimum || picks.length > group.maxSelect)) return `${group.name}: pilih ${minimum}–${group.maxSelect} item.`;
    for (const item of picks) {
      if (!item.isAvailable || !item.product) return `${item.product?.name || 'Isi paket'} sedang tidak tersedia.`;
      const selection = selections.find(selection => selection.itemId === item.id);
      for (const attached of item.product.variantGroups) {
        const ids = item.fixedOptionIds.length ? item.fixedOptionIds : selection?.selectedVariantOptionIds || [];
        const count = attached.group.options.filter(option => ids.includes(option.id)).length;
        const minimum = attached.group.required ? Math.max(1, attached.group.minSelect) : attached.group.minSelect;
        if (count < minimum || count > attached.group.maxSelect) return `${item.product.name} / ${attached.group.name}: pilih ${minimum}–${attached.group.maxSelect} opsi.`;
      }
    }
  }
  if (!selections.length && !bundle.groups.some(group => group.isFixed)) return 'Pilih minimal satu isi paket.';
  return '';
}
export function bundleSelectionSurcharge(bundle: PosBundleCatalog, selections: PosBundleSelection[]) {
  let total = 0;
  for (const group of bundle.groups) for (const item of group.items) {
    const selection = selections.find(selection => selection.itemId === item.id);
    if (!selection && !group.isFixed || !item.isActive || !item.product) continue;
    const product = item.product;
    let upgrade = 0;
    if (product.variantGroups.length) {
      const ids = item.fixedOptionIds.length ? item.fixedOptionIds : selection?.selectedVariantOptionIds || [];
      upgrade = product.variantGroups.flatMap(row => row.group.options).filter(option => ids.includes(option.id)).reduce((sum, option) => sum + Number(option.additionalPrice), 0);
    } else {
      const variant = product.variants.find(variant => variant.id === (item.variantId || selection?.variantId)) || product.variants[0];
      if (variant) upgrade = Math.max(0, product.basePrice + (variant.sellingPrice - product.masterBasePrice)) - product.basePrice;
    }
    total += (Number(item.additionalPrice) + upgrade) * item.qty;
  }
  return Math.round(total * 100) / 100;
}
