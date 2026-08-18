import { useEffect, useState } from 'react';
import { ArrowUpRight, ReceiptText, TrendingUp, Wallet } from 'lucide-react';
import { api, rupiah } from '../api';
import { useOutlet } from '../OutletContext';

const Page = ({ children }: { children: any }) => <div className="p-3 md:p-4 xl:p-6">{children}</div>;
const Loading = () => <div className="p-10 text-center text-slate-400">Memuat data...</div>;

export default function DashboardPage() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const { selectedOutletId: outletId } = useOutlet();
  const canViewDashboard = user?.role === 'OWNER' || (user?.inventoryPermissions || []).includes('dashboard.view');
  const [mode, setMode] = useState<'outlet' | 'all'>('outlet');
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'OWNER' && mode === 'all') setMode('outlet');
  }, [mode, user?.role]);

  useEffect(() => {
    if (!canViewDashboard) return;
    async function load() {
      try {
        setError('');
        if (user?.role !== 'OWNER' && mode === 'all') return;
        if (mode === 'outlet' && !outletId) throw new Error('Silakan pilih outlet terlebih dahulu.');
        const url = mode === 'all' ? '/dashboard/consolidated' : `/dashboard?outletId=${outletId}`;
        setData(await api(url));
      } catch (e) {
        setError((e as Error).message);
        setData(null);
      }
    }
    load();
  }, [canViewDashboard, mode, outletId]);

  if (!canViewDashboard) return <Page><div className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">Anda tidak memiliki akses ke Dashboard.</div></Page>;
  if (!data && !error) return <Loading />;
  const cards = [['Omset hari ini', data?.netSales || 0, TrendingUp], ['Transaksi', data?.totalTransactions || 0, ReceiptText], ['Average ticket', data?.averageTicket || 0, Wallet], ['Gross profit', data?.grossProfit || 0, ArrowUpRight]];
  return <Page>
    <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
      <div><h2 className="text-xl font-black md:text-2xl xl:text-3xl">Ringkasan hari ini</h2><p className="text-xs text-slate-500 md:text-sm">Data: {mode === 'all' ? 'Semua Outlet' : 'Outlet Aktif'}</p></div>
      {user?.role === 'OWNER' && <div className="flex rounded-2xl bg-white p-1 shadow-sm ring-1 ring-black/5"><button onClick={() => setMode('outlet')} className={`rounded-xl px-3 py-2 text-xs font-black ${mode === 'outlet' ? 'bg-brand-500 text-white' : 'text-slate-500'}`}>Outlet Aktif</button><button onClick={() => setMode('all')} className={`rounded-xl px-3 py-2 text-xs font-black ${mode === 'all' ? 'bg-brand-500 text-white' : 'text-slate-500'}`}>Semua Outlet</button></div>}
    </div>
    {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4 xl:gap-3">{cards.map(([l, v, I], i) => <div className="card p-3 xl:p-4" key={l as string}><div className="mb-2 flex items-start justify-between gap-2"><span className="text-xs font-semibold leading-tight text-slate-500 xl:text-sm">{l as string}</span><span className="rounded-xl bg-brand-50 p-1.5 text-brand-600"><I size={15} /></span></div><b className="money text-lg leading-tight xl:text-xl">{i === 1 ? String(v) : rupiah(v as number)}</b></div>)}</div>
    <div className="mt-3 grid gap-3 xl:grid-cols-3"><div className="card p-3 xl:col-span-2 xl:p-4"><h3 className="section-title mb-2 text-base xl:mb-3">Performa outlet</h3>{data?.outlets?.length ? <div className="overflow-auto"><table className="w-full text-left text-xs xl:text-sm"><thead><tr><th className="p-2">Outlet</th><th>Net sales</th><th>Transaksi</th><th>Profit</th></tr></thead><tbody>{data.outlets.map((x: any) => <tr className="border-t" key={x.outlet}><td className="py-2 font-bold">{x.outlet}</td><td>{rupiah(x.netSales)}</td><td>{x.transactions}</td><td className="text-brand-700">{rupiah(x.grossProfit)}</td></tr>)}</tbody></table></div> : <div className="p-3 text-center text-sm text-slate-400">Belum ada data.</div>}</div><div className="card bg-brand-700 p-3 text-white xl:p-4"><p className="text-xs text-white/70 xl:text-sm">Gross margin</p><b className="mt-2 block text-3xl xl:text-4xl">{data?.grossMargin || 0}%</b><p className="mt-2 text-xs text-white/70 xl:text-sm">Net sales setelah seluruh diskon dikurangi HPP.</p></div></div>
  </Page>;
}
