import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Power, Printer, Store } from 'lucide-react';
import { api, dt, rupiah } from '../api';
import { printShiftCloseReport } from '../printer';

type Outlet = { id: string; name: string; code?: string };
const today = () => new Date().toLocaleDateString('en-CA');

export default function ShiftPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'active' | 'reports'>('active');
  const [shift, setShift] = useState<any>(null);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [closeResult, setCloseResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [outletFilter, setOutletFilter] = useState(localStorage.getItem('outletId') || '');
  const outletId = localStorage.getItem('outletId') || '';
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  async function load() {
    setError('');
    if (!outletId) return navigate('/select-outlet', { replace: true });
    try {
      const nextOutlets = await api<Outlet[]>('/outlets');
      setOutlets(nextOutlets);
      setOutlet(nextOutlets.find(o => o.id === outletId) || null);
      const active = await api<any>(`/outlets/${outletId}/active-shift`).catch(async () => {
        const legacy = await api<any>(`/cash-sessions/active?outletId=${outletId}`);
        return legacy?.outletId === outletId ? legacy : null;
      });
      setShift(active);
      await loadReports();
    } catch (e) {
      setShift(null);
      setError((e as Error).message);
    }
  }

  async function loadReports() {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (outletFilter === 'ALL') p.set('consolidated', '1');
    else if (outletFilter) p.set('outletId', outletFilter);
    else throw new Error('Silakan pilih outlet terlebih dahulu.');
    const rows = await api<any[]>(`/cash-sessions/reports?${p}`);
    setReports(rows);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === 'reports') loadReports().catch(e => setError(e.message)); }, [tab, from, to, outletFilter]);

  function quick(kind: 'today' | 'yesterday' | 'week' | 'month') {
    const d = new Date();
    const start = new Date(d);
    const end = new Date(d);
    if (kind === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    if (kind === 'week') { const day = (start.getDay() + 6) % 7; start.setDate(start.getDate() - day); }
    if (kind === 'month') start.setDate(1);
    setFrom(start.toLocaleDateString('en-CA'));
    setTo(end.toLocaleDateString('en-CA'));
  }

  async function open(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const openingCash = Number(f.get('openingCash'));
      const opened = await api<any>(`/outlets/${outletId}/open-shift`, { method: 'POST', body: JSON.stringify({ openingCash }) })
        .catch(async () => {
          try { return await api<any>('/cash-sessions/open', { method: 'POST', body: JSON.stringify({ outletId, openingCash }) }); }
          catch (err) {
            const legacy = await api<any>(`/cash-sessions/active?outletId=${outletId}`).catch(() => null);
            if (legacy?.outletId === outletId) return legacy;
            throw err;
          }
        });
      setShift(opened);
      navigate('/pos');
    } catch (e) { setError((e as Error).message); }
  }

  async function logPrint(report: any, status: 'SUCCESS' | 'FAILED', errorMessage?: string) {
    await api(`/cash-sessions/${report.id}/print-close-report`, { method: 'POST', body: JSON.stringify({ status, errorMessage }) }).catch(() => {});
  }

  async function reprint(report: any) {
    try {
      await printShiftCloseReport(report);
      await logPrint(report, 'SUCCESS');
      alert('Print laporan shift berhasil.');
    } catch (e) {
      await logPrint(report, 'FAILED', (e as Error).message);
      alert(`Print laporan shift gagal: ${(e as Error).message}`);
    }
  }

  async function viewReport(id: string) {
    const report = await api<any>(`/cash-sessions/${id}/close-report`);
    setDetail(report);
  }

  async function close(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const closingCashActual = Number(f.get('closingCashActual'));
      const report = await api<any>(`/outlets/${outletId}/close-shift`, { method: 'POST', body: JSON.stringify({ closingCashActual }) })
        .catch(() => api<any>(`/cash-sessions/${shift.id}/close`, { method: 'POST', body: JSON.stringify({ closingCashActual }) }));
      let printStatus = 'Print success';
      try { await printShiftCloseReport(report); await logPrint(report, 'SUCCESS'); }
      catch (err) { printStatus = `Print failed: ${(err as Error).message}`; await logPrint(report, 'FAILED', (err as Error).message); }
      setCloseResult({ report, printStatus });
      setDetail(report);
      setShift(null);
      await loadReports();
    } catch (e) { setError((e as Error).message); }
  }

  return <div className="p-4 lg:p-8">
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div><h2 className="text-3xl font-black">Shift kasir</h2><p className="mt-1 text-slate-500">Shift mengikuti outlet yang dipilih saat login.</p></div>
        <button onClick={() => navigate('/select-outlet')} className="rounded-2xl border bg-white px-4 py-2 text-sm font-bold text-slate-600">Ganti Outlet</button>
      </div>
      <div className="mb-5 flex gap-2 overflow-auto"><button onClick={() => setTab('active')} className={`rounded-full px-4 py-2 text-sm font-black ${tab === 'active' ? 'bg-ink text-white' : 'bg-white text-slate-600'}`}>Active Shift</button><button onClick={() => setTab('reports')} className={`rounded-full px-4 py-2 text-sm font-black ${tab === 'reports' ? 'bg-ink text-white' : 'bg-white text-slate-600'}`}>Laporan Tutup Shift</button></div>
      {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {closeResult && <div className="mb-4 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800"><b>Shift closed successfully.</b><br />{closeResult.printStatus}<div className="mt-3 flex gap-2"><button onClick={() => reprint(closeResult.report)} className="btn-soft"><Printer size={16} /> Reprint Shift Report</button><button onClick={() => setDetail(closeResult.report)} className="btn-soft"><Eye size={16} /> View Report Detail</button></div></div>}

      {tab === 'active' && <ActiveShift outlet={outlet} outletId={outletId} shift={shift} open={open} close={close} />}
      {tab === 'reports' && <ReportsTab reports={reports} outlets={outlets} user={user} from={from} to={to} outletFilter={outletFilter} setFrom={setFrom} setTo={setTo} setOutletFilter={setOutletFilter} quick={quick} viewReport={viewReport} reprint={async (id: string) => reprint(await api<any>(`/cash-sessions/${id}/close-report`))} />}
    </div>
    {detail && <ReportModal report={detail} close={() => setDetail(null)} reprint={() => reprint(detail)} />}
  </div>;
}

