import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, X } from 'lucide-react';
import { api } from '../api';

type ReportType = 'revenue' | 'payment-method';
type Amounts = { totalRevenue: number; orderCount: number; averageOrderValue: number; payments: Record<string, number> };
type DailyReport = {
  month: number; year: number; type: ReportType;
  outlets: { id: string; name: string }[];
  paymentMethods: { id: string; label: string }[];
  rows: (Amounts & { date: string })[];
  totals: Amounts;
  topPaymentMethod: { id: string; label: string; amount: number; percentage: number } | null;
};
type Transactions = {
  date: string; page: number; pageSize: number; total: number; totalPages: number;
  transactions: {
    id: string; createdAt: string; orderNumber: string | null; transactionNumber: string;
    customerName: string | null; orderType: string | null; paymentMethod: string;
    total: number; cashierName: string | null; outletName: string;
  }[];
};
const money = (value: number) => `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
const number = (value: number) => value.toLocaleString('id-ID');
const dayLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const fullDate = (date: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(`${date}T00:00:00+07:00`));
const time = (value: string) => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value));
function currentMonth() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}

export default function DailyReportPage() {
  const [search, setSearch] = useSearchParams();
  const month = search.get('month') ?? currentMonth();
  const outletId = search.get('outletId') || '';
  const type: ReportType = search.get('type') === 'payment-method' ? 'payment-method' : 'revenue';
  const dateParam = search.get('date');
  const selectedDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam.startsWith(`${month}-`) ? dateParam : null;
  function setFilter(key: string, value: string) {
    setSearch(previous => { const next = new URLSearchParams(previous); next.set(key, value); next.delete('date'); return next; }, { replace: true });
  }
  const setMonth = (value: string) => setFilter('month', value);
  const setOutletId = (value: string) => setFilter('outletId', value);
  const setType = (value: ReportType) => setFilter('type', value);
  function setSelectedDate(value: string | null) {
    setSearch(previous => { const next = new URLSearchParams(previous); if (value) next.set('date', value); else next.delete('date'); return next; }, { replace: true });
  }
  const [outlets, setOutlets] = useState<DailyReport['outlets']>([]);
  const [data, setData] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null); setError('');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      setError('Pilih bulan dan tahun yang valid.'); setLoading(false); return;
    }
    setLoading(true);
    const [year, selectedMonth] = month.split('-');
    const query = new URLSearchParams({ year, month: String(Number(selectedMonth)), type, ...(outletId ? { outletId } : {}) });
    api<DailyReport>(`/reports/daily?${query}`).then(result => {
      if (active) { setData(result); setOutlets(result.outlets); }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Gagal memuat report harian.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month, outletId, type, refresh]);

  return <div className="p-4 lg:p-8">
    <h1 className="flex items-center gap-2 text-2xl font-black"><CalendarDays /> Report Harian</h1>
    <p className="mt-1 text-sm text-slate-500">Transaksi PAID berdasarkan tanggal dibuat (WIB / Asia/Jakarta).</p>
    <div className="my-6 grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="min-w-0 text-sm font-bold">Bulan<input type="month" className="input mt-1 min-w-0" value={month} onChange={event => setMonth(event.target.value)} /></label>
      <label className="min-w-0 text-sm font-bold">Outlet<select className="input mt-1" value={outletId} onChange={event => setOutletId(event.target.value)}><option value="">Semua Outlet</option>{outlets.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
      <label className="text-sm font-bold">Jenis Report<select className="input mt-1" value={type} onChange={event => setType(event.target.value as ReportType)}><option value="revenue">Omset</option><option value="payment-method">Metode Pembayaran</option></select></label>
      <button className="btn btn-primary self-end" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Muat ulang</button>
    </div>
    {error && <div role="alert" className="rounded-2xl bg-red-50 p-4 text-red-700">{error}</div>}
    {loading && <p role="status" className="p-8 text-center text-slate-500">Memuat report harian...</p>}
    {data && <>
      <div className={`grid gap-3 sm:grid-cols-2 ${type === 'payment-method' ? 'xl:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {[
          ['Total Omset', money(data.totals.totalRevenue)],
          ['Total Order', number(data.totals.orderCount)],
          ['Average Order Value', money(data.totals.averageOrderValue)],
        ].map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 break-words text-2xl font-black text-brand-700">{value}</p></div>)}
        {type === 'payment-method' && <div className="min-w-0 rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Payment Method terbesar</p><p className="mt-2 break-words text-xl font-black text-brand-700">{data.topPaymentMethod?.label || 'Belum ada pembayaran'}</p>{data.topPaymentMethod && <p className="mt-1 text-sm">{money(data.topPaymentMethod.amount)} · {data.topPaymentMethod.percentage.toLocaleString('id-ID', { maximumFractionDigits: 2 })}% dari total</p>}</div>}
      </div>
      <section className="mt-6 overflow-hidden rounded-2xl border bg-white">
        <div className="p-4"><h2 className="text-lg font-black">{type === 'revenue' ? 'Omset' : 'Metode Pembayaran'} Harian</h2><p id="daily-report-hint" className="mt-1 text-sm text-slate-500">Klik tanggal untuk melihat transaksi pembentuk angka tersebut.</p></div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tabel report harian" aria-describedby="daily-report-hint">
          <table className="w-full min-w-[620px] text-right text-sm tabular-nums">
            <thead><tr className="bg-slate-50"><th scope="col" className="sticky left-0 z-10 border-b bg-slate-50 p-3 text-left">Tanggal</th>{type === 'revenue' ? <><th scope="col" className="whitespace-nowrap border-b p-3">Total Omset</th><th scope="col" className="whitespace-nowrap border-b p-3">Jumlah Order</th><th scope="col" className="whitespace-nowrap border-b p-3">Average Order Value</th></> : <>{data.paymentMethods.map(method => <th scope="col" className="whitespace-nowrap border-b p-3" key={method.id}>{method.label}</th>)}<th scope="col" className="border-b p-3">Total</th></>}</tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.date} onClick={() => setSelectedDate(row.date)} className={`group cursor-pointer border-b last:border-b-0 hover:bg-brand-50 ${selectedDate === row.date ? 'bg-brand-50' : ''}`}>
              <th scope="row" className={`sticky left-0 z-10 p-0 text-left group-hover:bg-brand-50 ${selectedDate === row.date ? 'bg-brand-50' : 'bg-white'}`}><button className="w-full p-3 text-left font-bold text-brand-700 underline decoration-brand-200 underline-offset-4 focus-visible:outline focus-visible:outline-2" aria-label={`Lihat transaksi ${fullDate(row.date)}`} onClick={event => { event.stopPropagation(); setSelectedDate(row.date); }}>{dayLabel(row.date)}</button></th>
              {type === 'revenue' ? <><td className="whitespace-nowrap p-3">{money(row.totalRevenue)}</td><td className="p-3">{number(row.orderCount)}</td><td className="whitespace-nowrap p-3">{money(row.averageOrderValue)}</td></> : <>{data.paymentMethods.map(method => <td key={method.id} className="whitespace-nowrap p-3">{money(row.payments[method.id] || 0)}</td>)}<td className="whitespace-nowrap p-3 font-bold">{money(row.totalRevenue)}</td></>}
            </tr>)}</tbody>
            <tfoot className="border-t-2 border-brand-200 bg-brand-50 font-black"><tr><th scope="row" className="sticky left-0 z-10 bg-brand-50 p-3 text-left">TOTAL</th>{type === 'revenue' ? <><td className="whitespace-nowrap p-3">{money(data.totals.totalRevenue)}</td><td className="p-3">{number(data.totals.orderCount)}</td><td className="whitespace-nowrap p-3">{money(data.totals.averageOrderValue)}</td></> : <>{data.paymentMethods.map(method => <td key={method.id} className="whitespace-nowrap p-3">{money(data.totals.payments[method.id] || 0)}</td>)}<td className="whitespace-nowrap p-3">{money(data.totals.totalRevenue)}</td></>}</tr></tfoot>
          </table>
        </div>
      </section>
      {!data.totals.orderCount && <p className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm">Belum ada transaksi berhasil pada bulan dan outlet ini.</p>}
      <p className="mt-3 text-xs text-slate-500">Omset menggunakan total akhir transaksi PAID. Transaksi void, batal, dan belum dibayar tidak dihitung. Average Order Value total = Total Omset ÷ Total Order.</p>
      {selectedDate && data.rows.some(row => row.date === selectedDate) && <DailyTransactions key={`${selectedDate}:${outletId}:${refresh}`} date={selectedDate} outletId={outletId} onClose={() => setSelectedDate(null)} />}
    </>}
  </div>;
}

