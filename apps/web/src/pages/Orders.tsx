import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Check, Clock3, CreditCard, Eye, Filter, MoreHorizontal, Package, Pencil, Printer, ReceiptText, ShoppingCart, UserRound, WalletCards, X, XCircle } from 'lucide-react';
import { api, dt, rupiah } from '../api';
import { printWithBluetoothFallback } from '../printer';
import { useOutlet } from '../OutletContext';
import { appAlert, appPrompt } from '../components/ui/AppDialog';
import { CancelOrderDialog } from '../components/ui/FormDialog';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Loading = () => <div className="p-10 text-center text-slate-400">Memuat data...</div>;
const Err = ({ v }: { v: string }) => v ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{v}</div> : null;
const Empty = () => <div className="p-10 text-center text-sm text-slate-400">Belum ada data pada periode ini.</div>;
const statusMeta = (status: string) => {
  if (status === 'PAID') return { label: 'PAID', cls: 'bg-emerald-50 text-emerald-700', icon: Check };
  if (status === 'PENDING_PAYMENT') return { label: 'OPEN BILL', cls: 'bg-amber-50 text-amber-700', icon: Clock3 };
  if (status === 'CANCELLED') return { label: 'CANCELLED', cls: 'bg-slate-100 text-slate-600', icon: X };
  if (status === 'VOID') return { label: 'Void', cls: 'bg-red-50 text-red-700', icon: X };
  return { label: status, cls: 'bg-slate-100 text-slate-600', icon: Clock3 };
};
const itemSummary = (items?: any[]) => (items || []).map(i => `${i.qty} ${i.productName}`);
const itemPreview = (items?: any[]) => {
  const rows = items || [];
  return { first: rows[0]?.productName || 'Belum ada item', more: Math.max(0, rows.length - 1) };
};
const orderTime = (value: string) => {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date),
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(date)
  };
};
const localDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date);
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const startOfWeek = (date: Date) => { const next = new Date(date); const day = next.getDay() || 7; next.setDate(next.getDate() - day + 1); return next; };
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const datePresetRange = (preset: string) => {
  const now = new Date();
  if (preset === 'yesterday') { const d = addDays(now, -1); return { from: localDate(d), to: localDate(d) }; }
  if (preset === 'week') return { from: localDate(startOfWeek(now)), to: localDate(now) };
  if (preset === 'month') return { from: localDate(startOfMonth(now)), to: localDate(now) };
  return { from: localDate(now), to: localDate(now) };
};
const zeroSummary = { totalOrders: 0, paidOrders: 0, pendingOrders: 0, cancelledOrders: 0, totalItemsSold: 0, totalNominal: 0, topSellingProduct: null as null | { productId: string; productName: string; qty: number; nominal: number } };
const moneyNumber = (value: any) => Number(value || 0);
const paidLabel = (status: string) => status === 'PAID' ? 'Lunas' : status === 'PENDING_PAYMENT' ? 'Open Bill' : status === 'CANCELLED' ? 'Batal' : status;
const statusLabel = (status: string) => status === 'PENDING_PAYMENT' ? 'OPEN BILL' : status.replace('_', ' ');
const compactDate = (value: string) => {
  const d = new Date(value);
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(d)}`;
};

export function Orders() {
  const tabs = ['PENDING_PAYMENT', 'PAID', 'CANCELLED', 'VOID'];
  const navigate = useNavigate();
  const { selectedOutletId: outletId } = useOutlet();
  const [status, setStatus] = useState('PENDING_PAYMENT');
  const [preset, setPreset] = useState('today');
  const initialRange = datePresetRange('today');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState(zeroSummary);
  const [loading, setLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  function setQuickPreset(value: string) {
    setPreset(value);
    if (value !== 'custom') {
      const range = datePresetRange(value);
      setFrom(range.from);
      setTo(range.to);
    }
  }
  const query = () => {
    const params = new URLSearchParams({ from, to });
    if (outletId) params.set('outletId', outletId);
    return params.toString();
  };
  const load = async () => {
    try {
      setLoading(true);
      setError('');
      if (!outletId) throw new Error('Silakan pilih outlet terlebih dahulu.');
      const q = query();
      const [orders, nextSummary] = await Promise.all([
        api<any[]>(`/orders?status=${status}&${q}`),
        api<typeof zeroSummary>(`/orders/summary?${q}`)
      ]);
      setSummary({ ...zeroSummary, ...nextSummary });
      setData(orders);
      const ordersWithItems = await Promise.all(orders.map(async o => {
        if (Array.isArray(o.items) && o.items.length) return o;
        try {
          const detail = await api<any>(`/orders/${o.id}`);
          return { ...o, items: detail.items || [] };
        } catch {
          return o;
        }
      }));
      setData(ordersWithItems);
    } catch (e) {
      setError((e as Error).message);
      setSummary(zeroSummary);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [status, from, to, outletId]);

  async function cancel(o: any) {
    setCancelTarget(o);
  }
  async function submitCancel(reason: string) {
    if (!cancelTarget) return;
    await api(`/orders/${cancelTarget.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
    await load();
  }
  async function print(o: any, type: 'customer-item-list' | 'kitchen-ticket' | 'customer-receipt') {
    try {
      const doc = type === 'customer-receipt' ? await api(`/sales/${o.id}`) : await api(`/orders/${o.id}`);
      await printWithBluetoothFallback(doc, type, type === 'customer-item-list' ? `/customer-item-list/${o.id}` : type === 'customer-receipt' ? `/receipt/${o.id}` : `/kitchen-ticket/${o.id}`);
      if (type === 'customer-receipt') await api(`/print/customer-receipt/${o.id}`, { method: 'POST' }).catch(() => {});
      else await api(`/orders/${o.id}/print/${type}`, { method: 'POST' }).catch(() => {});
    } catch (e) { appAlert((e as Error).message, { tone: 'danger' }); }
  }
  async function voidOrder(o: any) {
    try {
      const reason = await appPrompt('Masukkan alasan void transaksi.', 'Void transaksi', { title: 'Void Transaction', label: 'Alasan Void', multiline: true, minLength: 3, maxLength: 250 });
      if (!reason) return;
      await api(`/sales/${o.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      await load();
    } catch (e) { appAlert((e as Error).message, { tone: 'danger' }); }
  }
  const iconBtn = 'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-brand-100 bg-white text-brand-700 shadow-sm hover:bg-brand-50';
  const dangerBtn = 'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-red-100 bg-white text-red-600 shadow-sm hover:bg-red-50';
  const menuItem = 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-brand-700 hover:bg-brand-50';
  const dangerMenuItem = 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50';
  const DesktopActions = ({ o }: { o: any }) => <div className="flex flex-nowrap items-center justify-end gap-2">
    <Link title="View" aria-label="View order" className={iconBtn} to={`/orders/${o.id}`}><Eye size={18} /></Link>
    {o.status === 'PENDING_PAYMENT' && <Link title="Edit" aria-label="Edit order" className={iconBtn} to={`/pos?editOrderId=${o.id}`}><Pencil size={18} /></Link>}
    <button title="Item List" aria-label="Print item list" className={iconBtn} onClick={() => print(o, 'customer-item-list')}><Package size={18} /></button>
    <button title={o.status === 'PAID' ? 'Reprint Kitchen' : 'Kitchen'} aria-label="Print kitchen ticket" className={iconBtn} onClick={() => print(o, 'kitchen-ticket')}><Printer size={18} /></button>
    {o.status === 'PAID' && <button title="Reprint Receipt" aria-label="Print receipt" className={iconBtn} onClick={() => print(o, 'customer-receipt')}><ReceiptText size={18} /></button>}
    {o.status === 'PAID' && <button title="Void" aria-label="Void transaction" className={dangerBtn} onClick={() => voidOrder(o)}><XCircle size={18} /></button>}
    {o.status === 'PENDING_PAYMENT' && <button title="Cancel" aria-label="Cancel order" className={dangerBtn} onClick={() => cancel(o)}><XCircle size={18} /></button>}
  </div>;
  const MoreMenu = ({ o }: { o: any }) => <details className="relative">
    <summary aria-label="More actions" className="inline-flex h-12 w-12 cursor-pointer list-none items-center justify-center rounded-xl bg-slate-100 text-ink shadow-sm [&::-webkit-details-marker]:hidden">
      <MoreHorizontal size={22} />
    </summary>
    <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-2xl border border-slate-100 bg-white p-2 text-sm font-bold shadow-xl">
      {o.status === 'PENDING_PAYMENT' && <Link className={menuItem} to={`/pos?editOrderId=${o.id}`}><Pencil size={16} />Edit</Link>}
      <button className={menuItem} onClick={() => print(o, 'customer-item-list')}><Package size={16} />Item List</button>
      <button className={menuItem} onClick={() => print(o, 'kitchen-ticket')}><Printer size={16} />Kitchen</button>
      {o.status === 'PAID' && <button className={menuItem} onClick={() => print(o, 'customer-receipt')}><ReceiptText size={16} />Receipt</button>}
      {o.status === 'PAID' && <button className={dangerMenuItem} onClick={() => voidOrder(o)}><XCircle size={16} />Void</button>}
      {o.status === 'PENDING_PAYMENT' && <button className={dangerMenuItem} onClick={() => cancel(o)}><XCircle size={16} />Cancel</button>}
    </div>
  </details>;

  return <div className="flex h-[calc(100dvh-4.5rem)] min-h-0 flex-col overflow-hidden bg-soft/40 p-3 pb-20 md:pb-3 lg:h-[calc(100dvh-5rem)] lg:p-6">
    <div className="sticky top-0 z-20 shrink-0 bg-soft/95 pb-1.5 backdrop-blur md:pb-1.5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-ink lg:text-3xl">Orders</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">Open bill, paid, cancelled, dan void.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => navigate('/pos')} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-brand-700 shadow-sm ring-1 ring-brand-100 hover:bg-brand-50">
            <ShoppingCart size={18} />
            Kasir
          </button>
          <button onClick={() => setFilterOpen(v => !v)} className="inline-flex items-center gap-2 rounded-2xl bg-pink-50 px-4 py-3 text-sm font-black text-pink-600 shadow-sm ring-1 ring-pink-100">
            <Filter size={18} fill="currentColor" />
            Saring
          </button>
        </div>
      </div>
      {filterOpen && <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['week', 'Minggu ini'], ['month', 'Bulan ini'], ['custom', 'Custom']].map(([value, label]) => <button key={value} onClick={() => setQuickPreset(value)} className={`min-w-fit whitespace-nowrap rounded-full px-4 py-2 text-xs font-black transition ${preset === value ? 'bg-ink text-white' : 'bg-slate-50 text-slate-500'}`}>{label}</button>)}
        </div>
        {preset === 'custom' && <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-600">Dari tanggal<input className="input mt-1" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-sm font-bold text-slate-600">Sampai tanggal<input className="input mt-1" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>}
      </div>}
      <div className="grid grid-cols-2 gap-x-5 gap-y-2 rounded-2xl bg-slate-50 px-4 py-3 shadow-sm ring-1 ring-slate-100 md:grid-cols-4">
        <div className="min-w-0"><p className="text-xs font-black text-slate-500">Total Order</p><p className="mt-1 text-sm text-slate-800">{summary.totalOrders}</p></div>
        <div className="min-w-0"><p className="text-xs font-black leading-tight text-slate-500">Total Item Terjual</p><p className="mt-1 text-sm text-slate-800">{summary.totalItemsSold}</p></div>
        <div className="min-w-0"><p className="text-xs font-black text-slate-500">Total Nominal</p><p className="mt-1 text-sm text-slate-800">{rupiah(summary.totalNominal)}</p></div>
        <div className="min-w-0"><p className="text-xs font-black leading-tight text-slate-500">Penjualan Terbanyak</p><p className="mt-1 line-clamp-2 break-words text-sm leading-snug text-slate-800">{summary.topSellingProduct ? `${summary.topSellingProduct.productName} ${summary.topSellingProduct.qty}x` : '-'}</p></div>
      </div>
      <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
        {tabs.map(t => <button key={t} onClick={() => setStatus(t)} className={`min-w-fit whitespace-nowrap rounded-full px-4 py-2 text-[11px] font-black shadow-sm transition sm:px-5 sm:text-xs ${status === t ? 'bg-ink text-white shadow-ink/15' : 'bg-white text-slate-500 ring-1 ring-slate-100'}`}>{statusLabel(t)}</button>)}
      </div>
    </div>
    <Err v={error} />
    {loading && <div className="mb-3 rounded-2xl bg-white p-3 text-sm font-bold text-slate-500 shadow-sm ring-1 ring-slate-100">Memuat orders...</div>}
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 md:space-y-3">
      {data.map(o => {
        const meta = statusMeta(o.status);
        const Icon = meta.icon;
        const items = itemSummary(o.items);
        const preview = itemPreview(o.items);
        const time = orderTime(o.createdAt);
        const received = moneyNumber(o.amountPaid ?? o.paidAmount ?? o.receivedAmount ?? (o.status === 'PAID' ? o.grandTotal : 0));
        const change = Math.max(0, received - moneyNumber(o.grandTotal));
        return <article key={o.id} className="w-full overflow-visible rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100 md:px-4 md:py-3 xl:px-5 xl:py-4">
          <div className="md:hidden">
          <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-black text-ink">{o.orderNumber || o.transactionNumber}</h3>
              <p className="mt-0.5 truncate text-xs font-bold text-slate-400">{o.transactionNumber || o.orderNumber}</p>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                <Package size={14} className="shrink-0 text-pink-500" />
                <span className="truncate">{preview.first}</span>
                {preview.more > 0 && <span className="shrink-0 font-bold text-slate-400">+{preview.more} item</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black ${meta.cls}`}>
                <Icon size={14} strokeWidth={3} />
                {paidLabel(o.status)}
              </span>
              <MoreMenu o={o} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-xs">
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><CalendarDays size={13} className="text-pink-500" />Tanggal Transaksi</p>
              <p className="font-medium text-slate-800">{compactDate(o.createdAt)}</p>
            </div>
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><CreditCard size={13} className="text-pink-500" />Nominal Transaksi</p>
              <p className="text-sm font-black text-slate-900">{rupiah(o.grandTotal)}</p>
              <p className="text-slate-500">Dibayar : <span className="text-pink-600">{received.toLocaleString('id-ID')}</span></p>
              <p className="text-slate-500">Kembalian : <span className="text-pink-600">{change.toLocaleString('id-ID')}</span></p>
            </div>
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><UserRound size={13} className="text-pink-500" />Pelanggan</p>
              <p className="truncate font-medium text-slate-800">{o.customerName || 'Walk In customer'}</p>
              <p className="truncate text-slate-500">Kasir : <span className="text-pink-600">{o.cashier?.name || 'Kasir'}</span></p>
            </div>
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><Pencil size={13} className="text-pink-500" />Transaksi Ditempat</p>
              <p className="font-medium text-slate-800">{o.orderType || '-'}</p>
            </div>
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><Package size={13} className="text-pink-500" />Items</p>
              <div className="space-y-0.5">
                {(items.length ? items : ['Belum ada item']).map((item, idx) => <p key={idx} className="truncate text-[11px] font-medium leading-tight text-slate-800">{item}</p>)}
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-500"><WalletCards size={13} className="text-pink-500" />Pembayaran</p>
              <p className="font-medium text-slate-800">{o.paymentMethod || (o.status === 'PAID' ? 'Tunai' : '-')}</p>
            </div>
          </div>
          </div>

          <div className="hidden min-w-0 items-center gap-3 md:grid md:grid-cols-[minmax(140px,1fr)_minmax(160px,1.1fr)_minmax(105px,0.75fr)_minmax(100px,0.7fr)_auto] xl:gap-4 xl:grid-cols-[minmax(170px,1.1fr)_minmax(200px,1.25fr)_minmax(130px,0.8fr)_minmax(120px,0.75fr)_auto]">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black text-ink">{o.orderNumber || o.transactionNumber}</h3>
              <p className="mt-1 truncate text-xs font-semibold text-slate-500">{o.customerName || 'Walk In customer'} - {o.cashier?.name || 'Kasir'}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-400">Items</p>
              <div className="mt-1 space-y-0.5">
                {(items.length ? items : ['Belum ada item']).map((item, idx) => <p key={idx} className="truncate text-[11px] font-semibold leading-tight text-slate-800">{item}</p>)}
              </div>
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-400">Pembayaran</p>
              <p className="truncate text-sm font-semibold text-slate-800">{o.paymentMethod || (o.status === 'PAID' ? 'Tunai' : '-')}</p>
              <p className="truncate text-xs text-slate-400">{o.orderType || '-'}</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-sm font-black text-ink">{rupiah(o.grandTotal)}</p>
              <p className="text-xs text-slate-400">{time.date}</p>
              <p className="text-xs font-semibold text-slate-500">{time.time}</p>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black ${meta.cls}`}>
                <Icon size={14} strokeWidth={3} />
                {paidLabel(o.status)}
              </span>
              <div className="hidden xl:block"><DesktopActions o={o} /></div>
              <div className="xl:hidden"><MoreMenu o={o} /></div>
            </div>
          </div>
        </article>;
      })}
      {!data.length && <Empty />}
    </div>
    <CancelOrderDialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} onSubmit={submitCancel} />
  </div>;
}

export function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>();
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const load = () => api(`/orders/${id}`).then(setOrder).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <Page><Err v={error} /></Page>;
  if (!order) return <Loading />;

  async function cancel() {
    setCancelOpen(true);
  }
  async function voidOrder() {
    try {
      const reason = await appPrompt('Masukkan alasan void transaksi.', 'Void transaksi', { title: 'Void Transaction', label: 'Alasan Void', multiline: true, minLength: 3, maxLength: 250 });
      if (!reason) return;
      await api(`/sales/${order.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { appAlert((e as Error).message, { tone: 'danger' }); }
  }
  async function print(type: 'customer-item-list' | 'kitchen-ticket' | 'customer-receipt') {
    try {
      await printWithBluetoothFallback(order, type, type === 'customer-item-list' ? `/customer-item-list/${order.id}` : type === 'customer-receipt' ? `/receipt/${order.id}` : `/kitchen-ticket/${order.id}`);
      if (type === 'customer-receipt') await api(`/print/customer-receipt/${order.id}`, { method: 'POST' }).catch(() => {});
      else await api(`/orders/${order.id}/print/${type}`, { method: 'POST' }).catch(() => {});
      load();
    } catch (e) { appAlert((e as Error).message, { tone: 'danger' }); }
  }

  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-3xl font-black">{order.orderNumber || order.transactionNumber}</h2><p className="text-slate-500">{order.outlet.name} - {dt(order.createdAt)} - {order.status}</p></div><Link to="/orders" className="btn-soft">Kembali</Link></div>
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="card p-5 xl:col-span-2">
        <div className="mb-5 grid gap-3 sm:grid-cols-2"><div><p className="text-sm text-slate-400">Customer</p><h3 className="text-2xl font-black">{order.customerName || 'Walk In'}</h3></div><div className="text-sm text-slate-500"><p>Transaction: <b>{order.transactionNumber || '-'}</b></p><p>Cashier: <b>{order.cashier?.name}</b></p>{order.paidAt && <p>Paid: <b>{dt(order.paidAt)}</b></p>}{order.paymentMethod && <p>Payment: <b>{order.paymentMethod}</b></p>}{order.couponCode && <p>Coupon: <b>{order.couponCode}</b></p>}</div></div>
        {order.items.map((i: any) => <div className="border-t py-3 text-sm" key={i.id}><div className="flex justify-between gap-4"><div><b>{i.qty}x {i.productName}</b><p className="text-slate-400">{i.variantName}</p>{i.addons?.map((a: any) => <p className="text-slate-400" key={a.id}>+ {a.addonName}</p>)}{i.itemNote && <p className="mt-1 font-bold text-amber-700">NOTE: {i.itemNote}</p>}{Number(i.discountAmount) > 0 && <p className="text-xs text-brand-600">Diskon item: {rupiah(i.discountAmount)}</p>}</div><span>{rupiah(i.subtotalAfterDiscount)}</span></div></div>)}
        <div className="mt-5 space-y-1 border-t pt-4 text-right"><p>Product discount: {rupiah(order.productDiscountTotal)}</p><p>Transaction discount: {rupiah(order.transactionDiscountAmount)}</p><p>Coupon discount: {rupiah(order.couponDiscountAmount)}</p><p className="text-sm text-slate-400">Total</p><b className="text-2xl text-brand-700">{rupiah(order.grandTotal)}</b></div>
      </div>
      <div className="card p-5"><h3 className="section-title mb-4">Actions</h3>
        {order.status === 'PENDING_PAYMENT' && <button onClick={() => navigate(`/pos?editOrderId=${order.id}`)} className="btn-primary mb-2 w-full">Edit Open Bill</button>}
        {order.status === 'PENDING_PAYMENT' && <button onClick={() => print('customer-item-list')} className="btn-soft mb-2 w-full">Customer Item List</button>}
        <button onClick={() => print('kitchen-ticket')} className="btn-soft mb-2 w-full">Kitchen Ticket</button>
        {order.status === 'PAID' && <button onClick={() => print('customer-receipt')} className="btn-soft mb-2 w-full">Print Receipt</button>}
        {order.status === 'PAID' && <button onClick={voidOrder} className="w-full rounded-xl bg-red-50 px-4 py-3 font-bold text-red-700">Void Transaction</button>}
        {order.status === 'PENDING_PAYMENT' && <button onClick={cancel} className="mt-2 w-full rounded-xl bg-red-50 px-4 py-3 font-bold text-red-700">Cancel Order</button>}
      </div>
    </div>
    <CancelOrderDialog
      open={cancelOpen}
      onClose={() => setCancelOpen(false)}
      onSubmit={async reason => {
        await api(`/orders/${order.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
        await load();
      }}
    />
  </Page>;
}

