import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api, rupiah } from '../api';
import { bundleSelectionError, bundleSelectionsKey, type PosBundleCatalog, type PosBundleItem, type PosBundleQuote, type PosBundleSelection } from '../posBundle';

export default function PosBundleSelector({ product, outletId, channel, close, add }: { product: { id: string; name: string; basePrice: number; bundle: PosBundleCatalog }; outletId: string; channel: string;
  close: () => void; add: (quote: PosBundleQuote, selections: PosBundleSelection[], note: string) => void }) {
  const [selections, setSelections] = useState<PosBundleSelection[]>(() => product.bundle.groups.flatMap(group => {
    const defaults = group.isFixed ? group.items.filter(item => item.isActive) : group.items.filter(item => item.isDefault && item.isAvailable).slice(0, group.maxSelect);
    return defaults.map(item => ({ itemId: item.id, variantId: item.variantId || (!item.product?.variantGroups.length ? item.product?.variants[0]?.id : undefined),
      selectedVariantOptionIds: [...item.fixedOptionIds] }));
  }));
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<PosBundleQuote | null>(null);
  const [pricedKey,setPricedKey]=useState('');
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const validation = bundleSelectionError(product.bundle, selections);
  const fingerprint = useMemo(() => bundleSelectionsKey(product.id, selections), [product.id, selections]);
  useEffect(() => {
    let active = true; setQuote(null); setServerError('');
    if (validation) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => { api<PosBundleQuote>(`/bundles/${encodeURIComponent(product.id)}/preview`, { method: 'POST', body: JSON.stringify({ outletId, channel, surface: 'POS', qty: 1, selections }) })
      .then(quote => { if (active) {setQuote(quote);setPricedKey(fingerprint);} }).catch(error => { if (active) setServerError((error as Error).message); }).finally(() => { if (active) setLoading(false); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [fingerprint, product, outletId, channel, validation]);
  function select(item: PosBundleItem, groupId: string) {
    const group = product.bundle.groups.find(group => group.id === groupId)!;
    setSelections(current => {
      if (current.some(selection => selection.itemId === item.id)) return current.filter(selection => selection.itemId !== item.id);
      const outside = group.maxSelect === 1 ? current.filter(selection => !group.items.some(item => item.id === selection.itemId)) : current;
      return [...outside, { itemId: item.id, variantId: item.variantId || (!item.product?.variantGroups.length ? item.product?.variants[0]?.id : undefined), selectedVariantOptionIds: [...item.fixedOptionIds] }];
    });
  }
  function patch(itemId: string, patch: Partial<PosBundleSelection>) { setSelections(current => current.map(selection => selection.itemId === itemId ? { ...selection, ...patch } : selection)); }
  return <div data-back-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-3"><div role="dialog" aria-modal="true" aria-labelledby="bundle-select-title" className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white shadow-xl">
    <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white p-5"><div><h2 id="bundle-select-title" className="text-2xl font-black">{product.name}</h2><p className="text-brand-700">Mulai {rupiah(product.basePrice)}</p></div><button aria-label="Tutup pilihan paket" data-back-close="true" onClick={close}><X/></button></div>
    <div className="space-y-5 p-5">{product.bundle.groups.map(group => <section key={group.id}><h3 className="font-black">{group.name}{group.required && !group.isFixed ? ' *' : ''}</h3><p className="mb-2 text-xs text-slate-500">{group.isFixed ? 'Semua item otomatis masuk paket' : `Pilih ${group.required ? Math.max(1, group.minSelect) : group.minSelect}–${group.maxSelect} item`}</p>
      <div className="space-y-2">{group.items.filter(item => item.isActive).map(item => {
        const selected = selections.find(selection => selection.itemId === item.id);
        return <div key={item.id} className={`rounded-2xl border p-3 ${selected ? 'border-brand-500 bg-brand-50' : ''}`}><label className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><input type={group.maxSelect === 1 && !group.isFixed ? 'radio' : 'checkbox'} name={`bundle-group-${group.id}`} checked={!!selected} disabled={group.isFixed || !item.isAvailable || !selected && selections.filter(selection => group.items.some(item => item.id === selection.itemId)).length >= group.maxSelect && group.maxSelect !== 1} onChange={() => select(item, group.id)}/><span>{item.qty}x {item.product?.name || 'Produk tidak tersedia'}</span></span><b className="text-sm">{item.isAvailable ? Number(item.additionalPrice) ? `+${rupiah(Number(item.additionalPrice) * item.qty)}` : 'Termasuk' : 'Habis'}</b></label>
          {selected && item.product && <div className="mt-2 space-y-2 pl-6">{item.variantId ? <p className="text-sm text-slate-500">{item.product.variants.find(variant => variant.id === item.variantId)?.variantName}</p> : !item.product.variantGroups.length && !!item.product.variants.length && <label className="block text-sm">Variant<select className="input" value={selected.variantId || ''} onChange={event => patch(item.id, { variantId: event.target.value || undefined })}>{item.product.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.variantName}</option>)}</select></label>}
            {item.product.variantGroups.map(({ group: variantGroup }) => <div key={variantGroup.id}><p className="text-sm font-bold">{variantGroup.name}</p><div className="flex flex-wrap gap-3">{variantGroup.options.map(option => <label className="text-sm" key={option.id}><input type={variantGroup.maxSelect === 1 ? 'radio' : 'checkbox'} name={`${item.id}:${variantGroup.id}`} checked={selected.selectedVariantOptionIds.includes(option.id)} disabled={!!item.fixedOptionIds.length} onChange={() => {
              const old = selected.selectedVariantOptionIds;
              const next = old.includes(option.id) ? old.filter(id => id !== option.id) : [...(variantGroup.maxSelect === 1 ? old.filter(id => !variantGroup.options.some(option => option.id === id)) : old), option.id];
              patch(item.id, { selectedVariantOptionIds: next });
            }}/>{option.name}{Number(option.additionalPrice) ? ` +${rupiah(option.additionalPrice)}` : ''}</label>)}</div></div>)}
          </div>}
        </div>;
      })}</div></section>)}<label className="block"><span className="label">Catatan paket</span><textarea className="input" maxLength={255} value={note} onChange={event => setNote(event.target.value)}/></label></div>
<div className="sticky bottom-0 border-t bg-white p-5">{(validation || serverError) && <p role="alert" className="mb-3 text-sm text-red-700">{validation || serverError}</p>}<div className="mb-3 flex justify-between font-black"><span>Total paket</span><span className="text-brand-700">{quote ? rupiah(quote.unitPrice) : '—'}</span></div><button className="btn-primary w-full" disabled={!quote || pricedKey!==fingerprint || !!validation || loading} onClick={() => { if (quote && pricedKey===fingerprint) { add(quote, selections, note); close(); } }}>{loading ? 'Memeriksa harga & stok...' : 'Tambah ke Pesanan'}</button></div>
  </div></div>;
}
