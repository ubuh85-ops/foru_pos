import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt, rupiah } from '../api';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const today = () => new Date().toLocaleDateString('en-CA');

export default function SalesHistoryPage() {
  const outletId = localStorage.getItem('outletId') || '';
  const [data, setData] = useState<any[]>([]);
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  useEffect(() => {
    async function load() {
      try {
        setError('');
        if (!outletId) throw new Error('Silakan pilih outlet terlebih dahulu.');
        setData(await api<any[]>(`/sales?date=${date}&outletId=${outletId}`));
      } catch (e) { setError((e as Error).message); setData([]); }
    }
    load();
  }, [date, outletId]);
  return <Page><div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-3xl font-black">Riwayat transaksi</h2><p className="text-slate-500">Data Outlet Aktif.</p></div><input className="input sm:w-48" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>{error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="card overflow-hidden"><div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['No. Transaksi','Customer','Waktu','Outlet','Kasir','Pembayaran','Total','Status',''].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{data.map(s => <tr className="border-t" key={s.id}><td className="p-4 font-bold">{s.transactionNumber}</td><td className="font-bold">{s.customerName || 'Walk In'}</td><td>{dt(s.createdAt)}</td><td>{s.outlet.name}</td><td>{s.cashier.name}</td><td>{s.paymentMethod}</td><td className="font-bold">{rupiah(s.grandTotal)}</td><td><span className={`pill ${s.status === 'COMPLETED' || s.status === 'PAID' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>{s.status}</span></td><td><Link className="font-bold text-brand-600" to={`/sales/${s.id}`}>Detail</Link></td></tr>)}</tbody></table></div>{!data.length && <div className="p-8 text-center text-slate-400">Belum ada transaksi.</div>}</div></Page>;
}
