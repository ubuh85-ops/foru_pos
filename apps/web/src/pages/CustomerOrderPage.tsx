import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Minus, Plus, Search, ShoppingBag, X } from 'lucide-react';
import { API, rupiah } from '../api';

type PublicOption = { id: string; name: string; additionalPrice: number };
type PublicGroup = { group: { id: string; name: string; minSelect: number; maxSelect: number; required: boolean; options: PublicOption[] } };
type PublicAddon = { id: string; addonName: string; price: number };
type PublicProduct = {
  id: string;
  name: string;
  sku?: string | null;
  category?: string;
  categoryRef?: { id: string; name: string } | null;
  description?: string | null;
  imageUrl?: string | null;
  basePrice: number;
  variants?: { id: string; variantName: string; sellingPrice: number }[];
  addons?: PublicAddon[];
  variantGroups?: PublicGroup[];
};
type CartLine = { key: string; product: PublicProduct; qty: number; optionIds: string[]; addonIds: string[]; note: string };

const API_ORIGIN = API.replace(/\/api\/?$/, '');
const imageSrc = (url?: string | null) => !url ? '/images/foru.png' : url.startsWith('/storage/') ? `${API_ORIGIN}${url}` : url;
const publicFetch = async <T,>(path: string, init?: RequestInit) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Permintaan gagal');
  return data as T;
};
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function CustomerOrderPage() {
  const { businessSlug = '', outletSlug = '' } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<any>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKE_AWAY'>('DINE_IN');
  const [tableNumber, setTableNumber] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Semua');
  const productPagerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    Promise.all([
      publicFetch<any>(`/public/order/${businessSlug}/${outletSlug}`),
      publicFetch<PublicProduct[]>(`/public/order/${businessSlug}/${outletSlug}/products`)
    ]).then(([info, rows]) => {
      setMeta(info);
      setProducts(rows);
      if (!info.outlet?.allowDineIn && info.outlet?.allowTakeAway) setOrderType('TAKE_AWAY');
      setError('');
    }).catch(e => setError((e as Error).message));
  }, [businessSlug, outletSlug]);

  const total = useMemo(() => cart.reduce((sum, line) => {
    const options = line.product.variantGroups?.flatMap(v => v.group.options).filter(o => line.optionIds.includes(o.id)) || [];
    const addons = line.product.addons?.filter(a => line.addonIds.includes(a.id)) || [];
    const unit = Number(line.product.basePrice || 0) + options.reduce((n, o) => n + Number(o.additionalPrice || 0), 0) + addons.reduce((n, a) => n + Number(a.price || 0), 0);
    return sum + unit * line.qty;
  }, 0), [cart]);
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(product => {
      return !q || [product.name, product.sku, product.categoryRef?.name, product.category, product.description].some(value => String(value || '').toLowerCase().includes(q));
    });
  }, [products, search]);
  const groupedProducts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; products: PublicProduct[] }>();
    for (const product of filteredProducts) {
      const id = product.categoryRef?.id || product.category || 'uncategorized';
      const name = product.categoryRef?.name || product.category || 'Menu';
      if (!map.has(id)) map.set(id, { id, name, products: [] });
      map.get(id)!.products.push(product);
    }
    return Array.from(map.values());
  }, [filteredProducts]);
  const searchActive = search.trim().length > 0;
  const categoryPages = useMemo(() => [
    { id: 'all', name: 'Semua', groups: groupedProducts },
    ...groupedProducts.map(group => ({ id: group.id, name: group.name, groups: [group] }))
  ], [groupedProducts]);
  const categoryNav = useMemo(() => categoryPages.map(page => page.name), [categoryPages]);

  useEffect(() => {
    if (!groupedProducts.length) {
      setActiveCategory('Semua');
      return;
    }
    if (activeCategory !== 'Semua' && !groupedProducts.some(group => group.name === activeCategory)) {
      setActiveCategory('Semua');
    }
  }, [groupedProducts, activeCategory]);

  useEffect(() => {
    chipRefs.current[activeCategory]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeCategory]);

  function scrollToCategory(name: string) {
    setActiveCategory(name);
    if (searchActive) {
      if (name === 'Semua') {
        productPagerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const group = groupedProducts.find(item => item.name === name);
      if (group) sectionRefs.current[group.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const index = categoryPages.findIndex(page => page.name === name);
    const pager = productPagerRef.current;
    if (pager && index >= 0) pager.scrollTo({ left: index * pager.clientWidth, behavior: 'smooth' });
  }
  function syncCategoryFromSwipe() {
    if (searchActive) return;
    const pager = productPagerRef.current;
    if (!pager?.clientWidth) return;
    const index = Math.max(0, Math.min(categoryPages.length - 1, Math.round(pager.scrollLeft / pager.clientWidth)));
    const next = categoryPages[index]?.name || 'Semua';
    if (next !== activeCategory) setActiveCategory(next);
  }

  function openProduct(product: PublicProduct) {
    setSelected(product);
    setOptionIds([]);
    setAddonIds([]);
    setQty(1);
    setNote('');
  }
  function toggleOption(group: PublicGroup['group'], id: string) {
    setOptionIds(current => {
      const inGroup = new Set(group.options.map(o => o.id));
      const exists = current.includes(id);
      if (exists) return current.filter(x => x !== id);
      if (group.maxSelect <= 1) return [...current.filter(x => !inGroup.has(x)), id];
      const count = current.filter(x => inGroup.has(x)).length;
      if (count >= group.maxSelect) return current;
      return [...current, id];
    });
  }
  function addSelected() {
    if (!selected) return;
    for (const vg of selected.variantGroups || []) {
      const chosen = optionIds.filter(id => vg.group.options.some(o => o.id === id)).length;
      if (vg.group.required && chosen < vg.group.minSelect) {
        setError(`Pilih opsi ${vg.group.name}`);
        return;
      }
    }
    setCart(rows => [...rows, { key: uid(), product: selected, qty, optionIds, addonIds, note }]);
    setSelected(null);
  }
  async function submit() {
    if (submitting) return;
    if (!customerName.trim()) return setError('Nama customer wajib diisi.');
    if (meta?.outlet?.requestPhone && !customerPhone.trim()) return setError('Nomor WhatsApp wajib diisi.');
    if (!cart.length) return setError('Keranjang masih kosong.');
    setSubmitting(true);
    try {
      const result = await publicFetch<any>(`/public/order/${businessSlug}/${outletSlug}/orders`, {
        method: 'POST',
        body: JSON.stringify({
          customerName,
          customerPhone,
          orderType,
          tableNumber,
          customerOrderRequestId: uid(),
          items: cart.map(line => ({
            productId: line.product.id,
            selectedVariantOptionIds: line.optionIds,
            addonIds: line.addonIds,
            qty: line.qty,
            itemNote: line.note
          }))
        })
      });
      navigate(`/order/status/${result.publicOrderToken}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="min-h-screen bg-slate-50 px-4 py-5 text-ink">
    <div className="mx-auto max-w-5xl">
      <header className="mb-4 rounded-3xl bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-brand-700">{meta?.business?.name || 'FORU POS'}</p>
        <h1 className="text-2xl font-black">{meta?.outlet?.name || 'Order'}</h1>
        <p className="text-sm text-slate-500">Pesan dulu, bayar di kasir.</p>
      </header>
      {error && <div className="mb-4 rounded-2xl bg-red-50 p-3 font-semibold text-red-700">{error}</div>}
      <section className="sticky top-0 z-20 mb-4 rounded-3xl bg-white/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              className="input h-12 pl-12"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari menu..."
              type="search"
            />
          </div>
          <div className="shrink-0 rounded-2xl bg-brand-50 px-4 py-3 text-sm font-black text-brand-700">
            {filteredProducts.length} menu
          </div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {categoryNav.map(item => <button
            key={item}
            ref={node => { chipRefs.current[item] = node; }}
            type="button"
            onClick={() => scrollToCategory(item)}
            className={`shrink-0 rounded-2xl px-4 py-2 text-sm font-black shadow-sm ${activeCategory === item ? 'bg-brand-700 text-white' : 'bg-slate-50 text-slate-600'}`}
          >
            {item}
          </button>)}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section
          ref={productPagerRef}
          onScroll={syncCategoryFromSwipe}
          className={searchActive ? 'scroll-mt-36 space-y-6' : 'scroll-mt-36 flex snap-x snap-mandatory overflow-x-auto scroll-smooth overscroll-x-contain'}
        >
          {searchActive ? groupedProducts.map(group => <CategorySection key={group.id} group={group} setRef={node => { sectionRefs.current[group.id] = node; }} openProduct={openProduct} />)
            : categoryPages.map(page => <div key={page.id} className="min-w-full snap-start pr-1">
              <div className="space-y-6">
                {page.groups.map(group => <CategorySection key={group.id} group={group} openProduct={openProduct} />)}
              </div>
            </div>)}
          {!groupedProducts.length && <div className="rounded-3xl bg-white p-8 text-center font-semibold text-slate-400 shadow-sm ring-1 ring-slate-200">Menu tidak ditemukan.</div>}
        </section>
        <aside className="rounded-3xl bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:self-start">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black"><ShoppingBag /> Pesanan ({cart.reduce((n, x) => n + x.qty, 0)})</h2>
          <div className="space-y-2">
            {cart.map((line, i) => <div key={line.key} className="rounded-2xl border p-3">
              <div className="flex items-start justify-between gap-3">
                <div><b>{line.product.name}</b><p className="text-sm text-slate-500">{line.qty}x</p></div>
                <button onClick={() => setCart(rows => rows.filter((_, j) => j !== i))} className="text-red-600"><X size={18}/></button>
              </div>
            </div>)}
          </div>
          <div className="my-4 border-t pt-3">
            <div className="flex justify-between text-lg font-black"><span>Total</span><span className="text-brand-700">{rupiah(total)}</span></div>
          </div>
          <div className="space-y-3">
            <input className="input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nama customer *" />
            <input className="input" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder={meta?.outlet?.requestPhone ? 'WhatsApp *' : 'WhatsApp (opsional)'} />
            <div className="grid grid-cols-2 gap-2">
              {meta?.outlet?.allowDineIn !== false && <button onClick={() => setOrderType('DINE_IN')} className={`rounded-xl border p-3 font-bold ${orderType === 'DINE_IN' ? 'bg-brand-500 text-white' : 'bg-white'}`}>Dine In</button>}
              {meta?.outlet?.allowTakeAway !== false && <button onClick={() => setOrderType('TAKE_AWAY')} className={`rounded-xl border p-3 font-bold ${orderType === 'TAKE_AWAY' ? 'bg-brand-500 text-white' : 'bg-white'}`}>Take Away</button>}
            </div>
            <input className="input" value={tableNumber} onChange={e => setTableNumber(e.target.value)} placeholder="Nomor meja (opsional)" />
            <button disabled={submitting || !cart.length} onClick={submit} className="btn btn-primary w-full disabled:opacity-50">{submitting ? 'Mengirim...' : 'Kirim Pesanan'}</button>
          </div>
        </aside>
      </div>
    </div>
    {selected && <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 md:place-items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">{selected.name}</h2><p className="text-brand-700">{rupiah(selected.basePrice)}</p></div><button onClick={() => setSelected(null)}><X /></button></div>
        {(selected.variantGroups || []).map(vg => <div key={vg.group.id} className="mb-4">
          <p className="mb-2 font-black">{vg.group.name}{vg.group.required && <span className="text-red-600"> *</span>}</p>
          <div className="grid gap-2">{vg.group.options.map(option => <button key={option.id} onClick={() => toggleOption(vg.group, option.id)} className={`flex items-center justify-between rounded-2xl border p-3 text-left ${optionIds.includes(option.id) ? 'border-brand-500 bg-brand-50' : ''}`}><span>{option.name}</span><span>{option.additionalPrice ? rupiah(option.additionalPrice) : <Check size={16}/>}</span></button>)}</div>
        </div>)}
        {!!selected.addons?.length && <div className="mb-4"><p className="mb-2 font-black">Add-on</p><div className="grid gap-2">{selected.addons.map(addon => <button key={addon.id} onClick={() => setAddonIds(ids => ids.includes(addon.id) ? ids.filter(x => x !== addon.id) : [...ids, addon.id])} className={`flex items-center justify-between rounded-2xl border p-3 text-left ${addonIds.includes(addon.id) ? 'border-brand-500 bg-brand-50' : ''}`}><span>{addon.addonName}</span><span>{rupiah(addon.price)}</span></button>)}</div></div>}
        <textarea className="input min-h-20" value={note} onChange={e => setNote(e.target.value)} placeholder="Catatan item (opsional)" />
        <div className="mt-3 flex items-center gap-3">
          <div className="flex overflow-hidden rounded-2xl border"><button onClick={() => setQty(n => Math.max(1, n - 1))} className="grid h-12 w-12 place-items-center"><Minus /></button><b className="grid h-12 w-12 place-items-center border-x">{qty}</b><button onClick={() => setQty(n => n + 1)} className="grid h-12 w-12 place-items-center"><Plus /></button></div>
          <button onClick={addSelected} className="btn btn-primary flex-1">Tambah</button>
        </div>
      </div>
    </div>}
  </div>;
}

function CategorySection({
  group,
  openProduct,
  setRef
}: {
  group: { id: string; name: string; products: PublicProduct[] };
  openProduct: (product: PublicProduct) => void;
  setRef?: (node: HTMLElement | null) => void;
}) {
  return <section id={`category-${group.id}`} ref={setRef} className="scroll-mt-36">
    <div className="mb-3 flex items-center gap-3">
      <h2 className="shrink-0 text-lg font-black text-slate-900">{group.name}</h2>
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-bold text-slate-400">{group.products.length} menu</span>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {group.products.map(product => <button
        key={product.id}
        onClick={() => openProduct(product)}
        className="overflow-hidden rounded-3xl bg-white text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="aspect-square bg-slate-50">
          <img src={imageSrc(product.imageUrl)} className="h-full w-full object-cover" />
        </div>
        <div className="space-y-2 p-3">
          <p className="line-clamp-1 text-xs font-black text-slate-400">{product.categoryRef?.name || product.category || 'Menu'}</p>
          <h3 className="line-clamp-2 min-h-[40px] font-black leading-tight">{product.name}</h3>
          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-black text-brand-700">
            Base&nbsp;&nbsp; {rupiah(product.basePrice)}
          </div>
        </div>
      </button>)}
    </div>
  </section>;
}
