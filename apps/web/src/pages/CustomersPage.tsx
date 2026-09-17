import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Search, Store, UserRound, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, dt, rupiah } from '../api';
import { useOutlet } from '../OutletContext';

type CustomerRow = {
  id: string;
  name: string;
  phoneNormalized: string;
  phoneDisplay?: string | null;
  source: string;
  status: string;
  lastOrderAt: string;
  lastOutlet?: { id: string; name: string } | null;
  totalOrders: number;
  paidOrders: number;
  totalSpent: number;
};

type CustomerList = { items: CustomerRow[]; total: number; page: number; pageSize: number; totalPages: number };
type CustomerOrder = {
  id: string;
  orderNumber?: string | null;
  transactionNumber?: string | null;
  orderSource: string;
  orderType: string;
  status: string;
  grandTotal: number;
  createdAt: string;
  scheduledAt?: string | null;
  outlet: { id: string; name: string; code: string };
  items: Array<{ id: string; productName: string; variantName: string; qty: number; subtotalAfterDiscount: number }>;
};
type CustomerDetail = CustomerRow & {
  marketingConsent: boolean;
  createdAt: string;
  summary: { totalOrders: number; paidOrders: number; totalSpent: number; firstOrderAt?: string | null; lastOrderAt?: string | null };
  orders: CustomerOrder[];
};

const Page = ({ children }: { children: React.ReactNode }) => <div className="mx-auto max-w-7xl p-4 lg:p-8">{children}</div>;

function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

function statusClass(status: string) {
  if (['PAID', 'COMPLETED'].includes(status)) return 'bg-green-50 text-green-700';
  if (['REJECTED', 'CANCELLED', 'VOID'].includes(status)) return 'bg-red-50 text-red-700';
  return 'bg-amber-50 text-amber-700';
}

