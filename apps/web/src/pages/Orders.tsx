import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Clock3, Eye, Filter, MoreHorizontal, UserRound, X } from 'lucide-react';
import { api, dt, rupiah } from '../api';
import { printWithBluetoothFallback } from '../printer';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Loading = () => <div className="p-10 text-center text-slate-400">Memuat data...</div>;
const Err = ({ v }: { v: string }) => v ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{v}</div> : null;
const Empty = () => <div className="p-10 text-center text-sm text-slate-400">Belum ada data pada periode ini.</div>;
const statusPill = (status: string) => status === 'PAID' ? 'bg-brand-50 text-brand-700' : status === 'PENDING_PAYMENT' ? 'bg-amber-50 text-amber-700' : status === 'VOID' ? 'bg-red-50 text-red-700' : 'bg-slate-100';
const statusMeta = (status: string) => {
  if (status === 'PAID') return { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700', icon: Check };
  if (status === 'PENDING_PAYMENT') return { label: 'Pending', cls: 'bg-amber-50 text-amber-700', icon: Clock3 };
  if (status === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-red-50 text-red-700', icon: X };
  if (status === 'VOID') return { label: 'Void', cls: 'bg-red-50 text-red-700', icon: X };
  return { label: status, cls: 'bg-slate-100 text-slate-600', icon: Clock3 };
};
const itemSummary = (items?: any[]) => (items || []).map(i => `${i.qty} ${i.productName}`);
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
  const outletId = localStorage.getItem('outletId') || '';
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

  async function pay(o: any) {
    try {
      const paymentMethod = prompt('Payment method: CASH, QRIS, GOFOOD, GRABFOOD, SHOPEEFOOD, VOUCHER', 'CASH') || 'CASH';
      const cashReceived = paymentMethod === 'CASH' ? Number(prompt('Cash received', String(o.grandTotal)) || 0) : undefined;
      const active = await api<any>(`/outlets/${o.outletId}/active-shift`);
      await api(`/orders/${o.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod, cashReceived, cashSessionId: active?.id }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function cancel(o: any) {
    try {
      const reason = prompt('Alasan cancel', 'Customer batal') || 'Customer batal';
      await api(`/orders/${o.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function voidOrder(o: any) {
    try {
      const reason = prompt('Alasan void', 'Void transaksi') || 'Void transaksi';
      await api(`/sales/${o.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function print(o: any, type: 'customer-item-list' | 'kitchen-ticket' | 'customer-receipt') {
    try {
      if (type === 'customer-receipt') await api(`/print/customer-receipt/${o.id}`, { method: 'POST' });
      else await api(`/orders/${o.id}/print/${type}`, { method: 'POST' });
      const doc = type === 'customer-receipt' ? await api(`/sales/${o.id}`) : await api(`/orders/${o.id}`);
      await printWithBluetoothFallback(doc, type, type === 'customer-item-list' ? `/customer-item-list/${o.id}` : type === 'customer-receipt' ? `/receipt/${o.id}` : `/kitchen-ticket/${o.id}`);
    } catch (e) { alert((e as Error).message); }
  }

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
              <p className="mt-1 text-sm text-slate-500">{dt(o.createdAt)}</p>
            </div>
          </div>
          {!!items.length && <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
            <div className="space-y-1.5">
              {items.slice(0, 4).map((item, index) => <p key={`${o.id}-item-${index}`} className="truncate text-sm font-semibold text-slate-700">{item}</p>)}
              {items.length > 4 && <p className="text-xs font-bold text-slate-400">+{items.length - 4} item lain</p>}
            </div>
          </div>}
          <div className="mt-5 flex justify-end gap-3">
            <Link aria-label="View order" className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-pink-200 bg-white text-pink-500 shadow-sm" to={`/orders/${o.id}`}>
              <Eye size={20} />
            </Link>
            <details className="relative">
              <summary aria-label="More actions" className="inline-flex h-12 w-12 cursor-pointer list-none items-center justify-center rounded-xl bg-slate-100 text-ink shadow-sm [&::-webkit-details-marker]:hidden">
                <MoreHorizontal size={22} />
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-2xl border border-slate-100 bg-white p-2 text-sm font-bold shadow-xl">
                {o.status === 'PENDING_PAYMENT' && <Link className="block rounded-xl px-3 py-2 text-brand-700 hover:bg-brand-50" to={`/pos?editOrderId=${o.id}`}>Edit</Link>}
                {o.status === 'PENDING_PAYMENT' && <button className="block w-full rounded-xl px-3 py-2 text-left text-brand-700 hover:bg-brand-50" onClick={() => pay(o)}>Pay</button>}
                {o.status === 'PENDING_PAYMENT' && <button className="block w-full rounded-xl px-3 py-2 text-left text-brand-700 hover:bg-brand-50" onClick={() => print(o, 'customer-item-list')}>Item List</button>}
                <button className="block w-full rounded-xl px-3 py-2 text-left text-brand-700 hover:bg-brand-50" onClick={() => print(o, 'kitchen-ticket')}>Kitchen</button>
                {o.status === 'PAID' && <button className="block w-full rounded-xl px-3 py-2 text-left text-brand-700 hover:bg-brand-50" onClick={() => print(o, 'customer-receipt')}>Receipt</button>}
                {o.status === 'PAID' && <button className="block w-full rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50" onClick={() => voidOrder(o)}>Void</button>}
                {o.status === 'PENDING_PAYMENT' && <button className="block w-full rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50" onClick={() => cancel(o)}>Cancel</button>}
              </div>
            </details>
          </div>
        </div>;
      })}
      {!data.length && <Empty />}
    </div>
    <div className="card hidden overflow-hidden lg:block"><div className="overflow-auto"><table className="w-full min-w-[1200px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Order', 'Customer', 'Items', 'Outlet', 'Cashier', 'Time', 'Total', 'Status', 'Actions'].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{data.map(o => <tr className="border-t" key={o.id}><td className="p-4 font-bold">{o.orderNumber || o.transactionNumber}<p className="font-normal text-slate-400">{o.transactionNumber || '-'}</p></td><td className="font-bold">{o.customerName || 'Walk In'}</td><td className="max-w-[220px] p-4 text-xs font-semibold text-slate-500">{itemSummary(o.items).slice(0, 3).map((item, index) => <p className="truncate" key={`${o.id}-desktop-item-${index}`}>{item}</p>)}{itemSummary(o.items).length > 3 && <p className="font-bold text-slate-400">+{itemSummary(o.items).length - 3} item lain</p>}</td><td>{o.outlet.name}</td><td>{o.cashier.name}</td><td>{dt(o.createdAt)}</td><td className="font-bold">{rupiah(o.grandTotal)}</td><td><span className={`pill ${statusPill(o.status)}`}>{o.status}</span></td><td><div className="flex flex-wrap gap-2">
        <Link className="font-bold text-brand-600" to={`/orders/${o.id}`}>View</Link>
        {o.status === 'PENDING_PAYMENT' && <Link className="font-bold text-brand-600" to={`/pos?editOrderId=${o.id}`}>Edit</Link>}
        {o.status === 'PENDING_PAYMENT' && <button className="font-bold text-brand-600" onClick={() => pay(o)}>Pay</button>}
        {o.status === 'PENDING_PAYMENT' && <button className="font-bold text-brand-600" onClick={() => print(o, 'customer-item-list')}>Item List</button>}
        <button className="font-bold text-brand-600" onClick={() => print(o, 'kitchen-ticket')}>Kitchen</button>
        {o.status === 'PAID' && <button className="font-bold text-brand-600" onClick={() => print(o, 'customer-receipt')}>Receipt</button>}
        {o.status === 'PAID' && <button className="font-bold text-red-600" onClick={() => voidOrder(o)}>Void</button>}
        {o.status === 'PENDING_PAYMENT' && <button className="font-bold text-red-600" onClick={() => cancel(o)}>Cancel</button>}
      </div></td></tr>)}</tbody></table></div>{!data.length && <Empty />}</div>
  </Page>;
}

export function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>();
  const [error, setError] = useState('');
  const load = () => api(`/orders/${id}`).then(setOrder).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <Page><Err v={error} /></Page>;
  if (!order) return <Loading />;

  async function pay() {
    try {
      const paymentMethod = prompt('Payment method: CASH, QRIS, GOFOOD, GRABFOOD, SHOPEEFOOD, VOUCHER', 'CASH') || 'CASH';
      const cashReceived = paymentMethod === 'CASH' ? Number(prompt('Cash received', String(order.grandTotal)) || 0) : undefined;
      const active = await api<any>(`/outlets/${order.outletId}/active-shift`);
      const updated = await api<any>(`/orders/${order.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod, cashReceived, cashSessionId: active?.id }) });
      setOrder(updated);
    } catch (e) { alert((e as Error).message); }
  }
  async function cancel() {
    try {
      const reason = prompt('Alasan cancel', 'Customer batal') || 'Customer batal';
      await api(`/orders/${order.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function voidOrder() {
    try {
      const reason = prompt('Alasan void', 'Void transaksi') || 'Void transaksi';
      await api(`/sales/${order.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function print(type: 'customer-item-list' | 'kitchen-ticket' | 'customer-receipt') {
    if (type === 'customer-receipt') await api(`/print/customer-receipt/${order.id}`, { method: 'POST' });
    else await api(`/orders/${order.id}/print/${type}`, { method: 'POST' });
    await printWithBluetoothFallback(order, type, type === 'customer-item-list' ? `/customer-item-list/${order.id}` : type === 'customer-receipt' ? `/receipt/${order.id}` : `/kitchen-ticket/${order.id}`);
    load();
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
        {order.status === 'PENDING_PAYMENT' && <button onClick={pay} className="btn-soft mb-2 w-full">Pay</button>}
        {order.status === 'PENDING_PAYMENT' && <button onClick={() => print('customer-item-list')} className="btn-soft mb-2 w-full">Customer Item List</button>}
        <button onClick={() => print('kitchen-ticket')} className="btn-soft mb-2 w-full">Kitchen Ticket</button>
        {order.status === 'PAID' && <button onClick={() => print('customer-receipt')} className="btn-soft mb-2 w-full">Print Receipt</button>}
        {order.status === 'PAID' && <button onClick={voidOrder} className="w-full rounded-xl bg-red-50 px-4 py-3 font-bold text-red-700">Void Transaction</button>}
        {order.status === 'PENDING_PAYMENT' && <button onClick={cancel} className="mt-2 w-full rounded-xl bg-red-50 px-4 py-3 font-bold text-red-700">Cancel Order</button>}
      </div>
    </div>
  </Page>;
}
