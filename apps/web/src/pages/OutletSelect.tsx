import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit3, Eye, Filter, LogOut, Plus, Search, Store } from 'lucide-react';
import { api, type User } from '../api';

type Outlet = { id: string; code?: string; name: string; address?: string | null; status?: string };

export default function OutletSelect({ user, logout }: { user: User; logout: () => void }) {
  const navigate = useNavigate();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api<Outlet[]>('/outlets')
      .then(setOutlets)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return outlets.filter(o => !q || o.name.toLowerCase().includes(q) || (o.code || '').toLowerCase().includes(q));
  }, [outlets, query]);

  async function enter(outlet: Outlet) {
    try {
      localStorage.setItem('outletId', outlet.id);
      localStorage.removeItem('foru:must_select_outlet');
      await api<any>(`/outlets/${outlet.id}/active-shift`).catch(() => null);
      navigate('/pos', { replace: true });
    } catch {
      navigate('/pos', { replace: true });
    }
  }

  return <div className="min-h-dvh bg-[#f7f4ec] pb-24 text-ink">
    <header className="sticky top-0 z-20 border-b bg-white/90 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-500">Central Dashboard</p>
          <h1 className="truncate text-xl font-black"><span className="text-brand-600">FORU</span> POS</h1>
        </div>
        <button onClick={logout} className="grid h-10 w-10 place-items-center rounded-2xl bg-red-50 text-red-500"><LogOut size={18} /></button>
      </div>
    </header>

    <main className="mx-auto max-w-5xl px-4 py-4">
      <div className="mb-3 grid grid-cols-3 border-b text-center text-xs font-bold text-slate-400">
        <span className="border-b-2 border-pink-500 py-3 text-pink-600">Outlet</span>
        <span className="py-3">Member Get Member</span>
        <span className="py-3">Central Dashboard</span>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Daftar Outlet</h2>
          <p className="text-xs text-slate-500">Pilih outlet untuk mulai operasional.</p>
        </div>
        <button className="flex h-12 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-bold text-slate-600 shadow-sm"><Filter size={17} /> Saring</button>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm">
        <Search size={18} className="text-slate-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari outlet..." className="h-10 min-w-0 flex-1 bg-transparent outline-none" />
      </div>

      {error && <div className="mb-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && <div className="rounded-3xl bg-white p-6 text-center text-slate-400 shadow-sm">Memuat outlet...</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!loading && filtered.map(outlet => <article key={outlet.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="grid place-items-center rounded-2xl bg-slate-50 py-3">
            <div className="relative grid h-24 w-28 place-items-center rounded-2xl bg-gradient-to-b from-pink-100 to-brand-50">
              <Store className="text-brand-700" size={44} />
              <span className="absolute top-2 rounded bg-pink-500 px-2 py-0.5 text-[9px] font-black text-white">STORE</span>
            </div>
          </div>
          <h3 className="mt-4 min-h-10 text-sm font-black leading-snug">{outlet.name}</h3>
          <p className="mb-3 truncate text-xs text-slate-400">{outlet.address || outlet.code || 'Outlet FORU'}</p>
          <button onClick={() => enter(outlet)} className="mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-black text-ink hover:bg-brand-50 hover:text-brand-700"><Eye size={16} /> Masuk Ke Outlet</button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => alert(`${outlet.name}\n${outlet.address || '-'}\nStatus: ${outlet.status || 'ACTIVE'}`)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold"><Eye size={15} /> Info</button>
            <button onClick={() => navigate(user.role === 'OWNER' ? '/outlets' : '/select-outlet')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-pink-600"><Edit3 size={15} /> Edit</button>
          </div>
        </article>)}
      </div>

      {!loading && !filtered.length && <div className="rounded-3xl bg-white p-8 text-center text-slate-400 shadow-sm">Outlet tidak ditemukan.</div>}
    </main>

    {user.role === 'OWNER' && <div className="fixed inset-x-0 bottom-0 z-20 bg-[#f7f4ec]/90 p-4 backdrop-blur">
      <button onClick={() => navigate('/outlets')} className="mx-auto flex h-14 w-full max-w-5xl items-center justify-center gap-2 rounded-2xl bg-pink-600 font-black text-white shadow-lg shadow-pink-200"><Plus size={20} /> Tambah Outlet</button>
    </div>}
  </div>;
}