function ActiveShift({ outlet, outletId, shift, open, close }: any) {
  return <div className="mx-auto max-w-2xl"><div className="mb-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Outlet aktif</p><div className="mt-2 flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Store size={22} /></span><div className="min-w-0"><b className="block truncate text-lg">{outlet?.name || 'Outlet terpilih'}</b><span className="text-sm text-slate-400">{outlet?.code || outletId}</span></div></div></div>{shift ? <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5"><div className="bg-brand-600 p-6 text-white"><span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black">SHIFT AKTIF</span><h3 className="mt-4 text-2xl font-black">{shift.outlet?.name || outlet?.name}</h3><p className="text-white/75">Dibuka {dt(shift.openedAt)} oleh {shift.openedBy || shift.opened_by || shift.cashier?.name || '-'}</p></div><form onSubmit={close} className="p-6"><div className="mb-5 flex justify-between rounded-2xl bg-slate-50 p-4"><span>Kas awal</span><b>{rupiah(shift.openingCash)}</b></div>{shift.expenses?.length > 0 && <div className="mb-5 rounded-2xl border p-4"><b className="mb-2 block">Pengeluaran shift</b>{shift.expenses.map((x: any) => <div className="flex justify-between border-t py-2 text-sm" key={x.id}><span>{x.categoryName} - {x.description}</span><b>{rupiah(x.amount)}</b></div>)}</div>}<label className="label">Kas aktual saat tutup</label><input className="input" name="closingCashActual" type="number" min="0" required /><button className="btn-primary mt-5 w-full">Tutup Shift</button></form></div> : <form onSubmit={open} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5"><div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Store /></div><label className="label">Kas awal</label><input className="input" name="openingCash" type="number" min="0" defaultValue="0" required /><button className="btn-primary mt-5 w-full"><Power size={18} /> Buka Shift</button></form>}</div>;
}

function ReportsTab(p: any) {
  return <div><div className="mb-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5"><div className="mb-3 flex gap-2 overflow-auto">{[['today','Hari ini'],['yesterday','Kemarin'],['week','Minggu ini'],['month','Bulan ini']].map(([k,l]) => <button key={k} onClick={() => p.quick(k)} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-bold">{l}</button>)}</div><div className="grid gap-3 md:grid-cols-3"><input className="input" type="date" value={p.from} onChange={(e: any) => p.setFrom(e.target.value)} /><input className="input" type="date" value={p.to} onChange={(e: any) => p.setTo(e.target.value)} /><select className="input" value={p.outletFilter} onChange={(e: any) => p.setOutletFilter(e.target.value)}>{p.user?.role==='OWNER'&&<option value="ALL">Semua outlet (konsolidasi)</option>}{p.outlets.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div><div className="mt-3 inline-flex rounded-full bg-brand-50 px-4 py-2 text-sm font-black text-brand-700">Data: {p.outletFilter==='ALL'?'Semua Outlet':'Outlet Aktif'}</div></div><div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5"><div className="overflow-auto"><table className="w-full min-w-[1300px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Tanggal','Outlet','Shift Number','Open','Close','Opened By','Closed By','Omset','Cash','Non Cash','Expense','Expected','Actual','Variance','Action'].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{p.reports.map((r: any) => <tr className="border-t" key={r.id}><td className="p-4">{dt(r.closedAt)}</td><td>{r.outlet?.name}</td><td className="font-bold">{r.shiftNumber}</td><td>{dt(r.openedAt)}</td><td>{dt(r.closedAt)}</td><td>{r.openedBy?.name}</td><td>{r.closedBy?.name || '-'}</td><td>{rupiah(r.totalOmset)}</td><td>{rupiah(r.totalCash)}</td><td>{rupiah(r.totalNonCash)}</td><td>{rupiah(r.totalExpense)}</td><td>{rupiah(r.expectedCash)}</td><td>{rupiah(r.actualCash)}</td><td>{rupiah(r.variance)}</td><td><div className="flex gap-2"><button onClick={() => p.viewReport(r.id)} className="font-bold text-brand-600">Detail</button><button onClick={() => p.reprint(r.id)} className="font-bold text-brand-600">Reprint</button></div></td></tr>)}</tbody></table></div>{!p.reports.length && <div className="p-8 text-center text-slate-400">Belum ada laporan tutup shift.</div>}</div></div>;
}

function ReportModal({ report, close, reprint }: any) {
  const cash = report.cashSummary || {}, omset = report.omsetSummary || {}, pay = report.paymentBreakdown || {}, exp = report.expenseSummary || {}, order = report.orderSummary || {};
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-3"><div><h3 className="text-2xl font-black">Laporan Tutup Shift</h3><p className="text-slate-500">{report.outlet?.name} · {report.shiftNumber}</p></div><button onClick={close} className="text-2xl">×</button></div><div className="mb-4 grid gap-2 text-sm sm:grid-cols-2"><Info label="Opened By" value={report.openedBy?.name} /><Info label="Closed By" value={report.closedBy?.name || '-'} /><Info label="Open Time" value={dt(report.openedAt)} /><Info label="Close Time" value={dt(report.closedAt)} /></div><Section title="Cash Summary" rows={[['Opening Cash', cash.openingCash], ['Cash Sales', cash.cashSales], ['Cash Drawer Expenses', cash.cashDrawerExpenses], ['Cash Refund', cash.cashRefund], ['Expected Cash', cash.expectedCash], ['Actual Cash', cash.actualCash], ['Variance', cash.variance]]} /><Section title="Omset Summary" rows={[['Gross Sales', omset.grossSales], ['Product Discount', -Number(omset.productDiscount||0)], ['Transaction Discount', -Number(omset.transactionDiscount||0)], ['Coupon Discount', -Number(omset.couponDiscount||0)], ['Net Sales / Total Omset', omset.netSales], ['Total HPP', omset.totalHpp], ['Gross Profit', omset.grossProfit]]} /><Section title="Payment Breakdown" rows={Object.entries(pay)} /><Section title="Expense Summary" rows={[['CASH_DRAWER', exp.CASH_DRAWER], ['NON_CASH', exp.NON_CASH], ['OWNER_TRANSFER', exp.OWNER_TRANSFER], ['Total Expense', exp.totalExpense]]} /><div className="mb-4"><h4 className="mb-2 font-black">Item Sold Detail</h4>{report.itemSold?.map((i: any) => <div key={`${i.productName}-${i.variantName}`} className="flex justify-between border-t py-2 text-sm"><span><b>{i.productName}</b><p className="text-slate-400">{i.variantName}</p></span><span>{i.qty} · {rupiah(i.grossSales)}</span></div>) || <p className="text-slate-400">-</p>}</div><Section title="Order Summary" rows={[['Total Order', order.totalOrder], ['Paid Order', order.paidOrder], ['Pending Order', order.pendingOrder], ['Cancelled Order', order.cancelledOrder], ['Void Order', order.voidOrder]]} /><div className="mb-4"><h4 className="mb-2 font-black">Expense Detail</h4>{report.expenseDetails?.map((e: any) => <div key={e.id} className="grid gap-1 border-t py-2 text-sm sm:grid-cols-5"><span>{dt(e.createdAt)}</span><span>{e.categoryName}</span><span>{e.description}</span><span>{e.paymentSource}</span><b className="text-right">{rupiah(e.amount)}</b></div>) || <p className="text-slate-400">-</p>}</div><div className="sticky bottom-0 mt-4 flex gap-2 bg-white pt-3"><button onClick={reprint} className="btn-primary"><Printer size={16} /> Print / Reprint</button><button onClick={close} className="btn-soft">Close</button></div></div></div>;
}

function Info({ label, value }: any) { return <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-400">{label}</p><b>{value || '-'}</b></div>; }
function Section({ title, rows }: any) { return <div className="mb-4 rounded-2xl border p-4"><h4 className="mb-2 font-black">{title}</h4>{rows.map(([k, v]: any) => <div key={k} className="flex justify-between border-t py-2 text-sm"><span>{k}</span><b>{typeof v === 'number' ? rupiah(v) : rupiah(Number(v || 0))}</b></div>)}</div>; }
