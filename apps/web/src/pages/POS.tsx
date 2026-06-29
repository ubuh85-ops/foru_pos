import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, LayoutGrid, List, Minus, Plus, Power, Printer, Search, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import { api, rupiah } from '../api';
import { printWithBluetoothFallback } from '../printer';
import { subscribeMasterDataChanged } from '../masterEvents';
import foruLogo from '/images/foru.png';

type Option = { id: string; name: string; additionalPrice: number; hpp: number };
type Group = { id: string; name: string; minSelect: number; maxSelect: number; required: boolean; options: Option[] };
type Variant = { id: string; variantName: string; sellingPrice: number };
type Product = { id: string; name: string; category: string; categoryRef?: { name: string }; basePrice: number; baseHpp: number; imageUrl?: string; variants: Variant[]; variantGroups: { group: Group }[] };
type Line = { key: string; productId: string; variantId?: string; selectedVariantOptionIds?: string[]; name: string; variant: string; price: number; qty: number; itemNote?: string; discount?: { type: 'NOMINAL' | 'PERCENTAGE'; value: number } };

const calcDisc = (base: number, d?: Line['discount']) => !d ? 0 : Math.min(base, d.type === 'PERCENTAGE' ? base * d.value / 100 : d.value);
const catName = (p: Product) => p.categoryRef?.name || p.category;
const searchKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

