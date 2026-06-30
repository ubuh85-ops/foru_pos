import { useEffect, useState } from 'react';
import { api, rupiah } from '../api';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const today = () => new Date().toLocaleDateString('en-CA');

export default function ReportsPage() {
  const outletId = localStorage.getItem('outletId') || '';
  const [date, setDate] = useState(today());
  const [d, setD] = useState<any>();
  const [error, setError] = useState('');
  useEffect(() => {
    async function load() {
      try {
        setError('');
        if (!outletId) throw new Error('Silakan pilih outlet terlebih dahulu.');
        setD(await api(`/reports/daily?date=${date}&outletId=${outletId}`));
      } catch (e) { setError((e as Error).message); setD(null); }
    }
    load();
  }, [date, outletId]);
  const rows = [['Gross sales', d?.grossSales || 0], ['Diskon produk', -(d?.productDiscount || 0)], ['Diskon transaksi', -(d?.transactionDiscount || 0)], ['Diskon kupon', -(d?.couponDiscount || 0)], ['Net sales', d?.netSales || 0], ['HPP', -(d?.totalHpp || 0)], ['Gross profit', d?.grossProfit || 0], ['Cash drawer expense', -(d?.cashDrawerExpense || 0)], ['Net cash movement', d?.netCashMovement || 0]];
  return <Page><div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-3xl font-black">Laporan penjualan</h2><p className="text-slate-500">Data Outlet Aktif</p></div><input className="input sm:w-48" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>{error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="grid gap-5 lg:grid-cols-2"><div className="card p-6"><h3 className="section-title mb-4">Rekonsiliasi</h3>{rows.map(([x, n], i) => <div key={x as string} className={`flex justify-between py-3 ${i === 4 || i === 6 || i === 8 ? 'border-t text-lg font-black' : 'text-slate-600'}`}><span>{x as string}</span><span className="money">{rupiah(n as number)}</span></div>)}</div><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">{Object.entries(d?.payments || {}).map(([m, n]) => <div className="card p-5" key={m}><p className="text-sm font-bold text-slate-400">{m}</p><b className="mt-2 block text-xl">{rupiah(n as number)}</b></div>)}</div><div className="card p-5"><h3 className="section-title mb-3">Pengeluaran</h3><div className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-slate-400">Cash drawer</p><b>{rupiah(d?.cashDrawerExpense || 0)}</b></div><div><p className="text-xs text-slate-400">Non cash</p><b>{rupiah(d?.nonCashExpense || 0)}</b></div><div><p className="text-xs text-slate-400">Owner transfer</p><b>{rupiah(d?.ownerTransferExpense || 0)}</b></div></div><div className="mt-4 border-t pt-3">{d?.expenseByCategory?.map((x: any) => <div key={x.category} className="flex justify-between py-1 text-sm"><span>{x.category}</span><b>{rupiah(x.amount)}</b></div>)}</div></div></div></div></Page>;
}
