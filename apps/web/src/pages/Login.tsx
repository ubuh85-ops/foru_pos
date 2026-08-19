import { FormEvent, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { api, type User } from '../api';

function businessIdOf(user: User) {
  return user.business?.id || user.businessId || user.membership?.businessId || '';
}

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);

    try {
      const r = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(fd))
      });
      const nextBusinessId = businessIdOf(r.user);
      const previousBusinessId = localStorage.getItem('foru:business_id') || '';
      if (previousBusinessId && nextBusinessId && previousBusinessId !== nextBusinessId) {
        localStorage.removeItem('outletId');
      }
      if (nextBusinessId) localStorage.setItem('foru:business_id', nextBusinessId);
      const currentOutletId = localStorage.getItem('outletId') || '';
      if (!r.user.outletIds.includes(currentOutletId)) localStorage.removeItem('outletId');
      if (r.user.outletIds.length === 1) {
        localStorage.setItem('outletId', r.user.outletIds[0]);
        localStorage.removeItem('foru:must_select_outlet');
      } else {
        localStorage.setItem('foru:must_select_outlet', '1');
      }
      localStorage.setItem('token', r.token);
      localStorage.setItem('user', JSON.stringify(r.user));
      onLogin(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid min-h-screen md:grid-cols-2">
    <section className="hidden overflow-hidden bg-brand-900 p-10 text-white md:flex md:flex-col md:justify-between xl:p-14">
      <div className="flex items-center gap-3 text-2xl font-black"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500">F</span>FORU POS</div>
      <div>
        <p className="mb-5 text-sm font-bold uppercase tracking-[.25em] text-brand-500">Point of Sale</p>
        <h1 className="max-w-xl text-4xl font-black leading-[1.05] xl:text-6xl">Lebih cepat jualan, lebih jernih melihat usaha.</h1>
        <p className="mt-5 max-w-md text-base text-white/55 xl:mt-6 xl:text-lg">Kasir, multi-outlet, kupon, dan laporan profit dalam satu ruang kerja.</p>
      </div>
      <small className="text-white/35">FORU operational system</small>
    </section>
    <section className="flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md">
        <div className="mb-9 md:hidden"><div className="mb-3 flex items-center gap-2 text-2xl font-black"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">F</span>FORU POS</div></div>
        <div className="mb-8">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600"><LockKeyhole /></span>
          <h2 className="text-3xl font-black">Selamat datang</h2>
          <p className="mt-2 text-slate-500">Masuk untuk memulai operasional hari ini.</p>
        </div>
        <label className="label">Username</label>
        <input className="input mb-4" name="username" autoComplete="username" defaultValue="owner" required />
        <label className="label">Password</label>
        <input className="input mb-3" name="password" type="password" autoComplete="current-password" defaultValue="owner123" required />
        {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="btn-primary mt-2 w-full">{busy ? 'Memproses...' : 'Masuk'}<ArrowRight size={18} /></button>
        <p className="mt-5 text-center text-xs text-slate-400">Demo: owner / owner123 · kasir / kasir123</p>
      </form>
    </section>
  </div>;
}