export default function POS() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editOrderId = params.get('editOrderId');
  const [outlets, setOutlets] = useState<any[]>([]);
  const [outlet, setOutlet] = useState(localStorage.getItem('outletId') || '');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [config, setConfig] = useState<Product | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Semua');
  const [menuView, setMenuView] = useState<'grid' | 'list'>(() => localStorage.getItem('foru:pos_menu_view') === 'list' ? 'list' : 'grid');
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('foru:pos_page_size') || 20));
  const [page, setPage] = useState(1);
  const [expandedCart, setExpandedCart] = useState<Record<string, boolean>>({});
  const [coupon, setCoupon] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMsg, setCouponMsg] = useState('');
  const [trxDisc, setTrxDisc] = useState<Line['discount']>();
  const [customerName, setCustomerName] = useState('');
  const [orderType, setOrderType] = useState(localStorage.getItem('foru:pos_order_type') || 'DINE_IN');
  const [tableNumber, setTableNumber] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [error, setError] = useState('');

  async function loadProductsForOutlet(outletId = outlet) {
    if (!outletId) return;
    try {
      const next = await api<Product[]>(`/pos/products?outlet_id=${outletId}&_=${Date.now()}`);
      setProducts(next);
      setConfig(current => current ? next.find(p => p.id === current.id) || current : current);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function refreshActiveShift() {
    try {
      const active = await api<any>('/cash-sessions/active');
      setActiveShift(active);
      if (active?.status === 'OPEN' && active.outletId && active.outletId !== outlet) {
        localStorage.setItem('outletId', active.outletId);
        setOutlet(active.outletId);
      }
    } catch {
      setActiveShift(null);
    }
  }

  useEffect(() => { api<any[]>('/outlets').then(x => { setOutlets(x); if (!outlet && x[0]) setOutlet(x[0].id); }); }, []);
  useEffect(() => { refreshActiveShift(); }, []);
  useEffect(() => {
    const refreshWhenActive = () => { refreshActiveShift(); loadProductsForOutlet(); };
    const refreshWhenVisible = () => { if (!document.hidden) { refreshActiveShift(); loadProductsForOutlet(); } };
    window.addEventListener('focus', refreshWhenActive);
    window.addEventListener('pageshow', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenActive);
      window.removeEventListener('pageshow', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [outlet]);
  useEffect(() => { if (outlet) { localStorage.setItem('outletId', outlet); loadProductsForOutlet(outlet); refreshActiveShift(); setCouponDiscount(0); } }, [outlet]);
  useEffect(() => subscribeMasterDataChanged(() => { if (!outlet) return; loadProductsForOutlet(outlet); }), [outlet]);
  useEffect(() => { setPage(1); }, [q, cat, pageSize]);
  useEffect(() => {
    if (!outlet || editOrderId) return;
    const raw = localStorage.getItem(`foru:pos_cart:${outlet}`);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setCart(draft.cart || []);
      setCustomerName(draft.customerName || '');
      setOrderType(draft.orderType || 'DINE_IN');
      setTableNumber(draft.tableNumber || '');
      setOrderNote(draft.orderNote || '');
    } catch {}
  }, [outlet, editOrderId]);
  useEffect(() => {
    if (!outlet) return;
    localStorage.setItem('foru:pos_order_type', orderType);
    localStorage.setItem(`foru:pos_cart:${outlet}`, JSON.stringify({ cart, customerName, orderType, tableNumber, orderNote, updatedAt: new Date().toISOString() }));
  }, [outlet, cart, customerName, orderType, tableNumber, orderNote]);
  useEffect(() => {
    if (!editOrderId) return;
    api<any>(`/orders/${editOrderId}`).then(order => {
      if (order.status !== 'PENDING_PAYMENT') throw new Error('Order sudah tidak bisa diedit karena status berubah.');
      setEditingOrder(order);
      setOutlet(order.outletId);
      setCustomerName(order.customerName || '');
      setCoupon(order.couponCode || '');
      setCouponDiscount(Number(order.couponDiscountAmount || 0));
      setTrxDisc(Number(order.transactionDiscountAmount || 0) > 0 ? { type: 'NOMINAL', value: Number(order.transactionDiscountAmount) } : undefined);
      setCart((order.items || []).map((i: any) => {
        const selectedVariants = Array.isArray(i.selectedVariantsJson) ? i.selectedVariantsJson : [];
        return {
          key: `${i.productId}:${i.productVariantId || selectedVariants.map((x: any) => x.optionId).join('|')}:${i.id}`,
          productId: i.productId,
          variantId: i.productVariantId || undefined,
          selectedVariantOptionIds: selectedVariants.map((x: any) => x.optionId),
          name: i.productName,
          variant: i.variantName,
          price: Number(i.finalUnitPrice || i.sellingPrice),
          qty: i.qty,
          itemNote: i.itemNote || '',
          discount: i.discountType ? { type: i.discountType, value: Number(i.discountValue || 0) } : undefined
        } as Line;
      }));
    }).catch(e => setError((e as Error).message));
  }, [editOrderId]);
  useEffect(() => {
    if (!config && !payOpen && !receipt) return;
    history.pushState({ ...(history.state || {}), foruPosWindow: true }, '', location.href);
    const closeTopWindow = () => {
      if (receipt) setReceipt(null);
      else if (payOpen) setPayOpen(false);
      else if (config) setConfig(null);
      history.pushState({ ...(history.state || {}), foruBackGuard: true }, '', location.href);
    };
    window.addEventListener('popstate', closeTopWindow, { once: true });
    return () => window.removeEventListener('popstate', closeTopWindow);
  }, [config, payOpen, receipt]);

  const shiftOpen = !!activeShift && activeShift.status === 'OPEN' && activeShift.outletId === outlet;
  const cats = ['Semua', ...new Set(products.map(catName))];
  const filtered = products.filter(p => {
    const query = searchKey(q);
    return (cat === 'Semua' || catName(p) === cat) && (!query || searchKey(p.name).includes(query));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedProducts = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const summary = useMemo(() => {
    const subtotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
    const productDiscount = cart.reduce((s, x) => s + calcDisc(x.price * x.qty, x.discount), 0);
    const afterProduct = subtotal - productDiscount;
    const transactionDiscount = calcDisc(afterProduct, trxDisc);
    const grand = Math.max(0, afterProduct - transactionDiscount - couponDiscount);
    return { subtotal, productDiscount, transactionDiscount, grand };
  }, [cart, trxDisc, couponDiscount]);
  const itemPayload = (x: Line) => ({ productId: x.productId, variantId: x.variantId, selectedVariantOptionIds: x.selectedVariantOptionIds, qty: x.qty, itemNote: x.itemNote, discount: x.discount });

  function changeMenuView(view: 'grid' | 'list') { setMenuView(view); localStorage.setItem('foru:pos_menu_view', view); }
  function changePageSize(size: number) { setPageSize(size); setPage(1); localStorage.setItem('foru:pos_page_size', String(size)); }
  function addLine(line: Line) { if (!shiftOpen) return alert('Shift belum dibuka. Silakan buka kasir terlebih dahulu.'); setCart(c => { const i = c.findIndex(x => x.key === line.key && !x.discount && !x.itemNote); return i < 0 ? [...c, line] : c.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x); }); setCouponDiscount(0); }
  function quickAdd(p: Product) { if (!shiftOpen) return; if (p.variantGroups?.length) return setConfig(p); const v = p.variants[0]; const price = v && v.variantName !== 'Base' ? Number(v.sellingPrice) : Number(p.basePrice || v?.sellingPrice || 0); addLine({ key: v ? `${p.id}:${v.id}` : `${p.id}:base`, productId: p.id, variantId: v?.id, name: p.name, variant: v?.variantName || 'Base', price, qty: 1 }); }
  function qty(i: number, n: number) {
    setCart(c => {
      if (n < 1) {
        if (!confirm('Hapus item?')) return c;
        return c.filter((_, j) => j !== i);
      }
      return c.map((x, j) => j === i ? { ...x, qty: n } : x);
    });
    setCouponDiscount(0);
  }
  function note(i: number, itemNote: string) { setCart(c => c.map((x, j) => j === i ? { ...x, itemNote: itemNote.slice(0, 255) } : x)); }
  function editItemNote(i: number, current = '') { const value = prompt('Catatan item', current); if (value !== null) note(i, value); }
  function clearCart() { if (!cart.length) return; if (confirm('Kosongkan cart?')) resetCart(); }
  async function applyCoupon() { try { const r = await api<any>('/coupons/validate', { method: 'POST', body: JSON.stringify({ couponCode: coupon, outletId: outlet, items: cart.map(itemPayload) }) }); setCouponDiscount(r.discountAmount); setCouponMsg(`${r.coupon.name} diterapkan`); } catch (e) { setCouponDiscount(0); setCouponMsg((e as Error).message); } }
  const orderPayload = (active?: any) => ({ outletId: outlet, cashSessionId: active?.id, customerName, orderType, tableNumber, orderNote, items: cart.map(itemPayload), transactionDiscount: trxDisc, couponCode: couponDiscount ? coupon : undefined });
  function resetCart() { setCart([]); setCoupon(''); setCouponDiscount(0); setTrxDisc(undefined); setCustomerName(''); setTableNumber(''); setOrderNote(''); }
  async function saveOrder() { try { const active = await api<any>('/cash-sessions/active'); if (editingOrder) { const result = await api(`/orders/${editingOrder.id}`, { method: 'PUT', body: JSON.stringify(orderPayload(active)) }); navigate(`/orders/${(result as any).id}`); return; } const result = await api('/orders', { method: 'POST', body: JSON.stringify(orderPayload(active)) }); setReceipt(result); resetCart(); } catch (e) { alert((e as Error).message); } }

  return <div className="grid min-h-[calc(100vh-4rem)] min-w-0 max-w-full overflow-x-hidden bg-[#f7f4ec] lg:h-[calc(100vh-4rem)] lg:overflow-hidden lg:grid-cols-[minmax(0,6fr)_minmax(480px,4fr)] 2xl:grid-cols-[minmax(0,1fr)_540px]">
    <section className="flex min-h-0 min-w-0 flex-col p-3 sm:p-4 lg:overflow-hidden lg:p-4 2xl:p-5">
      <div className="mb-3 rounded-[2rem] bg-white/95 p-3 shadow-sm ring-1 ring-black/5 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">

          <select className="input h-12 rounded-2xl xl:w-56" value={outlet} onChange={e => setOutlet(e.target.value)}>
            {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="flex shrink-0 rounded-2xl bg-slate-100 p-1">
            <button aria-label="Tampilan grid" onClick={() => changeMenuView('grid')} className={`grid h-10 w-10 place-items-center rounded-xl ${menuView === 'grid' ? 'bg-ink text-white shadow-sm' : 'text-slate-500'}`}><LayoutGrid size={18} /></button>
            <button aria-label="Tampilan list" onClick={() => changeMenuView('list')} className={`grid h-10 w-10 place-items-center rounded-xl ${menuView === 'list' ? 'bg-ink text-white shadow-sm' : 'text-slate-500'}`}><List size={19} /></button>
          </div>
                    <div className="relative min-w-0 flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input className="input h-12 rounded-2xl pl-12 text-base" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nama produk..." />
          </div>
        </div>
        {!shiftOpen && <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <div><b>Shift belum dibuka.</b><p>Silakan buka kasir terlebih dahulu untuk mulai transaksi.</p></div>
          <button onClick={() => navigate('/shift')} className="btn-primary min-h-10 shrink-0 px-4 text-sm"><Power size={16} /> Buka Kasir</button>
        </div>}
        {editingOrder && <div className="mt-3 rounded-2xl bg-brand-50 p-3 text-sm text-brand-800"><b>Editing Order:</b> {editingOrder.orderNumber}</div>}
      </div>

      <div className="mb-3 flex min-w-0 gap-2 overflow-x-auto rounded-2xl bg-white/40 p-1">
        {cats.map(c => <button key={c} onClick={() => setCat(c)} className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-extrabold transition ${cat === c ? 'bg-ink text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-brand-50 hover:text-brand-700'}`}>{c}</button>)}
      </div>

      {error && <p className="mb-3 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="min-h-0 rounded-[1.75rem] pr-1 lg:flex-1 lg:overflow-y-auto">
        {menuView === 'grid' ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5">
          {pagedProducts.map(p => {
            const price = Number(p.basePrice || p.variants[0]?.sellingPrice || 0);
            const outOfStock = Number((p as any).stock || (p as any).stockQty || 1) <= 0;
            return <button key={p.id} onClick={() => quickAdd(p)} disabled={!shiftOpen || outOfStock} className="group relative overflow-hidden rounded-3xl bg-white text-left shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60">
              <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-gradient-to-br from-brand-50 via-amber-50 to-white text-4xl">
              {p.imageUrl ? (
  <img
    src={p.imageUrl}
    alt={p.name}
    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
  />
) : (
  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
    <img
      src="/images/foru.png"
      alt="FORU"
      className="h-16 w-16 object-contain opacity-60 transition duration-300 group-hover:scale-110"
    />
  </div>
)}
              </div>
              <div className="p-3">
                <p className="truncate text-[11px] font-bold text-slate-400">{catName(p)}</p>
                <h3 className="line-clamp-2 min-h-[2.35rem] text-sm font-extrabold leading-tight text-ink">{p.name}</h3>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="truncate text-[11px] font-bold text-slate-500">{p.variantGroups?.length ? 'Pilih opsi' : p.variants[0]?.variantName || 'Base'}</span>
                  <b className="money shrink-0 text-sm text-brand-700">{rupiah(price)}</b>
                </div>
              </div>
            </button>;
          })}
        </div> : <div className="grid gap-2 xl:grid-cols-2">
          {pagedProducts.map(p => {
            const price = Number(p.basePrice || p.variants[0]?.sellingPrice || 0);
            return <button key={p.id} onClick={() => quickAdd(p)} disabled={!shiftOpen} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-black/5 disabled:opacity-60">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 to-amber-50 text-2xl">{p.imageUrl ? <img src={p.imageUrl || foruLogo} alt={p.name} className="h-full w-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.src = foruLogo;}} /> : ''}</div>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-brand-600">{catName(p)}</p><h3 className="truncate font-extrabold">{p.name}</h3><p className="truncate text-xs text-slate-400">{p.variantGroups?.length ? 'Pilih opsi' : p.variants[0]?.variantName || 'Base'}</p></div>
              <b className="money shrink-0 text-brand-700">{rupiah(price)}</b>
            </button>;
          })}
        </div>}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[1.75rem] bg-white p-3 text-sm shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Page</span>
          <select className="rounded-xl border px-3 py-2" value={pageSize} onChange={e => changePageSize(Number(e.target.value))}>{[10].map(n => <option key={n} value={n}>{n} produk</option>)}</select>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-xl border px-4 py-2 font-bold disabled:opacity-40">Prev</button>
          <b>{currentPage} / {totalPages}</b>
          <button disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="rounded-xl border px-4 py-2 font-bold disabled:opacity-40">Next</button>
        </div>
      </div>
    </section>

    <aside className="flex min-w-0 flex-col border-t bg-slate-50 shadow-[-8px_0_24px_rgba(15,23,42,0.06)] lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:gap-3 lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-t-0 lg:bg-[#f8faf6] lg:p-3">
      <div className="shrink-0 bg-white p-4 shadow-sm ring-1 ring-black/5 lg:rounded-[1.75rem] lg:border lg:border-slate-100 lg:p-4 lg:shadow-sm lg:ring-0">
        {editingOrder && <div className="mb-3 rounded-2xl bg-brand-50 p-3 text-sm text-brand-800"><b>Editing Order:</b> {editingOrder.orderNumber}</div>}
        <div className="mb-4 hidden items-center justify-between lg:flex">
          <div>
            <h2 className="text-lg font-black text-ink">Order Cart</h2>
            <p className="text-xs font-semibold text-slate-400">{cart.length} macam item · {cart.reduce((s, x) => s + x.qty, 0)} total qty</p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700"><ShoppingBag size={22} /></div>
        </div>
        <div className="space-y-4 lg:space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(150px,190px)] gap-3">
            <div className="min-w-0">
              <label className="label text-slate-600">Customer</label>
              <input className="input h-12 w-full rounded-2xl lg:h-11" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Walk In" />
            </div>
            <div className="min-w-0">
              <label className="label text-slate-600">Order Type</label>
              <select className="input h-12 w-full rounded-2xl lg:h-11" value={orderType} onChange={e => setOrderType(e.target.value)}>
                <option value="DINE_IN">Dine In</option>
                <option value="TAKE_AWAY">Take Away</option>
                <option value="DELIVERY">Delivery</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label text-slate-600">Catatan Order</label>
            <input className="input h-12 w-full rounded-2xl lg:h-11" value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="Catatan untuk order (opsional)" />
          </div>
          <div className="-mx-4 border-t border-slate-100" />
          <button onClick={() => { const type = (prompt('Tipe: NOMINAL atau PERCENTAGE', 'NOMINAL') || '').toUpperCase() as any; const value = Number(prompt('Nilai diskon item untuk item terakhir', '0')); if (cart.length && ['NOMINAL', 'PERCENTAGE'].includes(type) && value >= 0) setCart(c => c.map((a, j) => j === c.length - 1 ? { ...a, discount: { type, value }, key: a.key + `:disc:${type}:${value}` } : a)); }} disabled={!cart.length} className="flex w-full items-center justify-between rounded-2xl px-1 py-1 text-left text-sm font-black text-brand-700 disabled:opacity-40"><span>+ Diskon item</span><span>⌄</span></button>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
            <input className="input h-12 rounded-2xl uppercase lg:h-11" value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())} placeholder="GUNAKAN KUPON" />
            <button onClick={applyCoupon} disabled={!cart.length || !coupon} className="btn-soft rounded-2xl px-4"><Tag size={20} /></button>
          </div>
          {couponMsg && <p className={`text-xs ${couponDiscount ? 'text-brand-600' : 'text-red-600'}`}>{couponDiscount ? <Check className="mr-1 inline" size={14} /> : null}{couponMsg}</p>}
          <button onClick={() => { const type = (prompt('Diskon transaksi: NOMINAL atau PERCENTAGE', 'PERCENTAGE') || '').toUpperCase() as any; const value = Number(prompt('Nilai diskon transaksi', '0')); if (['NOMINAL', 'PERCENTAGE'].includes(type) && value >= 0) setTrxDisc({ type, value }); }} className="rounded-2xl bg-brand-50 px-4 py-3 text-sm font-extrabold text-brand-700 lg:py-2.5">+ Diskon transaksi</button>
        </div>
      </div>

      <div className="min-h-[220px] flex-none bg-slate-50/70 p-3 lg:min-h-[180px] lg:max-h-[32vh] lg:overflow-y-auto lg:overscroll-contain lg:bg-transparent lg:p-0">
        <div className="flex min-h-full flex-col rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5 lg:min-h-0 lg:rounded-[1.75rem] lg:border lg:border-slate-100 lg:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3"><ShoppingBag className="shrink-0 text-slate-600" size={22} /><h2 className="truncate text-lg font-black text-ink">Pesanan ({cart.reduce((s, x) => s + x.qty, 0)})</h2></div>
            <button onClick={clearCart} disabled={!cart.length} className="flex shrink-0 items-center gap-1 rounded-xl px-2 py-1 text-sm font-semibold text-red-600 disabled:opacity-40"><Trash2 size={16} />Kosongkan</button>
          </div>
          {!cart.length ? <div className="grid min-h-64 flex-1 place-items-center rounded-3xl border-2 border-dashed bg-slate-50/70 text-center text-slate-400 lg:min-h-0">
            <div><ShoppingBag className="mx-auto mb-3" /><p>Pilih produk untuk<br />memulai transaksi</p></div>
          </div> : <div className="space-y-3">{cart.map((x, i) => {
            const lineBase = x.price * x.qty;
            const discount = calcDisc(lineBase, x.discount);
            const total = lineBase - discount;
            return <div key={x.key} className="min-w-0 rounded-2xl border bg-white p-2.5 shadow-sm">
              <div className="grid grid-cols-[4.25rem_minmax(0,1fr)_96px] items-start gap-3">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-slate-50">
                  <span className="absolute left-0 top-0 z-10 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-black text-white">{i + 1}</span>
                  <img src="/images/foru.png" alt="" className="h-full w-full object-contain p-2 opacity-70" />
                </div>
                <div className="min-w-0">
                  <h3 className="line-clamp-2 text-sm font-black text-ink">{x.name}</h3>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-500">{x.variant || 'Base'}</p>
                  {x.itemNote && <button onClick={() => editItemNote(i, x.itemNote || '')} className="mt-2 max-w-full truncate rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{x.itemNote}</button>}
                </div>
                <b className="money shrink-0 text-right text-sm font-black text-ink">{rupiah(total)}</b>
              </div>
              <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-2">
                <div className="flex items-center overflow-hidden rounded-2xl border bg-white">
                  <button onClick={() => qty(i, x.qty - 1)} className="grid h-10 w-10 place-items-center text-ink hover:bg-brand-50"><Minus size={15} /></button>
                  <b className="grid h-10 min-w-10 place-items-center border-x px-3 text-sm">{x.qty}</b>
                  <button onClick={() => qty(i, x.qty + 1)} className="grid h-10 w-10 place-items-center text-ink hover:bg-brand-50"><Plus size={15} /></button>
                </div>
                <div className="flex min-w-0 items-center justify-end gap-2">
                  <button onClick={() => editItemNote(i, x.itemNote || '')} className="min-w-0 truncate rounded-2xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-brand-50 hover:text-brand-700">Catatan</button>
                  <button onClick={() => qty(i, 0)} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border text-slate-600 hover:bg-red-50 hover:text-red-600"><Trash2 size={17} /></button>
                </div>
              </div>
              {x.discount && <p className="mt-2 text-xs font-extrabold text-brand-600">Diskon item: {x.discount.type === 'PERCENTAGE' ? x.discount.value + '%' : rupiah(x.discount.value)}</p>}
            </div>;
          })}</div>}
        </div>
      </div>

      <div className="shrink-0 border-t bg-white p-4 pb-[max(6rem,env(safe-area-inset-bottom))] lg:rounded-[1.75rem] lg:border lg:border-slate-100 lg:p-4 lg:shadow-sm">
        <div className="space-y-1.5 text-sm"><Row label={`Subtotal (${cart.reduce((s, x) => s + x.qty, 0)} item)`} n={summary.subtotal} /><Row label="Diskon Item" n={-summary.productDiscount} /><Row label="Diskon Transaksi" n={-summary.transactionDiscount} /><Row label="Diskon Kupon" n={-couponDiscount} /><Row label="PPN (0%)" n={0} /></div>
        <div className="mt-3 flex items-end justify-between border-t pt-3"><b className="text-2xl text-ink lg:text-xl">Total</b><strong className="money text-3xl text-brand-700 lg:text-2xl">{rupiah(summary.grand)}</strong></div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:mt-3">
          <button disabled={!cart.length || !shiftOpen} onClick={saveOrder} className="h-14 rounded-2xl border border-brand-600 bg-white px-3 text-sm font-black text-brand-700 disabled:opacity-40 lg:h-12">{editingOrder ? 'Update Order' : 'Simpan Draft'}</button>
          <button disabled={!cart.length || !shiftOpen} onClick={() => setPayOpen(true)} className="btn-primary h-14 rounded-2xl text-lg font-black lg:h-12 lg:text-base">Bayar</button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button disabled={!cart.length || !shiftOpen} onClick={saveOrder} className="rounded-2xl border px-2 py-3 text-xs font-extrabold text-slate-600 disabled:opacity-40">Hold Order</button>
          <button disabled={!cart.length} onClick={clearCart} className="rounded-2xl border px-2 py-3 text-xs font-extrabold text-red-600 disabled:opacity-40">Clear Cart</button>
        </div>
        {editingOrder && <button onClick={() => navigate(`/orders/${editingOrder.id}`)} className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm font-extrabold text-slate-500">Cancel Edit</button>}
      </div>
    </aside>
    {config && <ConfigProduct product={config} close={() => setConfig(null)} add={addLine} />}
    {payOpen && <Payment total={summary.grand} initialCustomerName={customerName} onClose={() => setPayOpen(false)} onPay={async (method, cash, paidCustomerName) => { try { const active = await api<any>('/cash-sessions/active'); setCustomerName(paidCustomerName); const payload = { ...orderPayload(active), customerName: paidCustomerName }; const result = editingOrder ? await api(`/orders/${editingOrder.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod: method, cashReceived: cash, cashSessionId: active?.id, order: payload }) }) : await api('/sales', { method: 'POST', body: JSON.stringify({ ...payload, paymentMethod: method, cashReceived: cash }) }); setReceipt(result); resetCart(); setPayOpen(false); if (editingOrder) setEditingOrder(null); } catch (e) { alert((e as Error).message); } }} />}
    {receipt && <Receipt sale={receipt} close={() => setReceipt(null)} />}
  </div>;
}

