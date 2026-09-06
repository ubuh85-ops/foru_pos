import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '../api';

type Metrics = { uniqueVisitors: number; pageViews: number; addToCart: number; orders: number; conversionRate: number; visitorToCart: number; cartToOrder: number };
type Report = Metrics & {
  outlets: { id: string; name: string }[];
  outletComparison: (Metrics & { id: string; name: string })[];
  trafficSources: (Metrics & { source: string })[];
};
const number = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const percent = (value: number) => `${number(value)}%`;
function presetRange(preset: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = new Date(`${today}T00:00:00Z`), end = new Date(start);
  if (preset === 'yesterday') { start.setUTCDate(start.getUTCDate() - 1); end.setUTCDate(end.getUTCDate() - 1); }
  if (preset === 'last7') start.setUTCDate(start.getUTCDate() - 6);
  if (preset === 'month') start.setUTCDate(1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
export default function WebAnalyticsPage() {
  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(() => presetRange('today'));
  const [outletId, setOutletId] = useState('');
  const [outlets, setOutlets] = useState<Report['outlets']>([]);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    if (!range.startDate || !range.endDate || range.startDate > range.endDate) {
      setError('Pilih rentang tanggal yang valid.'); setLoading(false); return;
    }
    setLoading(true); setError('');
    const query = new URLSearchParams({ ...range, ...(outletId ? { outletId } : {}) });
    api<Report>(`/admin/web-analytics?${query}`).then(result => {
      if (active) { setData(result); setOutlets(result.outlets); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Gagal memuat analytics'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.startDate, range.endDate, outletId, refresh]);

  return <div className="p-4 lg:p-8">
    <h1 className="flex items-center gap-2 text-2xl font-black"><BarChart3 /> Web Analytics</h1>
    <p className="mt-1 text-sm text-slate-500">Traffic dan konversi Web Order • Periode dalam WIB (Asia/Jakarta)</p>
    <div className="my-6 grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-sm font-bold">Periode<select className="input mt-1" value={preset} onChange={event => { const value = event.target.value; setPreset(value); if (value !== 'custom') setRange(presetRange(value)); }}>
        <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="last7">Last 7 Days</option><option value="month">This Month</option><option value="custom">Custom</option>
      </select></label>
      <label className="text-sm font-bold">Dari<input className="input mt-1" type="date" value={range.startDate} onChange={event => { setPreset('custom'); setRange({ ...range, startDate: event.target.value }); }} /></label>
      <label className="text-sm font-bold">Sampai<input className="input mt-1" type="date" value={range.endDate} onChange={event => { setPreset('custom'); setRange({ ...range, endDate: event.target.value }); }} /></label>
      <label className="text-sm font-bold">Outlet<select className="input mt-1" value={outletId} onChange={event => setOutletId(event.target.value)}><option value="">All Outlets</option>{outlets.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
      <button className="btn btn-primary self-end" onClick={() => setRefresh(value => value + 1)} disabled={loading}>Muat ulang</button>
    </div>
    {error && <div role="alert" className="rounded-2xl bg-red-50 p-4 text-red-700">{error}</div>}
    {loading && <p role="status" className="p-8 text-center text-slate-500">Memuat analytics...</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[
        ['Unique Visitors', number(data.uniqueVisitors)], ['Page Views', number(data.pageViews)], ['Add to Cart', number(data.addToCart)], ['Orders', number(data.orders)], ['Conversion Rate', percent(data.conversionRate)],
      ].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-brand-700">{value}</p></div>)}</div>
      {!data.uniqueVisitors && <p className="mt-4 rounded-2xl bg-slate-100 p-4">Belum ada aktivitas Web Order pada periode ini.</p>}
      <section className="mt-6 rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Funnel</h2>
        <div className="my-4 grid gap-3 sm:grid-cols-3">{[['Visitors', data.uniqueVisitors], ['Add to Cart', data.addToCart], ['Orders', data.orders]].map(([label, value], index) => <div key={label} className="rounded-xl bg-brand-50 p-4"><p className="text-sm">{index + 1}. {label}</p><b className="text-2xl">{number(Number(value))}</b></div>)}</div>
        <div className="flex flex-wrap gap-4 text-sm"><span>Visitor → Cart: <b>{percent(data.visitorToCart)}</b></span><span>Visitor → Order: <b>{percent(data.conversionRate)}</b></span><span>Cart → Order: <b>{percent(data.cartToOrder)}</b></span></div>
        <p className="mt-3 text-xs text-slate-500">Visitors dihitung unik dari semua event. Cart dan orders adalah jumlah event, sehingga rasio dapat melebihi 100%. Orders dihitung saat pesanan berhasil dibuat, termasuk yang kemudian dibatalkan.</p>
      </section>
      {!outletId && <section className="mt-6 rounded-2xl border bg-white p-5"><h2 className="mb-3 text-lg font-black">Outlet Comparison</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Outlet', 'Visitors', 'Page Views', 'Add to Cart', 'Orders', 'Conversion'].map(label => <th className="whitespace-nowrap border-b p-3" key={label}>{label}</th>)}</tr></thead><tbody>{data.outletComparison.map(row => <tr key={row.id}><td className="p-3 font-bold">{row.name}</td>{[row.uniqueVisitors, row.pageViews, row.addToCart, row.orders].map((value, index) => <td className="p-3" key={index}>{number(value)}</td>)}<td className="p-3">{percent(row.conversionRate)}</td></tr>)}</tbody></table></div></section>}
      <section className="mt-6 rounded-2xl border bg-white p-5"><h2 className="mb-3 text-lg font-black">Traffic Source</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Source', 'Visitors', 'Orders', 'Conversion'].map(label => <th key={label} className="border-b p-3">{label}</th>)}</tr></thead><tbody>{data.trafficSources.map(row => <tr key={row.source}><td className="p-3 capitalize">{row.source}</td><td className="p-3">{number(row.uniqueVisitors)}</td><td className="p-3">{number(row.orders)}</td><td className="p-3">{percent(row.conversionRate)}</td></tr>)}</tbody></table>{!data.trafficSources.length && <p className="p-3 text-slate-500">Belum ada sumber traffic.</p>}</div></section>
      <p className="mt-4 text-xs text-slate-500">Visitor yang mengunjungi beberapa outlet atau source tetap dihitung sekali pada total. Event order yang tertunda akan dicoba ulang setiap 30 detik.</p>
    </>}
  </div>;
}
