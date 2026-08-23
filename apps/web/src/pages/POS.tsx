import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, ClipboardList, LayoutGrid, List, Minus, Plus, Power, Printer, Search, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import { API, api, rupiah } from '../api';
import { printWithBluetoothFallback } from '../printer';
import { subscribeMasterDataChanged } from '../masterEvents';
import { toast } from '../toast';
import foruLogo from '/images/foru.png';
import { useOutlet } from '../OutletContext';
import { ConfirmDialog, DiscountDialog, TextInputDialog, type DiscountKind, type ForuDialogTone } from '../components/ForuDialog';

type Option = { id: string; name: string; additionalPrice: number; hpp: number };
type Group = { id: string; name: string; minSelect: number; maxSelect: number; required: boolean; options: Option[] };
type Variant = { id: string; variantName: string; sellingPrice: number };
type Product = { id: string; name: string; category: string; categoryRef?: { name: string }; basePrice: number; baseHpp: number; imageUrl?: string; variants: Variant[]; variantGroups: { group: Group }[] };
type Line = { key: string; productId: string; variantId?: string; selectedVariantOptionIds?: string[]; name: string; variant: string; price: number; qty: number; itemNote?: string; discount?: { type: 'NOMINAL' | 'PERCENTAGE'; value: number } };
type CartQtySnapshot = Record<string, number>;
type PosDialog =
  | { kind: 'confirm'; tone?: ForuDialogTone; title: string; description?: string; detail?: string; cancelText?: string; confirmText?: string; resolve: (value: boolean) => void }
  | { kind: 'text'; title: string; description?: string; label: string; defaultValue?: string; placeholder?: string; resolve: (value: string | null) => void }
  | { kind: 'discount'; title: string; description?: string; initialType?: DiscountKind; initialValue?: number; resolve: (value: { type: DiscountKind; value: number } | null) => void };