function DailyTransactions({ date, outletId, onClose }: { date: string; outletId: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Transactions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null);
    const query = new URLSearchParams({ date, page: String(page), pageSize: '25', ...(outletId ? { outletId } : {}) });
    api<Transactions>(`/reports/daily/transactions?${query}`).then(result => { if (active) setData(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Gagal memuat transaksi.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [date, outletId, page, refresh]);
  return <section className="mt-6 overflow-hidden rounded-2xl border bg-white" aria-label={`Transaksi ${fullDate(date)}`}>
    <div className="flex items-start justify-between gap-3 p-4"><div><h2 ref={heading} tabIndex={-1} className="scroll-mt-20 text-lg font-black">Transaksi {fullDate(date)}</h2><p className="mt-1 text-sm text-slate-500">Waktu dalam WIB. Klik nomor order untuk membuka detail transaksi.</p></div><button className="rounded-xl p-2 hover:bg-slate-100" aria-label="Tutup detail harian" onClick={onClose}><X size={20} /></button></div>
    {loading && <p role="status" className="p-6 text-center text-slate-500">Memuat transaksi...</p>}
    {error && <div role="alert" className="m-4 rounded-xl bg-red-50 p-4 text-red-700">{error}<button className="ml-3 font-bold underline" onClick={() => setRefresh(value => value + 1)}>Coba lagi</button></div>}
    {data && <><div className="overflow-x-auto" role="region" aria-label="Detail transaksi harian" tabIndex={0}><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="bg-slate-50">{['Waktu', 'Order Number', 'Customer', 'Order Type', 'Payment Method', 'Total', 'Kasir', 'Outlet'].map(label => <th scope="col" key={label} className="whitespace-nowrap border-b p-3">{label}</th>)}</tr></thead><tbody>{data.transactions.map(transaction => <tr key={transaction.id} className="border-b last:border-b-0"><td className="whitespace-nowrap p-3">{time(transaction.createdAt)}</td><td className="p-3"><Link className="font-bold text-brand-700 underline underline-offset-4" to={`/sales/${encodeURIComponent(transaction.id)}`}>{transaction.orderNumber || transaction.transactionNumber}</Link></td><td className="p-3">{transaction.customerName || '—'}</td><td className="p-3">{transaction.orderType || '—'}</td><td className="p-3">{transaction.paymentMethod}</td><td className="whitespace-nowrap p-3 text-right tabular-nums">{money(transaction.total)}</td><td className="p-3">{transaction.cashierName || '—'}</td><td className="p-3">{transaction.outletName}</td></tr>)}</tbody></table></div>
      {!data.transactions.length && <p className="p-6 text-center text-slate-500">Tidak ada transaksi berhasil pada tanggal ini.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm"><span>{number(data.total)} transaksi · Halaman {page} dari {Math.max(1, data.totalPages)}</span><div className="flex gap-2"><button className="btn border bg-white disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Sebelumnya</button><button className="btn border bg-white disabled:opacity-40" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Berikutnya</button></div></div>
    </>}
  </section>;
}