export default function CustomersPage() {
  const { outletList } = useOutlet();
  const [query, setQuery] = useState('');
  const [outletId, setOutletId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerList>({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError('');
        const params = new URLSearchParams({ page: String(page), pageSize: '20' });
        if (query.trim()) params.set('q', query.trim());
        if (outletId) params.set('outletId', outletId);
        setData(await api<CustomerList>(`/customers?${params}`));
      } catch (e) {
        setError((e as Error).message);
        setData(current => ({ ...current, items: [], total: 0 }));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [outletId, page, query]);

  return <Page>
    <div className="mb-6">
      <p className="text-sm font-black uppercase tracking-wider text-brand-700">Database pelanggan</p>
      <h1 className="text-3xl font-black sm:text-4xl">Pelanggan</h1>
      <p className="mt-1 text-slate-500">Pelanggan yang melakukan pemesanan melalui Web Order.</p>
    </div>

    <div className="card mb-5 grid gap-3 p-4 md:grid-cols-[1fr_18rem]">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input type="search" className="input pl-12" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Cari nama atau nomor WhatsApp..." />
      </label>
      <select className="input" value={outletId} onChange={event => { setOutletId(event.target.value); setPage(1); }}>
        <option value="">Semua outlet</option>
        {outletList.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
      </select>
    </div>

    {error && <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</div>}
    <div className="mb-3 flex items-center justify-between text-sm text-slate-500"><span>{loading ? 'Memuat pelanggan...' : `${data.total} pelanggan`}</span><span>Halaman {data.page} dari {data.totalPages}</span></div>

    <div className="grid gap-3 md:hidden">
      {data.items.map(customer => <Link to={`/customers/${customer.id}`} className="card p-4" key={customer.id}>
        <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700"><UserRound size={22} /></span><div className="min-w-0"><h2 className="truncate font-black">{customer.name}</h2><p className="text-sm text-slate-500">{customer.phoneNormalized}</p></div></div><ChevronRight className="shrink-0 text-slate-400" /></div>
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm"><div><span className="block text-slate-500">Order</span><b>{customer.totalOrders}</b></div><div><span className="block text-slate-500">Total transaksi</span><b>{rupiah(customer.totalSpent)}</b></div></div>
        <p className="mt-3 truncate text-xs text-slate-500">Terakhir: {dt(customer.lastOrderAt)}{customer.lastOutlet ? ` · ${customer.lastOutlet.name}` : ''}</p>
      </Link>)}
    </div>

    <div className="card hidden overflow-hidden md:block">
      <div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr>{['Pelanggan','Order','Order dibayar','Total transaksi','Outlet terakhir','Terakhir order',''].map(label => <th className="p-4" key={label}>{label}</th>)}</tr></thead><tbody>{data.items.map(customer => <tr className="border-t" key={customer.id}><td className="p-4"><b className="block">{customer.name}</b><span className="text-slate-500">{customer.phoneNormalized}</span></td><td>{customer.totalOrders}</td><td>{customer.paidOrders}</td><td className="money">{rupiah(customer.totalSpent)}</td><td>{customer.lastOutlet?.name || '-'}</td><td>{dt(customer.lastOrderAt)}</td><td className="pr-4 text-right"><Link className="font-bold text-brand-700" to={`/customers/${customer.id}`}>Detail</Link></td></tr>)}</tbody></table></div>
    </div>

    {!loading && !data.items.length && !error && <div className="card p-10 text-center"><Users className="mx-auto mb-3 text-slate-300" size={42} /><h2 className="font-black">Pelanggan belum ditemukan</h2><p className="text-sm text-slate-500">Data akan muncul setelah customer mengirim Web Order.</p></div>}
    <div className="mt-5 flex justify-end gap-2"><button className="btn-soft" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Sebelumnya</button><button className="btn-soft" disabled={page >= data.totalPages || loading} onClick={() => setPage(value => value + 1)}>Berikutnya</button></div>
  </Page>;
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    api<CustomerDetail>(`/customers/${id}`).then(setCustomer).catch(e => setError((e as Error).message));
  }, [id]);

  if (error) return <Page><Link to="/customers" className="mb-5 inline-flex items-center gap-2 font-bold text-brand-700"><ChevronLeft size={18} />Kembali</Link><div className="rounded-xl bg-red-50 p-4 text-red-700">{error}</div></Page>;
  if (!customer) return <Page><p className="text-slate-500">Memuat data pelanggan...</p></Page>;

  return <Page>
    <Link to="/customers" className="mb-5 inline-flex items-center gap-2 font-bold text-brand-700"><ChevronLeft size={18} />Daftar pelanggan</Link>
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-sm font-black uppercase tracking-wider text-brand-700">Detail pelanggan</p><h1 className="text-3xl font-black sm:text-4xl">{customer.name}</h1><p className="mt-1 text-slate-500">{customer.phoneNormalized}</p></div><a className="btn-primary" href={waLink(customer.phoneNormalized)} target="_blank" rel="noreferrer"><MessageCircle size={18} />WhatsApp</a></div>
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Summary icon={<Users size={20} />} label="Total order" value={String(customer.summary.totalOrders)} />
      <Summary icon={<UserRound size={20} />} label="Order dibayar" value={String(customer.summary.paidOrders)} />
      <Summary icon={<Store size={20} />} label="Total transaksi" value={rupiah(customer.summary.totalSpent)} />
      <Summary icon={<CalendarDays size={20} />} label="Order terakhir" value={customer.summary.lastOrderAt ? dt(customer.summary.lastOrderAt) : '-'} />
    </div>
    <div className="mb-3"><h2 className="text-xl font-black">Riwayat order</h2><p className="text-sm text-slate-500">Maksimal 100 order terbaru.</p></div>
    <div className="grid gap-3">
      {customer.orders.map(order => <Link to={`/orders/${order.id}`} key={order.id} className="card p-4 hover:border-brand-200"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><div className="flex flex-wrap items-center gap-2"><b>{order.transactionNumber || order.orderNumber || 'Order'}</b><span className={`pill ${statusClass(order.status)}`}>{order.status}</span></div><p className="mt-1 text-sm text-slate-500">{dt(order.createdAt)} · {order.outlet.name} · {order.orderType.replaceAll('_', ' ')}</p><p className="mt-2 text-sm">{order.items.map(item => `${item.qty}x ${item.productName}`).join(', ')}</p></div><div className="shrink-0 text-left sm:text-right"><b className="money text-lg text-brand-700">{rupiah(order.grandTotal)}</b><p className="text-xs text-slate-500">{order.orderSource === 'CUSTOMER_WEB' ? 'Web Order' : order.orderSource}</p></div></div></Link>)}
      {!customer.orders.length && <div className="card p-8 text-center text-slate-400">Belum ada riwayat order yang dapat diakses.</div>}
    </div>
  </Page>;
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="card min-w-0 p-4"><span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">{icon}</span><span className="block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span><b className="mt-1 block break-words text-lg">{value}</b></div>;
}
