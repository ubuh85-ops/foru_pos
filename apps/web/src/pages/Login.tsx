import { FormEvent, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { api, type User } from '../api';
import { downloadMasterData, recordLocalAudit } from '../sync';
import { getCachedText, initLocalDb, setLocalText } from '../localDb';

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const username = String(fd.get('username') || '');

    try {
      const r = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(fd))
      });
      localStorage.setItem('token', r.token);
      localStorage.setItem('user', JSON.stringify(r.user));
      await setLocalText('foru:last_login_username', username);
      await downloadMasterData('LOGIN');
      recordLocalAudit('LOGIN', 'USER', r.user.id, { username, mode: 'ONLINE' });
      onLogin(r.user);
    } catch (e) {
      await initLocalDb();
      const cachedUser = JSON.parse(localStorage.getItem('user') || 'null');
      const cachedUsername = getCachedText('foru:last_login_username');
      const hasMaster = !!getCachedText('foru:master_data');
      if (!navigator.onLine && cachedUser && cachedUsername === username && hasMaster) {
        recordLocalAudit('LOGIN', 'USER', cachedUser.id, { username, mode: 'OFFLINE' });
        onLogin(cachedUser);
        return;
      }
      setError(!navigator.onLine ? 'Offline: login offline hanya bisa jika user pernah login online dan master data sudah tersimpan.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid min-h-screen lg:grid-cols-2">
    <section className="hidden overflow-hidden bg-ink p-14 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="flex items-center gap-3 text-2xl font-black"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500">F</span>FORU POS</div>
      <div>
        <p className="mb-5 text-sm font-bold uppercase tracking-[.25em] text-brand-500">Point of Sale</p>
        <h1 className="max-w-xl text-6xl font-black leading-[1.05]">Lebih cepat jualan, lebih jernih melihat usaha.</h1>
        <p className="mt-6 max-w-md text-lg text-white/55">Kasir, multi-outlet, kupon, dan laporan profit dalam satu ruang kerja.</p>
      </div>
      <small className="text-white/35">FORU operational system</small>
    </section>
    <section className="flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md">
        <div className="mb-9 lg:hidden"><div className="mb-3 flex items-center gap-2 text-2xl font-black"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">F</span>FORU POS</div></div>
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
