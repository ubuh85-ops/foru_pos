import { FormEvent, useEffect, useState } from 'react';
import { api, dt, rupiah } from '../api';
import { toast } from '../toast';
import { useOutlet } from '../OutletContext';

const Page = ({ children }: { children: any }) => <div className="min-w-0 max-w-full overflow-x-hidden p-4 pb-28 md:pb-4 lg:p-8">{children}</div>;
const today = () => new Date().toLocaleDateString('en-CA');

export default function ExpensesPage() {
  const { selectedOutletId: outletId } = useOutlet();
  const [data, setData] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const load = () => {
    if (!outletId) { setError('Silakan pilih outlet terlebih dahulu.'); return; }
    api(`/outlets/${outletId}/active-shift`).then(setActive).catch(() => setActive(null));
    api<any[]>('/expense-categories').then(setCats);
    api<any[]>(`/expenses?date=${date}&outletId=${outletId}`).then(setData).catch(e => setError(e.message));
  };
  useEffect(() => { load(); }, [date, outletId]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const f = new FormData(e.currentTarget);
      await api('/expenses', { method: 'POST', body: JSON.stringify({ outletId, categoryId: f.get('categoryId'), description: f.get('description'), amount: Number(f.get('amount')), paymentSource: f.get('paymentSource'), note: f.get('note') || null, receiptImageUrl: f.get('receiptImageUrl') || null }) });
      (e.currentTarget as HTMLFormElement).reset();
      load();
      toast.success('Pengeluaran berhasil disimpan.');
    } catch (e) { const msg = (e as Error).message; setError(msg); toast.error(msg); }
    finally { setSubmitting(false); }
  }
  async function del(x: any) { if (!confirm('Batalkan pengeluaran ini?')) return; try { await api(`/expenses/${x.id}`, { method: 'DELETE' }); load(); } catch (e) { alert((e as Error).message); } }
  const cashDrawer = data.filter(x => x.paymentSource === 'CASH_DRAWER').reduce((n, x) => n + Number(x.amount), 0), nonCash = data.filter(x => x.paymentSource === 'NON_CASH').reduce((n, x) => n + Number(x.amount), 0), ownerTransfer = data.filter(x => x.paymentSource === 'OWNER_TRANSFER').reduce((n, x) => n + Number(x.amount), 0);
  return <Page><div className="mb-6 flex min-w-0 flex-col justify-between gap-3 sm:flex-row sm:items-end"><div className="min-w-0"><h2 className="text-3xl font-black">Pengeluaran</h2><p className="text-slate-500">Data Outlet Aktif</p></div><input className="input w-full sm:w-44" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>{error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="grid min-w-0 gap-5 xl:grid-cols-3"><form onSubmit={save} className="card min-w-0 overflow-hidden p-5"><h3 className="section-title mb-4">Tambah Pengeluaran</h3>{active ? <div className="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-700">Shift aktif: <b>{active.outlet?.name}</b></div> : <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Tidak ada shift aktif. Silakan buka shift terlebih dahulu.</div>}<label className="label">Category</label><select className="input mb-3" name="categoryId" required>{cats.filter(c => c.status === 'ACTIVE').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><label className="label">Description</label><input className="input mb-3" name="description" required /><label className="label">Amount</label><input className="input mb-3" name="amount" type="number" min="1" required /><label className="label">Payment Source</label><select className="input mb-3" name="paymentSource" defaultValue="CASH_DRAWER"><option value="CASH_DRAWER">CASH_DRAWER</option><option value="NON_CASH">NON_CASH</option><option value="OWNER_TRANSFER">OWNER_TRANSFER</option></select><label className="label">Note</label><input className="input mb-3" name="note" /><label className="label">Receipt Image URL</label><input className="input mb-4" name="receiptImageUrl" /><button disabled={!active || submitting} className="btn-primary w-full justify-center whitespace-normal text-center leading-tight">{submitting ? 'Menyimpan...' : 'Simpan Pengeluaran'}</button></form><div className="min-w-0 space-y-5 xl:col-span-2"><div className="grid min-w-0 gap-3 sm:grid-cols-3"><div className="card min-w-0 p-4"><p className="text-xs text-slate-400">Cash drawer</p><b className="money block truncate text-xl">{rupiah(cashDrawer)}</b></div><div className="card min-w-0 p-4"><p className="text-xs text-slate-400">Non cash</p><b className="money block truncate text-xl">{rupiah(nonCash)}</b></div><div className="card min-w-0 p-4"><p className="text-xs text-slate-400">Owner transfer</p><b className="money block truncate text-xl">{rupiah(ownerTransfer)}</b></div></div><div className="space-y-3 md:hidden">{data.map(x => <article className="card min-w-0 p-4" key={x.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-ink">{x.categoryName}</p><p className="mt-1 truncate text-xs text-slate-400">{x.description}</p></div><b className="money shrink-0 text-brand-700">{rupiah(x.amount)}</b></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500"><span className="truncate">{dt(x.createdAt)}</span><span className="truncate text-right">{x.paymentSource}</span><span className="truncate">{x.outlet?.name || '-'}</span><span className="truncate text-right">{x.status}</span></div><button onClick={() => del(x)} className="mt-3 text-sm font-bold text-red-600">Cancel</button></article>)}{!data.length && <div className="card p-8 text-center text-slate-400">Belum ada pengeluaran.</div>}</div><div className="card hidden overflow-hidden md:block"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Time', 'Outlet', 'Cashier', 'Category', 'Description', 'Amount', 'Payment', 'Status', ''].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{data.map(x => <tr className="border-t" key={x.id}><td className="p-4">{dt(x.createdAt)}</td><td>{x.outlet?.name}</td><td>{x.cashier?.name}</td><td className="font-bold">{x.categoryName}</td><td>{x.description}</td><td className="money font-bold">{rupiah(x.amount)}</td><td>{x.paymentSource}</td><td>{x.status}</td><td><button onClick={() => del(x)} className="font-bold text-red-600">Cancel</button></td></tr>)}</tbody></table></div>{!data.length && <div className="p-8 text-center text-slate-400">Belum ada pengeluaran.</div>}</div></div></div></Page>;
}