function ConfigProduct({ product, close, add }: { product: Product; close: () => void; add: (l: Line) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const groups = product.variantGroups.map(x => x.group).filter(Boolean);
  function toggle(g: Group, o: Option) { setSel(s => { const inGroup = new Set(g.options.map(x => x.id)), without = s.filter(id => !inGroup.has(id)); if (s.includes(o.id)) return s.filter(id => id !== o.id); return g.maxSelect === 1 ? [...without, o.id] : [...s, o.id]; }); }
  const selectedOptions = groups.flatMap(g => g.options.filter(o => sel.includes(o.id)));
  const total = Number(product.basePrice) + selectedOptions.reduce((s, o) => s + Number(o.additionalPrice), 0);
  const errors = groups.flatMap(g => { const n = g.options.filter(o => sel.includes(o.id)).length, min = g.required ? Math.max(g.minSelect, 1) : g.minSelect; return n < min ? [`${g.name}: Minimal pilih ${min} opsi.`] : n > g.maxSelect ? [`${g.name}: Maksimal pilih ${g.maxSelect} opsi.`] : []; });
  return <div className="fixed inset-0 z-[60] grid place-items-end bg-black/40 sm:place-items-center"><div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl"><div className="mb-5 flex justify-between"><div><h3 className="section-title">{product.name}</h3><p className="text-sm text-slate-400">{rupiah(product.basePrice)}</p></div><button onClick={close}><X /></button></div><div className="space-y-5">{groups.map(g => <section key={g.id}><div className="mb-2 flex justify-between"><b>{g.name}</b><span className="text-xs text-slate-400">{g.required ? 'Wajib ' : ''}min {g.required ? Math.max(g.minSelect, 1) : g.minSelect} · max {g.maxSelect}</span></div><div className="space-y-2">{g.options.map(o => <label key={o.id} className={`flex items-center justify-between rounded-xl border p-3 text-sm ${sel.includes(o.id) ? 'border-brand-500 bg-brand-50' : ''}`}><span className="flex items-center gap-2"><input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={g.id} checked={sel.includes(o.id)} onChange={() => toggle(g, o)} />{o.name}</span><b>{Number(o.additionalPrice) ? `+${rupiah(o.additionalPrice)}` : 'Gratis'}</b></label>)}</div></section>)}</div>{errors.length > 0 && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{errors[0]}</p>}<div className="mt-5 flex items-center justify-between border-t pt-4"><span>Total item</span><b className="text-2xl text-brand-700">{rupiah(total)}</b></div><button disabled={!!errors.length} onClick={() => { const ids = [...sel].sort(); add({ key: `${product.id}:${ids.join('|')}`, productId: product.id, selectedVariantOptionIds: ids, name: product.name, variant: selectedOptions.map(o => o.name).join(', ') || 'Base', price: total, qty: 1 }); close(); }} className="btn-primary mt-5 w-full">Add To Cart</button></div></div>;
}

function Row({ label, n }: { label: string; n: number }) { return <div className="flex justify-between text-slate-500"><span>{label}</span><span className="money">{rupiah(n)}</span></div>; }
function Payment({ total, initialCustomerName = '', onClose, onPay }: { total: number; initialCustomerName?: string; onClose: () => void; onPay: (m: string, c: number | undefined, customerName: string) => void }) {
  const [m, setM] = useState('CASH');
  const [cash, setCash] = useState(0);
  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [note, setNote] = useState('');
  const methods = ['CASH', 'QRIS', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD', 'VOUCHER'];
  const quickAmounts = [10000, 20000, 50000, 100000];
  const nonCash = m !== 'CASH';
  const paidAmount = nonCash ? total : cash;
  const change = Math.max(0, paidAmount - total);
  return <div className="fixed inset-0 z-[60] grid place-items-end bg-black/40 sm:place-items-center">
    <div className="max-h-[94vh] w-full max-w-xl overflow-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-xl"><span className="text-slate-500">Metode </span><b>Pembayaran</b></h3><button onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"><X /></button></div>
      <div className="mb-4 grid grid-cols-2 gap-2">{methods.map(value => <button key={value} onClick={() => setM(value)} className={`rounded-xl border p-3 text-sm font-black ${m === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'bg-white'}`}>{value}</button>)}</div>
      <button className="mb-3 w-full rounded-xl bg-pink-50 px-4 py-4 font-medium text-pink-600">Edit Tanggal</button>
      <div className="mb-4 grid grid-cols-[1fr_5rem] gap-2"><input className="input" value="" readOnly placeholder="Gunakan Kupon" /><button className="rounded-xl border border-pink-400 text-2xl text-pink-500">⌄</button></div>
      <div className="mb-4 rounded-xl bg-slate-100 p-3">
        <div className="bg-white p-4 text-sm">
          <div className="flex justify-between py-1"><span>Total Belanja</span><b>{rupiah(total)}</b></div>
          <div className="flex justify-between py-1"><span>Potongan Promo</span><b>{rupiah(0)}</b></div>
          <div className="flex justify-between py-1"><span>Pajak</span><b>{rupiah(0)}</b></div>
          <div className="my-2 border-t" />
          <div className="flex justify-between py-1"><span>Potongan Member</span><b>{rupiah(0)}</b></div>
          <div className="flex justify-between py-1"><span>Potongan Kupon</span><b>{rupiah(0)}</b></div>
          <div className="my-2 border-t" />
          <div className="flex justify-between text-lg font-black"><span>Total Bayar</span><span>{rupiah(total)}</span></div>
          <div className="flex justify-between text-lg font-black"><span>Jumlah Uang</span><span>{rupiah(paidAmount)}</span></div>
          <div className="my-2 border-t" />
          <div className="flex justify-between"><span>Kembalian</span><b>{rupiah(change)}</b></div>
        </div>
      </div>
      <label className="label">Customer Name</label>
      <input className="input mb-3" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Masukkan nama pelanggan" />
      {m === 'CASH' && <>
        <label className="label">Jumlah Uang <span className="text-red-500">*</span></label>
        <input className="input mb-3" type="number" value={cash || ''} onChange={e => setCash(Number(e.target.value))} placeholder="Masukkan Uang" />
        <div className="mb-4 grid grid-cols-5 gap-2">{quickAmounts.map(n => <button key={n} onClick={() => setCash(n)} className="rounded-lg border px-2 py-3 text-sm">{n / 1000}rb</button>)}<button onClick={() => setCash(total)} className="rounded-lg border px-2 py-3 text-sm">Uang Pas</button></div>
      </>}
      <label className="label">Catatan</label>
      <textarea className="input min-h-20" value={note} onChange={e => setNote(e.target.value)} placeholder="Catatan pembayaran (opsional)" />
      <button disabled={m === 'CASH' && cash < total} onClick={() => onPay(m, m === 'CASH' ? cash : undefined, customerName)} className="btn-primary mt-5 w-full">Selesaikan Transaksi</button>
    </div>
  </div>;
}
function Receipt({ sale, close }: { sale: any; close: () => void }) {
  const paid = sale.status === 'PAID';
  const [customerPrint, setCustomerPrint] = useState(true);
  const [kitchenPrint, setKitchenPrint] = useState(true);
  async function print(type: 'customer-receipt' | 'kitchen-ticket' | 'customer-item-list') {
    if (type === 'customer-item-list') await api(`/orders/${sale.id}/print/customer-item-list`, { method: 'POST' });
    else await api(`/print/${type}/${sale.id}`, { method: 'POST' });
    await printWithBluetoothFallback(sale, type, type === 'customer-receipt' ? `/receipt/${sale.id}` : type === 'kitchen-ticket' ? `/kitchen-ticket/${sale.id}` : `/customer-item-list/${sale.id}`);
  }
  async function printSelected() {
    try {
      if (!customerPrint && !kitchenPrint) return alert('Pilih minimal satu struk untuk dicetak');
      if (customerPrint) await print(paid ? 'customer-receipt' : 'customer-item-list');
      if (kitchenPrint) await print('kitchen-ticket');
    } catch (e) {
      alert((e as Error).message);
    }
  }
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/80 p-4">
    <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center">
      <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-brand-100 text-brand-700"><Check size={30} /></div>
      <h2 className="text-2xl font-black">{paid ? 'Transaksi berhasil!' : 'Order tersimpan!'}</h2>
      <p className="mt-2 text-sm text-slate-400">{paid ? sale.transactionNumber : sale.orderNumber}</p>
      <p className="mt-1 text-sm font-bold">{sale.customerName || 'Walk In'}</p>
      <div className="my-5 rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-400">{paid ? 'Total' : 'Total sementara'}</p><b className="text-2xl text-brand-700">{rupiah(sale.grandTotal)}</b></div>
      <div className="mb-4 rounded-2xl bg-brand-50/70 p-4 text-left">
        <p className="mb-3 text-sm font-black">Pilih Struk yang akan dicetak</p>
        <label className="flex items-center gap-3 py-2 text-sm font-medium"><input className="h-5 w-5 accent-brand-600" type="checkbox" checked={customerPrint} onChange={e => setCustomerPrint(e.target.checked)} />{paid ? 'Print Final Receipt (Struk Pelanggan)' : 'Print Customer Item List'}</label>
        <div className="my-1 border-t border-brand-100" />
        <label className="flex items-center gap-3 py-2 text-sm font-medium"><input className="h-5 w-5 accent-brand-600" type="checkbox" checked={kitchenPrint} onChange={e => setKitchenPrint(e.target.checked)} />Print Kitchen Ticket (Struk Dapur)</label>
      </div>
      <button onClick={printSelected} className="btn-soft mb-2 w-full justify-center border-brand-600 text-brand-700">Cetak Sekarang <Printer size={18} /></button>
      <button onClick={close} className="btn-primary w-full">Transaksi Baru</button>
    </div>
  </div>;
}
