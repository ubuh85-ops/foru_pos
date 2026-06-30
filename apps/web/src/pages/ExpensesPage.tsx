import { FormEvent, useEffect, useState } from 'react';
import { api, dt, rupiah } from '../api';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const today = () => new Date().toLocaleDateString('en-CA');

export default function ExpensesPage() {
  const outletId = localStorage.getItem('outletId') || '';
  const [data, setData] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const load = () => {
    if (!outletId) { setError('Silakan pilih outlet terlebih dahulu.'); return; }
    api(`/outlets/${outletId}/active-shift`).then(setActive).catch(() => setActive(null));
    api<any[]>('/expense-categories').then(setCats);
    api<any[]>(`/expenses?date=${date}&outletId=${outletId}`).then(setData).catch(e => setError(e.message));
  };
  useEffect(() => { load(); }, [date, outletId]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      await api('/expenses', { method: 'POST', body: JSON.stringify({ outletId, categoryId: f.get('categoryId'), description: f.get('description'), amount: Number(f.get('amount')), paymentSource: f.get('paymentSource'), note: f.get('note') || null, receiptImageUrl: f.get('receiptImageUrl') || null }) });
      (e.currentTarget as HTMLFormElement).reset();
      load();
    } catch (e) { setError((e as Error).message); }
  }
  async function del(x: any) { if (!confirm('Batalkan pengeluaran ini?')) return; try { await api(`/expenses/${x.id}`, { method: 'DELETE' }); load(); } catch (e) { alert((e as Error).message); } }
  const cashDrawer = data.filter(x => x.paymentSource === 'CASH_DRAWER').reduce((n, x) => n + Number(x.amount), 0), nonCash = data.filter(x => x.paymentSource === 'NON_CASH').reduce((n, x) => n + Number(x.amount), 0), ownerTransfer = data.filter(x => x.paymentSource === 'OWNER_TRANSFER').reduce((n, x) => n + Number(x.amount), 0);
  return <Page><div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-3xl font-black">Pengeluaran</h2><p className="text-slate-500">Data Outlet Aktif</p></div><input className="input w-44" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>{error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="grid gap-5 xl:grid-cols-3"><form onSubmit={save} className="card p-5"><h3 className="section-title mb-4">Tambah Pengeluaran</h3>{active ? <div className="mb-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-700">Shift aktif: <b>{active.outlet?.name}</b></div> : <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Tidak ada shift aktif. Silakan buka shift terlebih dahulu.</div>}<label className="label">Category</label><select className="input mb-3" name="categoryId" required>{cats.filter(c => c.status === 'ACTIVE').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><label className="label">Description</label><input className="input mb-3" name="description" required /><label className="label">Amount</label><input className="input mb-3" name="amount" type="number" min="1" required /><label className="label">Payment Source</label><select className="input mb-3" name="paymentSource" defaultValue="CASH_DRAWER"><option value="CASH_DRAWER">CASH_DRAWER</option><option value="NON_CASH">NON_CASH</option><option value="OWNER_TRANSFER">OWNER_TRANSFER</option></select><label className="label">Note</label><input className="input mb-3" name="note" /><label className="label">Receipt Image URL</label><input className="input mb-4" name="receiptImageUrl" /><button disabled={!active} className="btn-primary w-full">Simpan Pengeluaran</button></form><div className="xl:col-span-2 space-y-5"><div className="grid gap-3 sm:grid-cols-3"><div className="card p-4"><p className="text-xs text-slate-400">Cash drawer</p><b className="money text-xl">{rupiah(cashDrawer)}</b></div><div className="card p-4"><p className="text-xs text-slate-400">Non cash</p><b className="money text-xl">{rupiah(nonCash)}</b></div><div className="card p-4"><p className="text-xs text-slate-400">Owner transfer</p><b className="money text-xl">{rupiah(ownerTransfer)}</b></div></div><div className="card overflow-hidden"><div className="overflow-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Time', 'Outlet', 'Cashier', 'Category', 'Description', 'Amount', 'Payment', 'Status', ''].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{data.map(x => <tr className="border-t" key={x.id}><td className="p-4">{dt(x.createdAt)}</td><td>{x.outlet?.name}</td><td>{x.cashier?.name}</td><td className="font-bold">{x.categoryName}</td><td>{x.description}</td><td className="money font-bold">{rupiah(x.amount)}</td><td>{x.paymentSource}</td><td>{x.status}</td><td><button onClick={() => del(x)} className="font-bold text-red-600">Cancel</button></td></tr>)}</tbody></table></div>{!data.length && <div className="p-8 text-center text-slate-400">Belum ada pengeluaran.</div>}</div></div></div></Page>;
}