const calcDisc = (base: number, d?: Line['discount']) => !d ? 0 : Math.min(base, d.type === 'PERCENTAGE' ? base * d.value / 100 : d.value);
const catName = (p: Product) => p.categoryRef?.name || p.category;
const searchKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const API_ORIGIN = API.replace(/\/api\/?$/, '');
const productImageSrc = (url?: string | null) => !url ? foruLogo : url.startsWith('/storage/') ? `${API_ORIGIN}${url}` : url;
const orderChannels = ['DINE_IN', 'TAKE_AWAY', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'];
const normalizeOrderType = (value: string | null | undefined) => orderChannels.includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : 'DINE_IN';
const normalizedLineKey = (x: Pick<Line, 'productId' | 'variantId' | 'selectedVariantOptionIds'>) => `${x.productId}:${x.variantId || 'base'}:${[...(x.selectedVariantOptionIds || [])].sort().join('|')}`;
const cartQtySnapshot = (lines: Line[]) => lines.reduce<CartQtySnapshot>((acc, line) => {
  const key = normalizedLineKey(line);
  acc[key] = (acc[key] || 0) + line.qty;
  return acc;
}, {});

export default function POS() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editOrderId = params.get('editOrderId');
  const { selectedOutletId: outlet, selectedOutlet, setSelectedOutletId } = useOutlet();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [config, setConfig] = useState<Product | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Semua');
  const [menuView, setMenuView] = useState<'grid' | 'list'>(() => localStorage.getItem('foru:pos_menu_view') === 'list' ? 'list' : 'grid');
  const [cartCollapsed, setCartCollapsed] = useState(() => localStorage.getItem('foru:pos_cart_collapsed') === '1');
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('foru:pos_page_size') || 20));
  const [page, setPage] = useState(1);
  const [expandedCart, setExpandedCart] = useState<Record<string, boolean>>({});
  const [coupon, setCoupon] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMsg, setCouponMsg] = useState('');
  const [trxDisc, setTrxDisc] = useState<Line['discount']>();
  const [customerName, setCustomerName] = useState('');
  const [orderType, setOrderType] = useState(normalizeOrderType(localStorage.getItem('foru:pos_order_type')));
  const [tableNumber, setTableNumber] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const [editingOrderSnapshot, setEditingOrderSnapshot] = useState<CartQtySnapshot>({});
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [error, setError] = useState('');
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [openOrdersOpen, setOpenOrdersOpen] = useState(false);
  const [reviewOpenOrder, setReviewOpenOrder] = useState<any>(null);
  const [dialog, setDialog] = useState<PosDialog | null>(null);

  function askConfirm(options: Omit<Extract<PosDialog, { kind: 'confirm' }>, 'kind' | 'resolve'>) {
    return new Promise<boolean>(resolve => setDialog({ kind: 'confirm', ...options, resolve }));
  }

  function askText(options: Omit<Extract<PosDialog, { kind: 'text' }>, 'kind' | 'resolve'>) {
    return new Promise<string | null>(resolve => setDialog({ kind: 'text', ...options, resolve }));
  }

  function askDiscount(options: Omit<Extract<PosDialog, { kind: 'discount' }>, 'kind' | 'resolve'>) {
    return new Promise<{ type: DiscountKind; value: number } | null>(resolve => setDialog({ kind: 'discount', ...options, resolve }));
  }

  function changeCartCollapsed(next: boolean) {
    setCartCollapsed(next);
    localStorage.setItem('foru:pos_cart_collapsed', next ? '1' : '0');
  }

  async function loadProductsForOutlet(outletId = outlet) {
    if (!outletId) return;
    try {
      const next = await api<Product[]>(`/pos/products?outlet_id=${outletId}&channel=${encodeURIComponent(orderType)}&_=${Date.now()}`);
      setProducts(next);
      setConfig(current => current ? next.find(p => p.id === current.id) || current : current);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function refreshActiveShift() {
    if (!outlet) {
      setActiveShift(null);
      return null;
    }
    try {
      const active = await api<any>(`/outlets/${outlet}/active-shift`).catch(async () => {
        const legacy = await api<any>(`/cash-sessions/active?outletId=${outlet}`);
        return legacy?.outletId === outlet ? legacy : null;
      });
      setActiveShift(active);
      return active;
    } catch {
      setActiveShift(null);
      return null;
    }
  }
  async function loadOpenOrders() {
    if (!outlet) {
      setOpenOrders([]);
      return;
    }
    try {
      const rows = await api<any[]>(`/orders/open?outletId=${outlet}&_=${Date.now()}`);
      setOpenOrders(rows);
    } catch {
      setOpenOrders([]);
    }
  }

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
  }, [outlet, orderType]);
  useEffect(() => { if (outlet) { loadProductsForOutlet(outlet); refreshActiveShift(); setCouponDiscount(0); } }, [outlet, orderType]);
  useEffect(() => {
    loadOpenOrders();
    const timer = window.setInterval(loadOpenOrders, 15000);
    return () => window.clearInterval(timer);
  }, [outlet]);
  useEffect(() => subscribeMasterDataChanged(() => { if (!outlet) return; loadProductsForOutlet(outlet); }), [outlet, orderType]);
  useEffect(() => { setPage(1); }, [q, cat, pageSize]);
  useEffect(() => {
    if (!outlet || editOrderId) return;
    const raw = localStorage.getItem(`foru:pos_cart:${outlet}`);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setCart(draft.cart || []);
      setCustomerName(draft.customerName || '');
      setOrderType(normalizeOrderType(draft.orderType));
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
      if (order.status !== 'PENDING_PAYMENT' && order.status !== 'OPEN_ORDER') throw new Error('Order sudah tidak bisa diedit karena status berubah.');
      setEditingOrder(order);
      setSelectedOutletId(order.outletId);
      setCustomerName(order.customerName || '');
      setTableNumber(order.tableNumber || '');
      setOrderNote(order.orderNote || '');
      setOrderType(normalizeOrderType(order.orderType));
      setCoupon(order.couponCode || '');
      setCouponDiscount(Number(order.couponDiscountAmount || 0));
      setTrxDisc(Number(order.transactionDiscountAmount || 0) > 0 ? { type: 'NOMINAL', value: Number(order.transactionDiscountAmount) } : undefined);
      const nextCart = (order.items || []).map((i: any) => {
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
      });
      setCart(nextCart);
      setEditingOrderSnapshot(cartQtySnapshot(nextCart));
    }).catch(e => setError((e as Error).message));
  }, [editOrderId, setSelectedOutletId]);
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

  async function printOrderDoc(doc: any, type: 'customer-receipt' | 'kitchen-ticket' | 'customer-item-list') {
    if (!doc?.id) return;
    await printWithBluetoothFallback(doc, type, type === 'customer-receipt' ? `/receipt/${doc.id}` : type === 'kitchen-ticket' ? `/kitchen-ticket/${doc.id}` : `/customer-item-list/${doc.id}`);
    if (type === 'customer-item-list') await api(`/orders/${doc.id}/print/customer-item-list`, { method: 'POST' }).catch(() => {});
    else if (type === 'kitchen-ticket') {
      const path = doc.status === 'PAID' ? `/print/kitchen-ticket/${doc.id}` : `/orders/${doc.id}/print/kitchen-ticket`;
      await api(path, { method: 'POST' }).catch(() => {});
    } else {
      await api(`/print/customer-receipt/${doc.id}`, { method: 'POST' }).catch(() => {});
    }
  }

  async function runAutoPrint(doc: any, event: 'pending-order' | 'paid-sale') {
    const jobs: Array<['customer-receipt' | 'kitchen-ticket' | 'customer-item-list', string]> = [];
    if (event === 'paid-sale' && selectedOutlet?.autoPrintReceipt) jobs.push(['customer-receipt', 'Receipt']);
    if (selectedOutlet?.autoPrintKitchen) jobs.push(['kitchen-ticket', 'Kitchen ticket']);
    if (event === 'pending-order' && selectedOutlet?.autoPrintCustomerItemList) jobs.push(['customer-item-list', 'Customer item list']);
    if (!jobs.length) return;
    for (const [type, label] of jobs) {
      try {
        await printOrderDoc(doc, type);
      } catch (e) {
        toast.error(`${label} gagal dicetak: ${(e as Error).message}`);
      }
    }
  }

  function additionalOrderDoc(order: any) {
    const items = cart.flatMap(line => {
      const addedQty = line.qty - (editingOrderSnapshot[normalizedLineKey(line)] || 0);
      if (addedQty <= 0) return [];
      return [{
        productId: line.productId,
        productName: line.name,
        variantName: line.variant,
        selectedVariantsJson: (line.selectedVariantOptionIds || []).map(optionId => ({ optionId })),
        itemNote: line.itemNote,
        qty: addedQty,
        sellingPrice: line.price,
        finalUnitPrice: line.price,
        subtotalAfterDiscount: line.price * addedQty
      }];
    });
    return items.length ? { ...order, items, grandTotal: items.reduce((sum: number, item: any) => sum + Number(item.subtotalAfterDiscount || 0), 0), printTitle: 'Tambahan Open Bill' } : null;
  }

  function changeMenuView(view: 'grid' | 'list') { setMenuView(view); localStorage.setItem('foru:pos_menu_view', view); }
  function changePageSize(size: number) { setPageSize(size); setPage(1); localStorage.setItem('foru:pos_page_size', String(size)); }
  function addLine(line: Line) { if (!shiftOpen) { toast.error('Shift belum dibuka. Silakan buka kasir terlebih dahulu.'); return; } setCart(c => { const i = c.findIndex(x => x.key === line.key && !x.discount && !x.itemNote); return i < 0 ? [...c, line] : c.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x); }); setCouponDiscount(0); }
  function quickAdd(p: Product) { if (!shiftOpen) return; if (p.variantGroups?.length) return setConfig(p); const v = p.variants[0]; const price = v && v.variantName !== 'Base' ? Number(v.sellingPrice) : Number(p.basePrice || v?.sellingPrice || 0); addLine({ key: v ? `${p.id}:${v.id}` : `${p.id}:base`, productId: p.id, variantId: v?.id, name: p.name, variant: v?.variantName || 'Base', price, qty: 1 }); }
  async function qty(i: number, n: number) {
    if (n < 1) {
      const item = cart[i];
      const ok = await askConfirm({
        tone: 'danger',
        title: 'Hapus Item',
        description: 'Yakin ingin menghapus item ini dari pesanan?',
        detail: item ? `Item: ${item.name} - ${item.variant || 'Base'}` : undefined,
        confirmText: 'Hapus'
      });
      if (!ok) return;
      setCart(c => c.filter((_, j) => j !== i));
      setCouponDiscount(0);
      return;
    }
    setCart(c => c.map((x, j) => j === i ? { ...x, qty: n } : x));
    setCouponDiscount(0);
  }
  function note(i: number, itemNote: string) { setCart(c => c.map((x, j) => j === i ? { ...x, itemNote: itemNote.slice(0, 255) } : x)); }
  async function editItemNote(i: number, current = '') {
    const value = await askText({
      title: 'Catatan Item',
      description: 'Tambahkan instruksi khusus untuk item ini.',
      label: 'Catatan',
      defaultValue: current,
      placeholder: 'Contoh: tanpa bawang, sedikit gula, pedas'
    });
    if (value !== null) note(i, value);
  }
  async function clearCart() {
    if (!cart.length) return;
    const ok = await askConfirm({
      tone: 'warning',
      title: 'Batal Transaksi',
      description: 'Yakin ingin mengosongkan semua pesanan?',
      detail: 'Data yang sudah diinput tidak dapat dikembalikan.',
      cancelText: 'Tidak',
      confirmText: 'Ya, Batalkan'
    });
    if (ok) resetCart();
  }
  async function applyItemDiscount() {
    if (!cart.length) return;
    const discount = await askDiscount({
      title: 'Diskon Item',
      description: 'Diskon akan diterapkan ke item terakhir di pesanan',
      initialType: 'NOMINAL',
      initialValue: 0
    });
    if (!discount) return;
    setCart(c => c.map((a, j) => j === c.length - 1 ? { ...a, discount, key: a.key + `:disc:${discount.type}:${discount.value}` } : a));
    setCouponDiscount(0);
  }
  async function applyTransactionDiscount() {
    const discount = await askDiscount({
      title: 'Diskon Transaksi',
      description: 'Pilih jenis diskon dan isi nilainya',
      initialType: trxDisc?.type || 'PERCENTAGE',
      initialValue: trxDisc?.value || 0
    });
    if (discount) setTrxDisc(discount);
  }
  async function applyCoupon() { try { const r = await api<any>('/coupons/validate', { method: 'POST', body: JSON.stringify({ couponCode: coupon, outletId: outlet, orderType, items: cart.map(itemPayload) }) }); setCouponDiscount(r.discountAmount); setCouponMsg(`${r.coupon.name} diterapkan`); } catch (e) { setCouponDiscount(0); setCouponMsg((e as Error).message); } }
  const orderPayload = (active?: any) => ({ outletId: outlet, cashSessionId: active?.id, customerName, orderType, tableNumber, orderNote, items: cart.map(itemPayload), transactionDiscount: trxDisc, couponCode: couponDiscount ? coupon : undefined });
  async function rejectOpenOrder(order: any) {
    const reason = await askText({
      title: 'Tolak Open Order',
      description: 'Masukkan alasan penolakan untuk pelanggan/order ini.',
      label: 'Alasan',
      placeholder: 'Contoh: produk tidak tersedia'
    });
    if (!reason?.trim()) return;
    try {
      await api(`/orders/${order.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      toast.success('Open order berhasil ditolak.');
      setReviewOpenOrder(null);
      await loadOpenOrders();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  function resetCart() { setCart([]); setCoupon(''); setCouponDiscount(0); setTrxDisc(undefined); setCustomerName(''); setTableNumber(''); setOrderNote(''); }
  async function saveOrder() {
    if (orderSubmitting) return;
    if (!customerName.trim() || customerName.trim().toLowerCase() === 'walk in') {
      const msg = 'Nama customer wajib diisi untuk Open Bill.';
      setError(msg);
      toast.error(msg);
      return;
    }
    setOrderSubmitting(true);
    try {
      const active = await refreshActiveShift();
      if (editingOrder) {
        const additionalDoc = additionalOrderDoc(editingOrder);
        const result = await api(`/orders/${editingOrder.id}`, { method: 'PUT', body: JSON.stringify(orderPayload(active)) });
        toast.success('Data berhasil disimpan.');
        setEditingOrder(result);
        setEditingOrderSnapshot(cartQtySnapshot(cart));
        if (additionalDoc) {
          const printable = { ...(result as any), items: additionalDoc.items, grandTotal: additionalDoc.grandTotal, printTitle: additionalDoc.printTitle };
          setReceipt(printable);
          await runAutoPrint(printable, 'pending-order');
        } else {
          navigate(`/orders/${(result as any).id}`);
        }
        return;
      }
      const result = await api('/orders', { method: 'POST', body: JSON.stringify(orderPayload(active)) });
      setReceipt(result);
      resetCart();
      toast.success('Data berhasil disimpan.');
      await runAutoPrint(result, 'pending-order');
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setOrderSubmitting(false);
    }
  }

  return <div className={`grid min-h-[calc(100vh-4rem)] min-w-0 max-w-full overflow-x-hidden bg-[#f7f4ec] md:h-[calc(100vh-4rem)]  
  md:overflow-hidden 
${cartCollapsed ? 'md:grid-cols-[minmax(0,1fr)_76px]' : 'md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_380px]'}
  `}>
    <section className="flex min-h-0 min-w-0 flex-col p-3 sm:p-4 md:overflow-hidden md:p-4 2xl:p-5">
      <div className="mb-3 rounded-[2rem] bg-white/95 p-2.5 shadow-sm ring-1 ring-black/5 sm:p-3">
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="hidden h-10 w-7 shrink-0 place-items-center rounded-xl text-2xl font-bold text-slate-500 sm:grid">‹</span>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5">
              {cats.map(c => <button key={c} onClick={() => setCat(c)} className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-extrabold transition ${cat === c ? 'bg-ink text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-100 hover:bg-brand-50 hover:text-brand-700'}`}>{c}</button>)}
            </div>
            <span className="hidden h-10 w-7 shrink-0 place-items-center rounded-xl text-2xl font-bold text-slate-500 sm:grid">›</span>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2 md:w-[min(43%,30rem)]">
            <div className="flex shrink-0 rounded-2xl bg-slate-100 p-1">
              <button aria-label="Tampilan grid" onClick={() => changeMenuView('grid')} className={`grid h-10 w-10 place-items-center rounded-xl ${menuView === 'grid' ? 'bg-ink text-white shadow-sm' : 'text-slate-500'}`}><LayoutGrid size={18} /></button>
              <button aria-label="Tampilan list" onClick={() => changeMenuView('list')} className={`grid h-10 w-10 place-items-center rounded-xl ${menuView === 'list' ? 'bg-ink text-white shadow-sm' : 'text-slate-500'}`}><List size={19} /></button>
            </div>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
              <input className="input h-11 rounded-2xl pl-11 text-sm" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nama produk..." />
            </div>
          </div>
        </div>
        {editingOrder && <div className="mt-3 rounded-2xl bg-brand-50 p-3 text-sm text-brand-800"><b>Editing Order:</b> {editingOrder.orderNumber}</div>}
      </div>

      {error && <p className="mb-3 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="min-h-0 rounded-[1.75rem] pr-1 md:flex-1 md:overflow-y-auto">
        {menuView === 'grid' ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {pagedProducts.map(p => {
            const price = Number(p.basePrice || p.variants[0]?.sellingPrice || 0);
            const outOfStock = Number((p as any).stock || (p as any).stockQty || 1) <= 0;
            return <button key={p.id} onClick={() => quickAdd(p)} disabled={!shiftOpen || outOfStock} className="group relative overflow-hidden rounded-3xl bg-white text-left shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60">
              <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-gradient-to-br from-brand-50 via-amber-50 to-white text-4xl">
              {p.imageUrl ? (
  <img
    src={productImageSrc(p.imageUrl)}
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
                <h3 className="line-clamp-3 min-h-[2.35rem] text-sm font-extrabold leading-tight text-ink">{p.name}</h3>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="truncate text-[11px] font-bold text-slate-500">{p.variantGroups?.length ? 'Pilih opsi' : p.variants[0]?.variantName || 'Base'}</span>
                  <b className="money shrink-0 text-sm text-brand-700">{rupiah(price)}</b>
                </div>
              </div>
            </button>;
          })}
        </div> : <div className={`grid gap-2 ${cartCollapsed ? 'md:grid-cols-2 xl:grid-cols-3' : 'xl:grid-cols-2'}`}>
          {pagedProducts.map(p => {
            const price = Number(p.basePrice || p.variants[0]?.sellingPrice || 0);
            return <button key={p.id} onClick={() => quickAdd(p)} disabled={!shiftOpen} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-black/5 disabled:opacity-60">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 to-amber-50 text-2xl">{p.imageUrl ? <img src={productImageSrc(p.imageUrl)} alt={p.name} className="h-full w-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.src = foruLogo;}} /> : ''}</div>
              <div className="min-w-0 flex-1"><h3 className=" line-clamp-3 truncate  text-sm">{p.name}</h3><p className="truncate text-xs text-slate-400">{p.variantGroups?.length ? 'Pilih opsi' : p.variants[0]?.variantName || 'Base'}</p></div>
              <b className="money shrink-0 text-brand-700">{rupiah(price)}</b>
            </button>;
          })}
        </div>}
      </div>

      <div className="mt-3 flex flex-nowrap items-center justify-between gap-2 rounded-[1.75rem] bg-white p-2 text-xs shadow-sm ring-1 ring-black/5 sm:p-3 sm:text-sm">
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-slate-400 xl:inline">Page</span>
          <select className="rounded-xl border px-2 py-2 font-semibold sm:px-3" value={pageSize} onChange={e => changePageSize(Number(e.target.value))}>{[10,20].map(n => <option key={n} value={n}>{n} produk</option>)}</select>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-xl border px-3 py-2 font-bold disabled:opacity-40 sm:px-4">Prev</button>
          <b className="whitespace-nowrap">{currentPage} / {totalPages}</b>
          <button disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="rounded-xl border px-3 py-2 font-bold disabled:opacity-40 sm:px-4">Next</button>
          <button onClick={() => setOpenOrdersOpen(true)} className="relative hidden items-center gap-1.5 rounded-xl border border-amber-200 px-3 py-2 font-bold text-amber-700 hover:bg-amber-50 md:flex lg:gap-2 lg:px-4"><ClipboardList size={16} /> Open{openOrders.length > 0 && <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] text-white">{openOrders.length}</span>}</button>
          <button onClick={() => navigate('/orders?status=PENDING_PAYMENT')} className="hidden items-center gap-1.5 rounded-xl border border-brand-200 px-3 py-2 font-bold text-brand-700 hover:bg-brand-50 md:flex lg:gap-2 lg:px-4"><ClipboardList size={16} /> Orders</button>
        </div>
      </div>
    </section>

    {cartCollapsed && <aside className="relative hidden min-w-0 border-l bg-[#f8faf6] p-2 shadow-[-8px_0_24px_rgba(15,23,42,0.06)] md:sticky md:top-16 md:flex md:h-[calc(100vh-4rem)] md:flex-col md:items-center md:gap-3">
      <button
        onClick={() => changeCartCollapsed(false)}
        className="mt-3 flex w-full flex-col items-center gap-2 rounded-[2rem] bg-white px-2 py-4 text-brand-700 shadow-sm ring-1 ring-black/5 transition hover:bg-brand-50"
        title="Tampilkan pesanan"
      >
        <ChevronLeft size={18} className="mb-1" />
        <span className="relative grid h-10 w-10 place-items-center rounded-2xl bg-brand-50">
          <ShoppingBag size={20} />
          {!!cart.length && <b className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] text-white">{cart.reduce((s, x) => s + x.qty, 0)}</b>}
        </span>
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">CART</span>
        {!!cart.length && <span className="max-w-full truncate text-[10px] font-black text-brand-700">{summary.grand >= 1000000 ? `${Math.round(summary.grand / 1000000)}jt` : `${Math.round(summary.grand / 1000)}rb`}</span>}
      </button>
      <button onClick={() => navigate('/orders?status=PENDING_PAYMENT')} className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-brand-700 shadow-sm ring-1 ring-black/5" title="Orders"><ClipboardList size={19} /></button>
    </aside>}

    <aside className={`${cartCollapsed ? 'md:hidden' : ''} relative flex min-w-0 flex-col border-t bg-slate-50 shadow-[-8px_0_24px_rgba(15,23,42,0.06)] md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:min-h-0 md:gap-3 md:overflow-y-auto md:overscroll-contain md:border-l md:border-t-0 md:bg-[#f8faf6] md:p-3`}>
      <div className="min-h-[220px] flex-none bg-slate-50/70 p-3 md:min-h-[180px] md:max-h-[60vh] md:overflow-y-auto md:overscroll-contain md:bg-transparent md:p-0">
        <div className="flex min-h-full flex-col rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5 md:min-h-0 md:rounded-[1.75rem] md:border md:border-slate-100 md:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3"><ShoppingBag className="shrink-0 text-slate-600" size={22} /><h2 className="truncate text-sm font-black text-ink">Pesanan ({cart.reduce((s, x) => s + x.qty, 0)})</h2></div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={clearCart} disabled={!cart.length} className="flex shrink-0 items-center gap-1 rounded-xl px-2 py-1 text-sm font-semibold text-red-600 disabled:opacity-40"><Trash2 size={16} />Kosongkan</button>
              <button onClick={() => changeCartCollapsed(true)} className="hidden h-9 w-9 place-items-center rounded-xl border text-slate-500 hover:bg-brand-50 hover:text-brand-700 md:grid" title="Sembunyikan pesanan"><ChevronRight size={18} /></button>
            </div>
          </div>
          {!cart.length ? <div className="grid min-h-64 flex-1 place-items-center rounded-3xl border-2 border-dashed bg-slate-50/70 text-center text-slate-400 md:min-h-0">
            <div><ShoppingBag className="mx-auto mb-3" /><p>Pilih produk untuk<br />memulai transaksi</p></div>
          </div> : <div className="space-y-3">{cart.map((x, i) => {
            const lineBase = x.price * x.qty;
            const discount = calcDisc(lineBase, x.discount);
            const total = lineBase - discount;
            return <div key={x.key} className="min-w-0 rounded-2xl border bg-white p-3 shadow-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_84px] items-start gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-black text-white">{i + 1}</span>
                    <h3 className="min-w-0 text-sm font-semibold leading-tight text-ink break-words">{x.name}</h3>
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-500">{x.variant || 'Base'}</p>
                  {x.itemNote && <button onClick={() => editItemNote(i, x.itemNote || '')} className="mt-2 max-w-full truncate rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{x.itemNote}</button>}
                </div>
                <b className="money shrink-1 text-right text-sm font-black text-ink">{rupiah(total)}</b>
              </div>
              <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2">
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

      <div className="shrink-0 bg-white p-3 shadow-sm ring-1 ring-black/5 md:rounded-[1.75rem] md:border md:border-slate-100 md:p-3 md:shadow-sm md:ring-0">
        {editingOrder && <div className="mb-2 rounded-2xl bg-brand-50 px-3 py-2 text-xs text-brand-800"><b>Editing Order:</b> {editingOrder.orderNumber}</div>}
        <div className="mb-2 hidden items-center justify-between md:flex">
          <div>
            <h2 className="text-sm font-black text-ink">Order Info</h2>
            <p className="text-[11px] font-semibold text-slate-400">{cart.length} macam item · {cart.reduce((s, x) => s + x.qty, 0)} total qty</p>
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-2xl bg-brand-50 text-brand-700"><ShoppingBag size={18} /></div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(130px,170px)] gap-2">
            <div className="min-w-0">
              <label className="label text-xs text-slate-600">Customer</label>
              <input className="input h-10 w-full rounded-2xl text-sm" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Walk In" />
            </div>
            <div className="min-w-0">
              <label className="label text-xs text-slate-600">Order Type</label>
              <select className="input h-10 w-full rounded-2xl text-xs" value={orderType} onChange={e => setOrderType(e.target.value)}>
                <option value="DINE_IN">Dine In</option>
                <option value="TAKE_AWAY">Take Away</option>
                <option value="GOFOOD">GoFood</option>
                <option value="GRABFOOD">GrabFood</option>
                <option value="SHOPEEFOOD">ShopeeFood</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label text-xs text-slate-600">Catatan Order</label>
            <input className="input h-10 w-full rounded-2xl text-xs" value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="Catatan untuk order (opsional)" />
          </div>
          <div className="-mx-3 border-t border-slate-100" />
          <button onClick={applyItemDiscount} disabled={!cart.length} className="flex w-full items-center justify-between rounded-2xl px-1 py-0.5 text-left text-xs font-black text-brand-700 disabled:opacity-40"><span>+ Diskon item</span><span>⌄</span></button>
          <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] gap-2">
            <input className="input h-10 rounded-2xl text-xs uppercase" value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())} placeholder="GUNAKAN KUPON" />
            <button onClick={applyCoupon} disabled={!cart.length || !coupon} className="btn-soft rounded-2xl px-3"><Tag size={18} /></button>
          </div>
          {couponMsg && <p className={`text-xs ${couponDiscount ? 'text-brand-600' : 'text-red-600'}`}>{couponDiscount ? <Check className="mr-1 inline" size={14} /> : null}{couponMsg}</p>}
          <button onClick={applyTransactionDiscount} className="rounded-2xl bg-brand-50 px-3 py-2 text-xs font-extrabold text-brand-700">+ Diskon transaksi</button>
        </div>
      </div>
<div className="shrink-0 border-t bg-white p-4 pb-[max(6rem,env(safe-area-inset-bottom))] md:rounded-[1.75rem] md:border md:border-slate-100 md:p-4 md:shadow-sm">
        <div className="space-y-1.5 text-sm"><Row label={`Subtotal (${cart.reduce((s, x) => s + x.qty, 0)} item)`} n={summary.subtotal} /><Row label="Diskon Item" n={-summary.productDiscount} /><Row label="Diskon Transaksi" n={-summary.transactionDiscount} /><Row label="Diskon Kupon" n={-couponDiscount} /><Row label="PPN (0%)" n={0} /></div>
        <div className="mt-3 flex items-end justify-between border-t pt-3"><b className="text-2xl text-ink md:text-xl">Total</b><strong className="money text-3xl text-brand-700 md:text-2xl">{rupiah(summary.grand)}</strong></div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:mt-3">
          <button disabled={!cart.length || !shiftOpen || orderSubmitting} onClick={saveOrder} className="h-14 rounded-2xl border border-brand-600 bg-white px-3 text-sm font-black text-brand-700 disabled:opacity-40 md:h-12">{orderSubmitting ? 'Menyimpan...' : editingOrder ? 'Update Open Bill' : 'Simpan Open Bill'}</button>
          <button disabled={!cart.length || !shiftOpen || orderSubmitting} onClick={() => setPayOpen(true)} className="btn-primary h-14 rounded-2xl text-sm font-black md:h-12 md:text-base">Bayar</button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button disabled={!cart.length || !shiftOpen || orderSubmitting} onClick={saveOrder} className="rounded-2xl border px-2 py-3 text-xs font-extrabold text-slate-600 disabled:opacity-40">{orderSubmitting ? 'Menyimpan...' : 'Open Bill'}</button>
          <button disabled={!cart.length} onClick={clearCart} className="rounded-2xl border px-2 py-3 text-xs font-extrabold text-red-600 disabled:opacity-40">Clear Cart</button>
        </div>
        {editingOrder && <button onClick={() => navigate(`/orders/${editingOrder.id}`)} className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm font-extrabold text-slate-500">Cancel Edit</button>}
      </div>
    </aside>
    {dialog?.kind === 'confirm' && <ConfirmDialog
      tone={dialog.tone}
      title={dialog.title}
      description={dialog.description}
      detail={dialog.detail}
      cancelText={dialog.cancelText}
      confirmText={dialog.confirmText}
      onCancel={() => { dialog.resolve(false); setDialog(null); }}
      onConfirm={() => { dialog.resolve(true); setDialog(null); }}
    />}
    {dialog?.kind === 'text' && <TextInputDialog
      title={dialog.title}
      description={dialog.description}
      label={dialog.label}
      defaultValue={dialog.defaultValue}
      placeholder={dialog.placeholder}
      onCancel={() => { dialog.resolve(null); setDialog(null); }}
      onSubmit={value => { dialog.resolve(value); setDialog(null); }}
    />}
    {dialog?.kind === 'discount' && <DiscountDialog
      title={dialog.title}
      description={dialog.description}
      initialType={dialog.initialType}
      initialValue={dialog.initialValue}
      onCancel={() => { dialog.resolve(null); setDialog(null); }}
      onSubmit={value => { dialog.resolve(value); setDialog(null); }}
    />}
    {openOrdersOpen && <OpenOrdersModal
      orders={openOrders}
      onClose={() => setOpenOrdersOpen(false)}
      onRefresh={loadOpenOrders}
      onReview={setReviewOpenOrder}
      onEdit={order => { setOpenOrdersOpen(false); navigate(`/pos?editOrderId=${order.id}`); }}
      onReject={rejectOpenOrder}
    />}
    {reviewOpenOrder && <OpenOrderReviewModal
      order={reviewOpenOrder}
      onClose={() => setReviewOpenOrder(null)}
      onEdit={order => { setReviewOpenOrder(null); setOpenOrdersOpen(false); navigate(`/pos?editOrderId=${order.id}`); }}
      onReject={rejectOpenOrder}
    />}
    {config && <ConfigProduct product={config} close={() => setConfig(null)} add={addLine} />}
    {payOpen && <Payment total={summary.grand} initialCustomerName={customerName} onClose={() => setPayOpen(false)} onPay={async (method, cash, paidCustomerName) => { try { const active = await refreshActiveShift(); setCustomerName(paidCustomerName); const payload = { ...orderPayload(active), customerName: paidCustomerName }; const result = editingOrder ? await api(`/orders/${editingOrder.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod: method, cashReceived: cash, cashSessionId: active?.id, order: payload }) }) : await api('/sales', { method: 'POST', body: JSON.stringify({ ...payload, paymentMethod: method, cashReceived: cash }) }); setReceipt(result); resetCart(); setPayOpen(false); if (editingOrder) setEditingOrder(null); toast.success('Data berhasil disimpan.'); await runAutoPrint(result, 'paid-sale'); } catch (e) { const msg = (e as Error).message; toast.error(msg); throw e; } }} />}
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
  return <div data-back-modal="true" className="fixed inset-0 z-[60] grid place-items-end bg-black/40 sm:place-items-center"><div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl"><div className="mb-5 flex justify-between"><div><h3 className="section-title">{product.name}</h3><p className="text-sm text-slate-400">{rupiah(product.basePrice)}</p></div><button data-back-close="true" onClick={close}><X /></button></div><div className="space-y-5">{groups.map(g => <section key={g.id}><div className="mb-2 flex justify-between"><b>{g.name}</b><span className="text-xs text-slate-400">{g.required ? 'Wajib ' : ''}min {g.required ? Math.max(g.minSelect, 1) : g.minSelect} · max {g.maxSelect}</span></div><div className="space-y-2">{g.options.map(o => <label key={o.id} className={`flex items-center justify-between rounded-xl border p-3 text-sm ${sel.includes(o.id) ? 'border-brand-500 bg-brand-50' : ''}`}><span className="flex items-center gap-2"><input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={g.id} checked={sel.includes(o.id)} onChange={() => toggle(g, o)} />{o.name}</span><b>{Number(o.additionalPrice) ? `+${rupiah(o.additionalPrice)}` : 'Gratis'}</b></label>)}</div></section>)}</div>{errors.length > 0 && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{errors[0]}</p>}<div className="mt-5 flex items-center justify-between border-t pt-4"><span>Total item</span><b className="text-2xl text-brand-700">{rupiah(total)}</b></div><button disabled={!!errors.length} onClick={() => { const ids = [...sel].sort(); add({ key: `${product.id}:${ids.join('|')}`, productId: product.id, selectedVariantOptionIds: ids, name: product.name, variant: selectedOptions.map(o => o.name).join(', ') || 'Base', price: total, qty: 1 }); close(); }} className="btn-primary mt-5 w-full">Add To Cart</button></div></div>;
}

function Row({ label, n }: { label: string; n: number }) { return <div className="flex justify-between text-slate-500"><span>{label}</span><span className="money">{rupiah(n)}</span></div>; }

function OpenOrdersModal({ orders, onClose, onRefresh, onReview, onEdit, onReject }: { orders: any[]; onClose: () => void; onRefresh: () => void; onReview: (order: any) => void; onEdit: (order: any) => void; onReject: (order: any) => void }) {
  return <div data-back-modal="true" className="fixed inset-0 z-[65] grid place-items-end bg-black/40 p-3 md:place-items-center">
    <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b p-4">
        <div><h2 className="text-xl font-black">Open Orders</h2><p className="text-sm text-slate-500">{orders.length} pesanan menunggu konfirmasi</p></div>
        <div className="flex items-center gap-2"><button onClick={onRefresh} className="rounded-xl border px-3 py-2 text-sm font-bold">Refresh</button><button data-back-close="true" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"><X /></button></div>
      </div>
      <div className="max-h-[65vh] space-y-3 overflow-y-auto p-4">
        {!orders.length && <div className="rounded-2xl border border-dashed p-8 text-center text-slate-400">Belum ada open order.</div>}
        {orders.map(order => <div key={order.id} className="rounded-2xl border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><b className="block truncate">{order.orderNumber}</b><p className="truncate text-sm text-slate-500">{order.customerName || 'Walk In'} · {order.orderType || 'DINE_IN'}</p></div>
            <b className="shrink-0 text-brand-700">{rupiah(order.grandTotal)}</b>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{(order.items || []).map((item: any) => `${item.qty}x ${item.productName}`).join(', ')}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => onReview(order)} className="rounded-xl border px-3 py-2 text-sm font-bold">Review</button>
            <button onClick={() => onEdit(order)} className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold text-white">Edit POS</button>
            <button onClick={() => onReject(order)} className="rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-700">Tolak</button>
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}

function OpenOrderReviewModal({ order, onClose, onEdit, onReject }: { order: any; onClose: () => void; onEdit: (order: any) => void; onReject: (order: any) => void }) {
  return <div data-back-modal="true" className="fixed inset-0 z-[70] grid place-items-end bg-black/40 p-3 md:place-items-center">
    <div className="max-h-[86vh] w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b p-4">
        <div><h2 className="text-xl font-black">Review Open Order</h2><p className="text-sm text-slate-500">{order.orderNumber}</p></div>
        <button data-back-close="true" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"><X /></button>
      </div>
      <div className="max-h-[62vh] space-y-3 overflow-y-auto p-4">
        <div className="rounded-2xl bg-slate-50 p-3"><p className="font-black">{order.customerName || 'Walk In'}</p><p className="text-sm text-slate-500">{order.customerPhone || '-'} · {order.orderType || 'DINE_IN'}{order.tableNumber ? ` · Meja ${order.tableNumber}` : ''}</p>{order.orderNote && <p className="mt-2 text-sm">{order.orderNote}</p>}</div>
        {(order.items || []).map((item: any) => <div key={item.id} className="rounded-2xl border p-3">
          <div className="flex justify-between gap-3"><div><b>{item.qty}x {item.productName}</b><p className="text-sm text-slate-500">{item.variantName || 'Base'}</p></div><b>{rupiah(item.subtotalAfterDiscount || item.subtotal || 0)}</b></div>
          {item.itemNote && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-sm text-amber-800">{item.itemNote}</p>}
        </div>)}
        <div className="flex justify-between border-t pt-3 text-lg font-black"><span>Total</span><span className="text-brand-700">{rupiah(order.grandTotal)}</span></div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t p-4">
        <button onClick={onClose} className="rounded-xl border px-3 py-3 font-bold">Tutup</button>
        <button onClick={() => onReject(order)} className="rounded-xl border border-red-200 px-3 py-3 font-bold text-red-700">Tolak</button>
        <button onClick={() => onEdit(order)} className="rounded-xl bg-brand-600 px-3 py-3 font-bold text-white">Edit POS</button>
      </div>
    </div>
  </div>;
}

function Payment({ total, initialCustomerName = '', onClose, onPay }: { total: number; initialCustomerName?: string; onClose: () => void; onPay: (m: string, c: number | undefined, customerName: string) => void | Promise<void> }) {
  const [m, setM] = useState('CASH');
  const [cash, setCash] = useState(0);
  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const methods = ['CASH', 'QRIS', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD', 'VOUCHER'];
  const quickAmounts = [10000, 20000, 50000, 100000];
  const nonCash = m !== 'CASH';
  const paidAmount = nonCash ? total : cash;
  const change = Math.max(0, paidAmount - total);
  return <div data-back-modal="true" className="fixed inset-0 z-[60] grid place-items-end bg-black/40 sm:place-items-center">
    <div className="max-h-[94vh] w-full max-w-xl overflow-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-xl"><span className="text-slate-500">Metode </span><b>Pembayaran</b></h3><button data-back-close="true" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-50"><X /></button></div>
      <div className="mb-4 grid grid-cols-2 gap-2">{methods.map(value => <button key={value} onClick={() => setM(value)} className={`rounded-xl border p-3 text-sm font-black ${m === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'bg-white'}`}>{value}</button>)}</div>
      <button className="mb-3 w-full rounded-xl bg-brand-50 px-4 py-4 font-medium text-brand-700">Edit Tanggal</button>
      <div className="mb-4 grid grid-cols-[1fr_5rem] gap-2"><input className="input" value="" readOnly placeholder="Gunakan Kupon" /><button className="rounded-xl border border-brand-300 text-2xl text-brand-500">⌄</button></div>
      <div className="mb-4 rounded-xl bg-slate-100 p-3">
        <div className="bg-white p-4 text-sm">
          <div className="flex justify-between py-1"><span>Total Belanja</span><b>{rupiah(total)}</b></div>
          <div className="flex justify-between py-1"><span>Potongan Promo</span><b>{rupiah(0)}</b></div>
          <div className="flex justify-between py-1"><span>Pajak</span><b>{rupiah(0)}</b></div>
          <div className="my-2 border-t" />
          <div className="flex justify-between py-1"><span>Potongan Member</span><b>{rupiah(0)}</b></div>
          <div className="flex justify-between py-1"><span>Potongan Kupon</span><b>{rupiah(0)}</b></div>
          <div className="my-2 border-t" />
          <div className="flex justify-between text-sm font-black"><span>Total Bayar</span><span>{rupiah(total)}</span></div>
          <div className="flex justify-between text-sm font-black"><span>Jumlah Uang</span><span>{rupiah(paidAmount)}</span></div>
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
      <button disabled={submitting || (m === 'CASH' && cash < total)} onClick={async () => { if (submitting) return; setSubmitting(true); try { await onPay(m, m === 'CASH' ? cash : undefined, customerName); } finally { setSubmitting(false); } }} className="btn-primary mt-5 w-full">{submitting ? 'Menyimpan...' : 'Selesaikan Transaksi'}</button>
    </div>
  </div>;
}
function Receipt({ sale, close }: { sale: any; close: () => void }) {
  const paid = sale.status === 'PAID';
  const [customerPrint, setCustomerPrint] = useState(true);
  const [kitchenPrint, setKitchenPrint] = useState(true);
  async function print(type: 'customer-receipt' | 'kitchen-ticket' | 'customer-item-list') {
    await printWithBluetoothFallback(sale, type, type === 'customer-receipt' ? `/receipt/${sale.id}` : type === 'kitchen-ticket' ? `/kitchen-ticket/${sale.id}` : `/customer-item-list/${sale.id}`);
    if (type === 'customer-item-list') await api(`/orders/${sale.id}/print/customer-item-list`, { method: 'POST' }).catch(() => {});
    else await api(`/print/${type}/${sale.id}`, { method: 'POST' }).catch(() => {});
  }
  async function printSelected() {
    try {
      if (!customerPrint && !kitchenPrint) { toast.error('Pilih minimal satu struk untuk dicetak'); return; }
      if (customerPrint) await print(paid ? 'customer-receipt' : 'customer-item-list');
      if (kitchenPrint) await print('kitchen-ticket');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return <div data-back-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-ink/80 p-3">
    <div className="max-h-[86vh] w-[min(92vw,26rem)] rounded-[1.75rem] bg-white p-3 text-center shadow-2xl">
      <h2 className="text-base font-black leading-tight">{sale.printTitle || (paid ? 'Transaksi berhasil!' : 'Open Bill tersimpan!')}</h2>
      <p className="mx-auto mt-0.5 max-w-full truncate text-[11px] font-semibold leading-tight text-slate-400">{paid ? sale.transactionNumber : sale.orderNumber} - {sale.customerName || 'Walk In'}</p>
      <div className="my-2 flex min-h-[52px] items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-left">
        <p className="text-xs font-bold text-slate-400">{paid ? 'Total' : 'Total sementara'}</p>
        <b className="text-lg text-brand-700">{rupiah(sale.grandTotal)}</b>
      </div>
      <div className="mb-2 rounded-2xl bg-brand-50/70 px-3 py-2 text-left">
        <p className="mb-0.5 text-xs font-black">Cetak Struk</p>
        <label className="flex min-h-8 items-center gap-2 py-0.5 text-xs font-medium leading-tight"><input className="h-3.5 w-3.5 accent-brand-600" type="checkbox" checked={customerPrint} onChange={e => setCustomerPrint(e.target.checked)} />{paid ? 'Final Receipt (Pelanggan)' : 'Customer Item List'}</label>
        <div className="border-t border-brand-100" />
        <label className="flex min-h-8 items-center gap-2 py-0.5 text-xs font-medium leading-tight"><input className="h-3.5 w-3.5 accent-brand-600" type="checkbox" checked={kitchenPrint} onChange={e => setKitchenPrint(e.target.checked)} />Kitchen Ticket (Dapur)</label>
      </div>
      <button onClick={printSelected} className="btn-soft mb-1 h-10 w-full justify-center border-brand-600 text-sm text-brand-700">Cetak Sekarang <Printer size={15} /></button>
      <button data-back-close="true" onClick={close} className="btn-primary h-10 w-full text-sm">Selesai</button>
    </div>
  </div>;
}
