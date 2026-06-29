import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Edit, KeyRound, Plus, Search, Store, Trash2, UserCog } from 'lucide-react';
import { api, dt } from '../api';

type Outlet = { id: string; name: string; code?: string };
type ManagedUser = {
  id: string;
  name: string;
  username: string;
  role: 'OWNER' | 'SUPERVISOR' | 'CASHIER';
  status: 'ACTIVE' | 'INACTIVE';
  lastLogin?: string | null;
  outlets?: { outlet: Outlet; status?: string }[];
};

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Err = ({ v }: { v: string }) => v ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{v}</div> : null;

export default function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [edit, setEdit] = useState<ManagedUser | null>(null);
  const [assign, setAssign] = useState<ManagedUser | null>(null);
  const [reset, setReset] = useState<ManagedUser | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [outletId, setOutletId] = useState('');
  const [outletsLoading, setOutletsLoading] = useState(false);
  const [outletsError, setOutletsError] = useState('');

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (role) p.set('role', role);
    if (status) p.set('status', status);
    if (outletId) p.set('outlet_id', outletId);
    return p.toString();
  }, [q, role, status, outletId]);

  function load() {
    api<ManagedUser[]>(`/users${query ? `?${query}` : ''}`).then(setUsers).catch(e => setError(e.message));
  }
  function loadOutlets() {
    setOutletsLoading(true);
    setOutletsError('');
    api<Outlet[]>('/outlets')
      .then(rows => setOutlets(rows))
      .catch(e => {
        setOutlets([]);
        setOutletsError((e as Error).message);
        setError((e as Error).message);
      })
      .finally(() => setOutletsLoading(false));
  }

  useEffect(() => { loadOutlets(); }, []);
  useEffect(() => { load(); }, [query]);

  async function saveUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit) return;
    setError('');
    try {
      const f = new FormData(e.currentTarget);
      const body = {
        name: f.get('name'),
        username: f.get('username'),
        password: String(f.get('password') || '') || undefined,
        confirmPassword: String(f.get('confirmPassword') || '') || undefined,
        pin: String(f.get('pin') || '') || undefined,
        role: f.get('role'),
        status: f.get('status'),
        outletIds: f.getAll('outletIds'),
      };
      await api(edit.id ? `/users/${edit.id}` : '/users', { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setEdit(null);
      load();
      alert(edit.id ? 'User berhasil diubah.' : 'User berhasil ditambahkan.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function resetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reset) return;
    try {
      const f = new FormData(e.currentTarget);
      await api(`/users/${reset.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: f.get('password'), confirmPassword: f.get('confirmPassword') }) });
      setReset(null);
      alert('Password berhasil di-reset.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveAssignment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!assign) return;
    try {
      const f = new FormData(e.currentTarget);
      await api(`/users/${assign.id}/outlets`, { method: 'PUT', body: JSON.stringify({ outletIds: f.getAll('outletIds') }) });
      setAssign(null);
      load();
      alert('Outlet user berhasil diperbarui.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function setUserStatus(user: ManagedUser, next: 'ACTIVE' | 'INACTIVE') {
    try {
      await api(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function softDelete(user: ManagedUser) {
    if (!confirm(`Soft delete user "${user.name}"?`)) return;
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <h2 className="text-3xl font-black">User Management</h2>
        <p className="text-slate-500">Kelola owner, supervisor, kasir, dan akses outlet.</p>
      </div>
      <button onClick={() => setEdit({} as ManagedUser)} className="btn-primary"><Plus size={18} /> Tambah User</button>
    </div>
    <Err v={error} />
    <div className="mb-4 grid gap-2 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5 md:grid-cols-[1fr_11rem_11rem_14rem]">
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input className="input pl-10" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari name / username..." /></div>
      <select className="input" value={role} onChange={e => setRole(e.target.value)}><option value="">Semua role</option><option>OWNER</option><option>SUPERVISOR</option><option>CASHIER</option></select>
      <select className="input" value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option><option>ACTIVE</option><option>INACTIVE</option></select>
      <select className="input" value={outletId} onChange={e => setOutletId(e.target.value)}><option value="">Semua outlet</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    </div>

    <div className="hidden overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 lg:block">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-500"><tr><th className="p-4">Name</th><th>Username</th><th>Role</th><th>Assigned Outlets</th><th>Status</th><th>Last Login</th><th className="p-4 text-right">Actions</th></tr></thead>
        <tbody>{users.map(user => <tr className="border-t" key={user.id}><td className="p-4 font-bold">{user.name}</td><td>{user.username}</td><td><span className="pill bg-slate-100">{user.role}</span></td><td>{outletText(user)}</td><td><span className={`pill ${user.status === 'ACTIVE' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>{user.status}</span></td><td>{user.lastLogin ? dt(user.lastLogin) : '-'}</td><td className="p-4"><Actions user={user} edit={setEdit} reset={setReset} assign={setAssign} setStatus={setUserStatus} softDelete={softDelete} /></td></tr>)}</tbody>
      </table>
    </div>

    <div className="grid gap-3 lg:hidden">
      {users.map(user => <article key={user.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="mb-3 flex items-start justify-between gap-2"><div><h3 className="text-lg font-black">{user.name}</h3><p className="text-sm text-slate-400">@{user.username}</p></div><span className={`pill ${user.status === 'ACTIVE' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>{user.status}</span></div>
        <p className="text-sm"><b>Role:</b> {user.role}</p>
        <p className="mt-1 text-sm"><b>Outlet:</b> {outletText(user)}</p>
        <p className="mt-1 text-sm text-slate-500">Last Login: {user.lastLogin ? dt(user.lastLogin) : '-'}</p>
        <div className="mt-3"><Actions user={user} edit={setEdit} reset={setReset} assign={setAssign} setStatus={setUserStatus} softDelete={softDelete} /></div>
      </article>)}
    </div>

    {edit && <Modal title={edit.id ? 'Edit User' : 'Tambah User'} close={() => setEdit(null)}>
      <UserForm user={edit} outlets={outlets} outletsLoading={outletsLoading} outletsError={outletsError} reloadOutlets={loadOutlets} onSubmit={saveUser} />
    </Modal>}
    {reset && <Modal title={`Reset Password - ${reset.name}`} close={() => setReset(null)}>
      <form onSubmit={resetPassword}>
        <Field name="password" label="Password baru" type="password" required minLength={8} />
        <Field name="confirmPassword" label="Confirm password" type="password" required minLength={8} />
        <button className="btn-primary mt-3 w-full">Reset Password</button>
      </form>
    </Modal>}
    {assign && <Modal title={`Assign Outlet - ${assign.name}`} close={() => setAssign(null)}>
      <form onSubmit={saveAssignment}>
        <OutletChecks outlets={outlets} selected={(assign.outlets || []).map(x => x.outlet.id)} loading={outletsLoading} error={outletsError} reload={loadOutlets} />
        <button className="btn-primary mt-5 w-full">Simpan Outlet</button>
      </form>
    </Modal>}
  </Page>;
}

function outletText(user: ManagedUser) {
  if (user.role === 'OWNER') return 'Semua outlet';
  const names = (user.outlets || []).map(x => x.outlet?.name).filter(Boolean);
  return names.length ? names.join(', ') : '-';
}

function Actions({ user, edit, reset, assign, setStatus, softDelete }: { user: ManagedUser; edit: (u: ManagedUser) => void; reset: (u: ManagedUser) => void; assign: (u: ManagedUser) => void; setStatus: (u: ManagedUser, s: 'ACTIVE' | 'INACTIVE') => void; softDelete: (u: ManagedUser) => void }) {
  return <div className="flex flex-wrap justify-end gap-2">
    <button onClick={() => edit(user)} className="rounded-xl border px-3 py-2 text-xs font-bold text-brand-700"><Edit size={14} className="inline" /> Edit</button>
    <button onClick={() => reset(user)} className="rounded-xl border px-3 py-2 text-xs font-bold text-slate-700"><KeyRound size={14} className="inline" /> Reset</button>
    <button onClick={() => assign(user)} className="rounded-xl border px-3 py-2 text-xs font-bold text-slate-700"><Store size={14} className="inline" /> Outlet</button>
    <button onClick={() => setStatus(user, user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')} className="rounded-xl border px-3 py-2 text-xs font-bold text-amber-700">{user.status === 'ACTIVE' ? 'Inactive' : 'Active'}</button>
    <button onClick={() => softDelete(user)} className="rounded-xl border px-3 py-2 text-xs font-bold text-red-600"><Trash2 size={14} className="inline" /> Delete</button>
  </div>;
}

function UserForm({ user, outlets, outletsLoading, outletsError, reloadOutlets, onSubmit }: { user: ManagedUser; outlets: Outlet[]; outletsLoading: boolean; outletsError: string; reloadOutlets: () => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  const selected = (user.outlets || []).map(x => x.outlet.id);
  return <form onSubmit={onSubmit}>
    <Field name="name" label="Name" defaultValue={user.name} required />
    <Field name="username" label="Username" defaultValue={user.username} required minLength={3} />
    <Field name="password" label={user.id ? 'Password baru (opsional)' : 'Password'} type="password" required={!user.id} minLength={8} />
    <Field name="confirmPassword" label="Confirm Password" type="password" required={!user.id} minLength={8} />
    <Field name="pin" label="PIN optional" inputMode="numeric" pattern="[0-9]*" />
    <label className="label">Role</label>
    <select className="input mb-3" name="role" defaultValue={user.role || 'CASHIER'}><option>OWNER</option><option>SUPERVISOR</option><option>CASHIER</option></select>
    <label className="label">Status</label>
    <select className="input mb-3" name="status" defaultValue={user.status || 'ACTIVE'}><option>ACTIVE</option><option>INACTIVE</option></select>
    <OutletChecks outlets={outlets} selected={selected} loading={outletsLoading} error={outletsError} reload={reloadOutlets} />
    <p className="mt-2 text-xs text-slate-400">OWNER otomatis bisa akses semua outlet. Supervisor/kasir minimal pilih 1 outlet.</p>
    <button className="btn-primary mt-5 w-full">Simpan User</button>
  </form>;
}

function OutletChecks({ outlets, selected, loading, error, reload }: { outlets: Outlet[]; selected: string[]; loading?: boolean; error?: string; reload?: () => void }) {
  return <div className="mt-3 rounded-2xl border p-3">
    <b className="mb-2 block text-sm">Assigned Outlets</b>
    {loading ? <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Memuat outlet...</div> : error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
      <p className="font-semibold">Outlet gagal dimuat.</p>
      <p className="mt-1">{error}</p>
      {reload && <button type="button" onClick={reload} className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-200">Muat ulang outlet</button>}
    </div> : outlets.length ? <div className="grid gap-2 sm:grid-cols-2">{outlets.map(outlet => <label key={outlet.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm"><input type="checkbox" name="outletIds" value={outlet.id} defaultChecked={selected.includes(outlet.id)} />{outlet.name}</label>)}</div> : <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
      <p className="font-semibold">Belum ada outlet aktif.</p>
      <p className="mt-1">Buat atau seed outlet terlebih dahulu, lalu klik muat ulang.</p>
      {reload && <button type="button" onClick={reload} className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-200">Muat ulang outlet</button>}
    </div>}
  </div>;
}

function Field({ name, label, type = 'text', defaultValue, required, minLength, inputMode, pattern }: { name: string; label: string; type?: string; defaultValue?: any; required?: boolean; minLength?: number; inputMode?: any; pattern?: string }) {
  return <><label className="label">{label}</label><input className="input mb-3" name={name} type={type} defaultValue={defaultValue ?? ''} required={required} minLength={minLength} inputMode={inputMode} pattern={pattern} /></>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: any }) {
  return <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-auto bg-black/40 p-0 sm:items-center sm:p-4">
    <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
      <div className="mb-5 flex justify-between"><h3 className="flex items-center gap-2 text-xl font-black"><UserCog size={20} />{title}</h3><button onClick={close}>×</button></div>
      {children}
    </div>
  </div>;
}
