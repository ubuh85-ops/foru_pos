import { useEffect, useState } from 'react';
import { ArrowUpRight, ReceiptText, TrendingUp, Wallet } from 'lucide-react';
import { api, rupiah } from '../api';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Loading = () => <div className="p-10 text-center text-slate-400">Memuat data...</div>;

export default function DashboardPage() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const outletId = localStorage.getItem('outletId') || '';
  const [mode, setMode] = useState<'outlet' | 'all'>('outlet');
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setError('');
        if (mode === 'outlet' && !outletId) throw new Error('Silakan pilih outlet terlebih dahulu.');
        const url = mode === 'all' ? '/dashboard/consolidated' : `/dashboard?outletId=${outletId}`;
        setData(await api(url));
      } catch (e) {
        setError((e as Error).message);
        setData(null);
      }
    }
    load();
  }, [mode, outletId]);

  if (!data && !error) return <Loading />;
  const cards = [['Omset hari ini', data?.netSales || 0, TrendingUp], ['Transaksi', data?.totalTransactions || 0, ReceiptText], ['Average ticket', data?.averageTicket || 0, Wallet], ['Gross profit', data?.grossProfit || 0, ArrowUpRight]];
  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><h2 className="text-3xl font-black">Ringkasan hari ini</h2><p className="text-slate-500">Data: {mode === 'all' ? 'Semua Outlet' : 'Outlet Aktif'}</p></div>
      {user?.role === 'OWNER' && <div className="flex rounded-2xl bg-white p-1 shadow-sm ring-1 ring-black/5"><button onClick={() => setMode('outlet')} className={`rounded-xl px-4 py-2 text-sm font-black ${mode === 'outlet' ? 'bg-ink text-white' : 'text-slate-500'}`}>Outlet Aktif</button><button onClick={() => setMode('all')} className={`rounded-xl px-4 py-2 text-sm font-black ${mode === 'all' ? 'bg-ink text-white' : 'text-slate-500'}`}>Semua Outlet</button></div>}
    </div>
    {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([l, v, I], i) => <div className="card p-5" key={l as string}><div className="mb-5 flex justify-between"><span className="text-sm font-semibold text-slate-500">{l as string}</span><span className="rounded-xl bg-brand-50 p-2 text-brand-600"><I size={19} /></span></div><b className="money text-2xl">{i === 1 ? String(v) : rupiah(v as number)}</b></div>)}</div>
    <div className="mt-6 grid gap-5 xl:grid-cols-3"><div className="card p-5 xl:col-span-2"><h3 className="section-title mb-5">Performa outlet</h3>{data?.outlets?.length ? <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="pb-3">Outlet</th><th>Net sales</th><th>Transaksi</th><th>Profit</th></tr></thead><tbody>{data.outlets.map((x: any) => <tr className="border-t" key={x.outlet}><td className="py-4 font-bold">{x.outlet}</td><td>{rupiah(x.netSales)}</td><td>{x.transactions}</td><td className="text-brand-700">{rupiah(x.grossProfit)}</td></tr>)}</tbody></table></div> : <div className="p-6 text-center text-slate-400">Belum ada data.</div>}</div><div className="card bg-ink p-5 text-white"><p className="text-sm text-white/50">Gross margin</p><b className="mt-4 block text-5xl">{data?.grossMargin || 0}%</b><p className="mt-5 text-sm text-white/50">Net sales setelah seluruh diskon dikurangi HPP.</p></div></div>
  </Page>;
}
