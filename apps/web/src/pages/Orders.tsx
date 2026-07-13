import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Clock3, Eye, Filter, MoreHorizontal, Package, Pencil, Printer, ReceiptText, UserRound, X, XCircle } from 'lucide-react';
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
  if (status === 'PENDING_PAYMENT') return { label: 'PENDING PAYMENT', cls: 'bg-amber-50 text-amber-700', icon: Clock3 };
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

export function Orders() {
  const tabs = ['PENDING_PAYMENT', 'PAID', 'CANCELLED', 'VOID'];
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
      if (type === 'customer-receipt') await api(`/print/customer-receipt/${o.id}`, { method: 'POST' });
      else await api(`/orders/${o.id}/print/${type}`, { method: 'POST' });
      const doc = type === 'customer-receipt' ? await api(`/sales/${o.id}`) : await api(`/orders/${o.id}`);
      await printWithBluetoothFallback(doc, type, type === 'customer-item-list' ? `/customer-item-list/${o.id}` : type === 'customer-receipt' ? `/receipt/${o.id}` : `/kitchen-ticket/${o.id}`);
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
      {o.status === 'PENDING_PAYMENT' && <button className={dangerMenuItem} onClick={() => cancel(o)}><XCircle size={16} />Cancel</button>}
    </div>
  </details>;

  return <Page>
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-4xl font-black tracking-tight text-ink lg:text-3xl">Orders</h2>
        <p className="mt-1 text-base text-slate-500">Pending order, paid, cancelled, dan void.</p>
      </div>
      <button onClick={() => setFilterOpen(v => !v)} className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-pink-50 px-5 py-3 text-sm font-black text-pink-600 shadow-sm ring-1 ring-pink-100">
        <Filter size={18} fill="currentColor" />
        Saring
      </button>
    </div>
    {filterOpen && <div className="mb-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['week', 'Minggu ini'], ['month', 'Bulan ini'], ['custom', 'Custom']].map(([value, label]) => <button key={value} onClick={() => setQuickPreset(value)} className={`min-w-fit whitespace-nowrap rounded-full px-4 py-2 text-xs font-black transition ${preset === value ? 'bg-ink text-white' : 'bg-slate-50 text-slate-500'}`}>{label}</button>)}
      </div>
      {preset === 'custom' && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-600">Dari tanggal<input className="input mt-1" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-sm font-bold text-slate-600">Sampai tanggal<input className="input mt-1" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>}
    </div>}
    <div className="mb-4 inline-flex rounded-full bg-brand-50 px-4 py-2 text-sm font-black text-brand-700">Data Outlet Aktif</div>
    <div className="mb-5 grid grid-cols-2 gap-x-5 gap-y-7 rounded-2xl bg-slate-50 p-5 lg:grid-cols-4 lg:gap-x-10">
      <div className="min-w-0"><p className="text-sm font-black text-slate-500">Total Order</p><p className="mt-2 text-base text-slate-800">{summary.totalOrders}</p></div>
      <div className="min-w-0"><p className="text-sm font-black leading-tight text-slate-500">Total Item Terjual</p><p className="mt-2 text-base text-slate-800">{summary.totalItemsSold}</p></div>
      <div className="min-w-0"><p className="text-sm font-black text-slate-500">Total Nominal</p><p className="mt-2 text-base text-slate-800">{rupiah(summary.totalNominal)}</p></div>
      <div className="min-w-0"><p className="text-sm font-black leading-tight text-slate-500">Penjualan Terbanyak</p><p className="mt-2 line-clamp-2 break-words text-base leading-snug text-slate-800">{summary.topSellingProduct ? `${summary.topSellingProduct.productName} ${summary.topSellingProduct.qty}x` : '-'}</p></div>
    </div>
    <div className="mb-6 flex gap-3 overflow-x-auto pb-1">
      {tabs.map(t => <button key={t} onClick={() => setStatus(t)} className={`min-w-fit whitespace-nowrap rounded-full px-4 py-3 text-[11px] font-black shadow-sm transition sm:px-6 sm:text-xs lg:px-4 lg:py-2 ${status === t ? 'bg-ink text-white shadow-ink/15' : 'bg-white text-slate-500 ring-1 ring-slate-100'}`}>{t.replace('_', ' ')}</button>)}
    </div>
    <Err v={error} />
    {loading && <div className="mb-4 rounded-2xl bg-white p-3 text-sm font-bold text-slate-500 shadow-sm ring-1 ring-slate-100">Memuat orders...</div>}
    <div className="space-y-3 lg:hidden">
      {data.map(o => {
        const meta = statusMeta(o.status);
        const Icon = meta.icon;
        const items = itemSummary(o.items);
        const preview = itemPreview(o.items);
        const time = orderTime(o.createdAt);
        return <div key={o.id} className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.07)] ring-1 ring-slate-100">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-black text-ink">{o.orderNumber || o.transactionNumber}</h3>
              <p className="mt-1 truncate text-base font-semibold text-slate-400">{o.transactionNumber || o.orderNumber || '-'}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${meta.cls}`}>
              <Icon size={16} strokeWidth={3} />
              {meta.label}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
            <div className="min-w-0">
              <p className="inline-flex max-w-full items-center gap-2 truncate text-sm font-medium text-slate-700">
                <UserRound size={16} className="shrink-0 text-pink-500" />
                <span className="truncate">{o.customerName || 'Walk In customer'}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold text-ink">{rupiah(o.grandTotal)}</p>
              <p className="mt-1 text-sm text-slate-500">{time.date}</p>
              <p className="text-sm text-slate-500">{time.time}</p>
            </div>
          </div>
          {!!items.length && <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Package size={18} /></div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-700">{preview.first}</p>
              {preview.more > 0 && <p className="text-xs font-bold text-slate-400">+{preview.more} item</p>}
            </div>
          </div>}
          <div className="mt-5 flex justify-end gap-3">
            <Link aria-label="View order" className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-brand-100 bg-white text-brand-700 shadow-sm" to={`/orders/${o.id}`}>
              <Eye size={20} />
            </Link>
            {o.status === 'PENDING_PAYMENT' && <Link aria-label="Edit order" className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-brand-100 bg-white text-brand-700 shadow-sm" to={`/pos?editOrderId=${o.id}`}><Pencil size={20} /></Link>}
            <MoreMenu o={o} />
          </div>
        </div>;
      })}
      {!data.length && <Empty />}
    </div>
    <div className="card hidden overflow-hidden lg:block"><div className="overflow-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Items', 'Outlet', 'Cashier', 'Time', 'Total', 'Status', 'Actions'].map(x => <th className={`p-4 ${x === 'Total' || x === 'Actions' ? 'text-right' : ''}`} key={x}>{x}</th>)}</tr></thead><tbody>{data.map(o => {
      const preview = itemPreview(o.items);
      const time = orderTime(o.createdAt);
      const meta = statusMeta(o.status);
      const StatusIcon = meta.icon;
      return <tr className="h-[72px] border-t align-middle" key={o.id}>
        <td className="p-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Package size={18} /></div><div className="min-w-0"><p className="truncate font-black text-ink">{preview.first}</p>{preview.more > 0 && <p className="text-xs font-bold text-slate-400">+{preview.more} item</p>}<p className="truncate text-xs text-slate-400">{o.orderNumber || o.transactionNumber}</p></div></div></td>
        <td className="max-w-[180px] truncate font-semibold text-slate-600">{o.outlet?.name || '-'}</td>
        <td className="max-w-[140px] truncate font-semibold text-slate-600">{o.cashier?.name || '-'}</td>
        <td><p className="font-semibold text-slate-700">{time.date}</p><p className="text-xs font-bold text-slate-400">{time.time}</p></td>
        <td className="text-right text-base font-black text-ink">{rupiah(o.grandTotal)}</td>
        <td><span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black ${meta.cls}`}><StatusIcon size={14} strokeWidth={3} />{meta.label}</span></td>
        <td className="p-4 text-right"><DesktopActions o={o} /></td>
      </tr>;
    })}</tbody></table></div>{!data.length && <Empty />}</div>
    <CancelOrderDialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} onSubmit={submitCancel} />
  </Page>;
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
    if (type === 'customer-receipt') await api(`/print/customer-receipt/${order.id}`, { method: 'POST' });
    else await api(`/orders/${order.id}/print/${type}`, { method: 'POST' });
    try {
      await printWithBluetoothFallback(order, type, type === 'customer-item-list' ? `/customer-item-list/${order.id}` : type === 'customer-receipt' ? `/receipt/${order.id}` : `/kitchen-ticket/${order.id}`);
      load();
    } catch (e) { appAlert((e as Error).message, { tone: 'danger' }); }
  }

  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-3xl font-black">{order.orderNumber || order.transactionNumber}</h2><p className="text-slate-500">{order.outlet.name} · {dt(order.createdAt)} · {order.status}</p></div><Link to="/orders" className="btn-soft">Kembali</Link></div>
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="card p-5 xl:col-span-2">
        <div className="mb-5 grid gap-3 sm:grid-cols-2"><div><p className="text-sm text-slate-400">Customer</p><h3 className="text-2xl font-black">{order.customerName || 'Walk In'}</h3></div><div className="text-sm text-slate-500"><p>Transaction: <b>{order.transactionNumber || '-'}</b></p><p>Cashier: <b>{order.cashier?.name}</b></p>{order.paidAt && <p>Paid: <b>{dt(order.paidAt)}</b></p>}{order.paymentMethod && <p>Payment: <b>{order.paymentMethod}</b></p>}{order.couponCode && <p>Coupon: <b>{order.couponCode}</b></p>}</div></div>
        {order.items.map((i: any) => <div className="border-t py-3 text-sm" key={i.id}><div className="flex justify-between gap-4"><div><b>{i.qty}x {i.productName}</b><p className="text-slate-400">{i.variantName}</p>{i.addons?.map((a: any) => <p className="text-slate-400" key={a.id}>+ {a.addonName}</p>)}{i.itemNote && <p className="mt-1 font-bold text-amber-700">NOTE: {i.itemNote}</p>}{Number(i.discountAmount) > 0 && <p className="text-xs text-brand-600">Diskon item: {rupiah(i.discountAmount)}</p>}</div><span>{rupiah(i.subtotalAfterDiscount)}</span></div></div>)}
        <div className="mt-5 space-y-1 border-t pt-4 text-right"><p>Product discount: {rupiah(order.productDiscountTotal)}</p><p>Transaction discount: {rupiah(order.transactionDiscountAmount)}</p><p>Coupon discount: {rupiah(order.couponDiscountAmount)}</p><p className="text-sm text-slate-400">Total</p><b className="text-2xl text-brand-700">{rupiah(order.grandTotal)}</b></div>
      </div>
      <div className="card p-5"><h3 className="section-title mb-4">Actions</h3>
        {order.status === 'PENDING_PAYMENT' && <button onClick={() => navigate(`/pos?editOrderId=${order.id}`)} className="btn-primary mb-2 w-full">Edit Order</button>}
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

