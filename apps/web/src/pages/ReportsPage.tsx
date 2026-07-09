import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Filter, Layers3, PackageSearch, Percent, ReceiptText, TrendingUp } from 'lucide-react';
import { api, rupiah } from '../api';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const today = () => new Date().toLocaleDateString('en-CA');
const iso = (d: Date) => d.toLocaleDateString('en-CA');

function rangeOf(type: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (type === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (type === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  }
  if (type === 'month') start.setDate(1);
  return { from: iso(start), to: iso(end) };
}

function money(n: any) { return rupiah(Number(n || 0)); }
function pct(n: any) { return `${Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`; }

export default function ReportsPage() {
  const outletId = localStorage.getItem('outletId') || '';
  const [tab, setTab] = useState<'sales' | 'cogs'>('sales');
  const [quick, setQuick] = useState('today');
  const initial = rangeOf('today');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filteredProducts = useMemo(() => categoryId ? products.filter(p => p.categoryId === categoryId) : products, [products, categoryId]);

  useEffect(() => {
    api<any[]>('/categories').then(rows => setCategories(rows.filter(x => x.status !== 'INACTIVE'))).catch(() => {});
    api<any[]>('/products').then(rows => setProducts(rows.filter(x => x.status !== 'INACTIVE'))).catch(() => {});
  }, []);

  useEffect(() => {
    if (productId && !filteredProducts.some(p => p.id === productId)) setProductId('');
  }, [categoryId, filteredProducts, productId]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setError('');
        if (!outletId) throw new Error('Silakan pilih outlet terlebih dahulu.');
        const p = new URLSearchParams({ outletId, from, to });
        if (categoryId) p.set('categoryId', categoryId);
        if (productId) p.set('productId', productId);
        if (tab === 'sales' && paymentMethod) p.set('paymentMethod', paymentMethod);
        const result = await api(`/reports/${tab}?${p.toString()}`);
        if (active) setData(result);
      } catch (e) {
        if (active) { setError((e as Error).message); setData(null); }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [outletId, from, to, categoryId, productId, paymentMethod, tab]);

  function applyQuick(type: string) {
    const r = rangeOf(type);
    setQuick(type);
    setFrom(r.from);
    setTo(r.to);
  }

  const salesSummary = data?.summary || {};
  const summaryCards = tab === 'sales'
    ? [
      ['Total Order', salesSummary.totalOrder || 0, ReceiptText, false],
      ['Total Item Terjual', salesSummary.totalItemSold || 0, PackageSearch, false],
      ['Gross Sales', salesSummary.grossSales || 0, BarChart3, true],
      ['Discount', salesSummary.discount || 0, Percent, true],
      ['Net Sales', salesSummary.netSales || 0, TrendingUp, true],
      ['Average Order Value', salesSummary.averageOrderValue || 0, ReceiptText, true],
      ['Top Selling Product', salesSummary.topSellingProduct ? `${salesSummary.topSellingProduct.productName} (${salesSummary.topSellingProduct.qty})` : '-', PackageSearch, false],
      ['Top Category', salesSummary.topCategory ? `${salesSummary.topCategory.category} (${salesSummary.topCategory.qty})` : '-', Layers3, false]
    ]
    : [
      ['Net Sales', salesSummary.netSales || 0, TrendingUp, true],
      ['Total COGS / HPP', salesSummary.totalCogs || 0, ReceiptText, true],
      ['Gross Profit', salesSummary.grossProfit || 0, BarChart3, true],
      ['Gross Margin', pct(salesSummary.grossMarginPercent), Percent, false],
      ['Total Item Sold', salesSummary.totalItemSold || 0, PackageSearch, false]
    ];

  return <Page>
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 className="text-4xl font-black tracking-tight text-ink">Reports</h2>
        <p className="mt-1 text-slate-500">Laporan outlet aktif. Hanya transaksi PAID yang dihitung.</p>
      </div>
      <button onClick={() => setFiltersOpen(v => !v)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-pink-50 px-5 py-3 font-black text-pink-600 ring-1 ring-pink-100 lg:hidden"><Filter size={20} /> Saring</button>
    </div>

    <div className="mb-5 flex gap-2 overflow-auto pb-1">
      <button onClick={() => setTab('sales')} className={`shrink-0 rounded-full px-5 py-3 text-sm font-black ${tab === 'sales' ? 'bg-ink text-white' : 'bg-white text-slate-600 shadow-sm ring-1 ring-black/5'}`}>Laporan Penjualan</button>
      <button onClick={() => setTab('cogs')} className={`shrink-0 rounded-full px-5 py-3 text-sm font-black ${tab === 'cogs' ? 'bg-ink text-white' : 'bg-white text-slate-600 shadow-sm ring-1 ring-black/5'}`}>Laporan COGS</button>
    </div>

    <div className={`${filtersOpen ? 'block' : 'hidden'} mb-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 lg:block`}>
      <div className="mb-3 flex gap-2 overflow-auto">
        {[
          ['today', 'Hari ini'],
          ['yesterday', 'Kemarin'],
          ['week', 'Minggu ini'],
          ['month', 'Bulan ini']
        ].map(([k, label]) => <button key={k} onClick={() => applyQuick(k)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${quick === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{label}</button>)}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label className="block"><span className="label">Tanggal mulai</span><input className="input" type="date" value={from} onChange={e => { setQuick('custom'); setFrom(e.target.value); }} /></label>
        <label className="block"><span className="label">Tanggal akhir</span><input className="input" type="date" value={to} onChange={e => { setQuick('custom'); setTo(e.target.value); }} /></label>
        <label className="block"><span className="label">Category</span><select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Semua kategori</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block"><span className="label">Product</span><select className="input" value={productId} onChange={e => setProductId(e.target.value)}><option value="">Semua produk</option>{filteredProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {tab === 'sales' && <label className="block"><span className="label">Payment</span><select className="input" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="">Semua metode</option>{['CASH', 'QRIS', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD', 'VOUCHER'].map(x => <option key={x} value={x}>{x}</option>)}</select></label>}
        <div className="flex items-end"><div className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm font-black text-brand-700"><CalendarDays size={18} /> Outlet aktif</div></div>
      </div>
    </div>

    {error && <div className="mb-4 rounded-2xl bg-red-50 p-4 text-red-700">{error}</div>}
    {loading && <div className="mb-4 rounded-2xl bg-white p-4 text-slate-500 shadow-sm ring-1 ring-black/5">Memuat laporan...</div>}

    <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4 2xl:grid-cols-5">
      {summaryCards.map(([label, value, Icon, isMoney]) => <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5" key={String(label)}>
        <div className="mb-3 flex items-start justify-between gap-3"><p className="text-sm font-black text-slate-500">{String(label)}</p><span className="rounded-2xl bg-brand-50 p-2 text-brand-700"><Icon size={18} /></span></div>
        <b className="block break-words text-xl text-ink">{isMoney ? money(value) : String(value)}</b>
      </div>)}
    </div>

    {tab === 'sales' ? <SalesTables data={data} /> : <CogsTables data={data} />}
  </Page>;
}

function SalesTables({ data }: { data: any }) {
  return <div className="grid gap-5 xl:grid-cols-2">
    <ReportSection title="By Category" rows={data?.byCategory || []} columns={['Category', 'Qty Sold', 'Gross Sales', 'Discount', 'Net Sales', 'Order Count']} renderRow={(r: any) => [r.category, r.qtySold, money(r.grossSales), money(r.discount), money(r.netSales), r.orderCount]} />
    <ReportSection title="Detail Product" rows={data?.byProduct || []} columns={['Product', 'Category', 'Variant / Option', 'Qty Sold', 'Gross Sales', 'Discount', 'Net Sales']} renderRow={(r: any) => [r.productName, r.category, r.variant, r.qtySold, money(r.grossSales), money(r.discount), money(r.netSales)]} />
  </div>;
}

function CogsTables({ data }: { data: any }) {
  return <div className="grid gap-5 xl:grid-cols-2">
    <ReportSection title="COGS by Category" rows={data?.byCategory || []} columns={['Category', 'Qty Sold', 'Net Sales', 'COGS', 'Gross Profit', 'Gross Margin %']} renderRow={(r: any) => [r.category, r.qtySold, money(r.netSales), money(r.cogs), money(r.grossProfit), pct(r.grossMarginPercent)]} />
    <ReportSection title="COGS by Product" rows={data?.byProduct || []} columns={['Product', 'Category', 'Variant / Option', 'Qty Sold', 'Net Sales', 'Unit HPP', 'Total COGS', 'Gross Profit', 'Gross Margin %']} renderRow={(r: any) => [r.productName, r.category, r.variant, r.qtySold, money(r.netSales), money(r.unitHpp), money(r.cogs), money(r.grossProfit), pct(r.grossMarginPercent)]} />
  </div>;
}

function ReportSection({ title, rows, columns, renderRow }: { title: string; rows: any[]; columns: string[]; renderRow: (row: any) => any[] }) {
  return <section className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
    <div className="border-b p-4"><h3 className="text-lg font-black text-ink">{title}</h3></div>
    <div className="hidden overflow-auto lg:block">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-slate-500"><tr>{columns.map(c => <th className="p-4" key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr className="border-t" key={i}>{renderRow(r).map((v, idx) => <td className={`p-4 ${idx === 0 ? 'font-black text-ink' : ''}`} key={idx}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-3 p-4 lg:hidden">
      {rows.map((r, i) => {
        const values = renderRow(r);
        return <div className="rounded-2xl border p-4" key={i}>
          <b className="block text-ink">{values[0]}</b>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">{columns.slice(1).map((c, idx) => <div key={c}><p className="text-xs font-bold text-slate-400">{c}</p><p className="font-bold">{values[idx + 1]}</p></div>)}</div>
        </div>;
      })}
    </div>
    {!rows.length && <div className="p-8 text-center text-slate-400">Belum ada data pada periode ini.</div>}
  </section>;
}
