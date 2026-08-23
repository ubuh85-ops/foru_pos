import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, LockKeyhole, PackagePlus, Settings2, Store } from 'lucide-react';
import { api, type User } from '../api';

type AuthResponse = {
  token: string;
  user: User;
  business?: User['business'];
  membership?: User['membership'];
};

function businessIdOf(user: User) {
  return user.business?.id || user.businessId || user.membership?.businessId || '';
}

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [registerStep, setRegisterStep] = useState(0);
  const [registerData, setRegisterData] = useState({
    ownerName: '',
    username: '',
    password: '',
    confirmPassword: '',
    businessName: '',
    phone: '',
    outletName: '',
    outletCode: '',
    outletAddress: '',
    warehouseCode: '',
    warehouseName: ''
  });
  const registerSteps = ['Akun', 'Business', 'Outlet', 'Setup', 'Produk'];

  function persistSession(r: AuthResponse) {
    const normalizedUser: User = {
      ...r.user,
      business: r.user.business || r.business,
      membership: r.user.membership || r.membership,
      businessId: r.user.businessId || r.business?.id || r.membership?.businessId
    };
    const nextBusinessId = businessIdOf(normalizedUser);
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
    localStorage.setItem('user', JSON.stringify(normalizedUser));
    onLogin(normalizedUser);
    navigate('/dashboard', { replace: true });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);

    try {
      persistSession(await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(fd))
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateRegister(field: keyof typeof registerData, value: string) {
    setRegisterData(current => ({ ...current, [field]: value }));
  }

  function canContinueRegister() {
    if (registerStep === 0) return registerData.ownerName.trim().length >= 2 && registerData.username.trim().length >= 3 && registerData.password.length >= 8 && registerData.password === registerData.confirmPassword;
    if (registerStep === 1) return registerData.businessName.trim().length >= 2;
    if (registerStep === 2) return registerData.outletName.trim().length >= 2 && registerData.outletCode.trim().length >= 2;
    return true;
  }

  async function registerBusiness(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (registerStep < registerSteps.length - 1) {
      if (!canContinueRegister()) {
        setError(registerStep === 0 && registerData.password !== registerData.confirmPassword ? 'Password dan konfirmasi password harus sama.' : 'Lengkapi data wajib terlebih dahulu.');
        return;
      }
      setError('');
      setRegisterStep(step => step + 1);
      return;
    }
    setBusy(true);
    setError('');
    const payload = {
      ownerName: registerData.ownerName,
      username: registerData.username,
      password: registerData.password,
      confirmPassword: registerData.confirmPassword,
      businessName: registerData.businessName,
      businessCode: registerData.businessName,
      phone: registerData.phone,
      outletName: registerData.outletName,
      outletCode: registerData.outletCode,
      outletAddress: registerData.outletAddress,
      warehouseCode: registerData.warehouseCode || `${registerData.outletCode}-WH`,
      warehouseName: registerData.warehouseName || `${registerData.outletName} Warehouse`
    };
    try {
      persistSession(await api<AuthResponse>('/auth/register-business', {
        method: 'POST',
        body: JSON.stringify(payload)
      }));
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
      <div className="w-full max-w-md">
        <div className="mb-9 md:hidden"><div className="mb-3 flex items-center gap-2 text-2xl font-black"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">F</span>FORU POS</div></div>
        <div className="mb-8">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">{mode === 'login' ? <LockKeyhole /> : <Building2 />}</span>
          <h2 className="text-3xl font-black">{mode === 'login' ? 'Selamat datang' : 'Daftar bisnis baru'}</h2>
          <p className="mt-2 text-slate-500">{mode === 'login' ? 'Masuk untuk memulai operasional hari ini.' : 'Buat tenant baru lengkap dengan owner, outlet, dan warehouse pertama.'}</p>
        </div>
        <div className="mb-5 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
          <button type="button" onClick={() => { setMode('login'); setError(''); }} className={`h-11 rounded-xl text-sm font-black ${mode === 'login' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>Masuk</button>
          <button type="button" onClick={() => { setMode('register'); setError(''); setRegisterStep(0); }} className={`h-11 rounded-xl text-sm font-black ${mode === 'register' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>Bisnis Baru</button>
        </div>

        {mode === 'login' ? <form onSubmit={submit}>
          <label className="label">Username</label>
          <input className="input mb-4" name="username" autoComplete="username" defaultValue="owner" required />
          <label className="label">Password</label>
          <input className="input mb-3" name="password" type="password" autoComplete="current-password" defaultValue="owner123" required />
          {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="btn-primary mt-2 w-full">{busy ? 'Memproses...' : 'Masuk'}<ArrowRight size={18} /></button>
          <p className="mt-5 text-center text-xs text-slate-400">Demo: owner / owner123 · kasir / kasir123</p>
        </form> : <form onSubmit={registerBusiness} className="space-y-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {registerSteps.map((step, index) => <div key={step} className={`flex min-w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-black ${index <= registerStep ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${index <= registerStep ? 'bg-brand-600 text-white' : 'bg-white text-slate-400'}`}>{index + 1}</span>{step}
            </div>)}
          </div>

          {registerStep === 0 && <div className="space-y-3">
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="text-lg font-black">Register New Account</h3>
              <p className="mt-1 text-sm text-slate-500">Akun ini akan menjadi OWNER setelah business dibuat.</p>
            </div>
            <div><label className="label">Nama</label><input className="input" value={registerData.ownerName} onChange={e => updateRegister('ownerName', e.target.value)} placeholder="Nama lengkap" required /></div>
            <div><label className="label">Email / No. HP</label><input className="input" value={registerData.username} onChange={e => updateRegister('username', e.target.value)} autoComplete="username" placeholder="email atau nomor HP" required /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label">Password</label><input className="input" value={registerData.password} onChange={e => updateRegister('password', e.target.value)} type="password" autoComplete="new-password" required minLength={8} /></div>
              <div><label className="label">Konfirmasi</label><input className="input" value={registerData.confirmPassword} onChange={e => updateRegister('confirmPassword', e.target.value)} type="password" autoComplete="new-password" required minLength={8} /></div>
            </div>
          </div>}

          {registerStep === 1 && <div className="space-y-3">
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="text-lg font-black">Create Business</h3>
              <p className="mt-1 text-sm text-slate-500">Sistem otomatis membuat Business dan menghubungkan akun sebagai OWNER.</p>
            </div>
            <div><label className="label">Nama Business</label><input className="input" value={registerData.businessName} onChange={e => updateRegister('businessName', e.target.value)} placeholder="FORU Coffee" required /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label">Nama Owner</label><input className="input" value={registerData.ownerName} onChange={e => updateRegister('ownerName', e.target.value)} required /></div>
              <div><label className="label">No. HP</label><input className="input" value={registerData.phone} onChange={e => updateRegister('phone', e.target.value)} placeholder="08xxxx" /></div>
            </div>
          </div>}

          {registerStep === 2 && <div className="space-y-3">
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="flex items-center gap-2 text-lg font-black"><Store size={20} />Create First Outlet</h3>
              <p className="mt-1 text-sm text-slate-500">Outlet pertama langsung menjadi outlet aktif dan dibuatkan warehouse default.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label">Nama Outlet</label><input className="input" value={registerData.outletName} onChange={e => updateRegister('outletName', e.target.value)} placeholder="Outlet Pusat" required /></div>
              <div><label className="label">Kode Outlet</label><input className="input" value={registerData.outletCode} onChange={e => updateRegister('outletCode', e.target.value)} placeholder="OUTLET-01" required /></div>
            </div>
            <div><label className="label">Alamat optional</label><input className="input" value={registerData.outletAddress} onChange={e => updateRegister('outletAddress', e.target.value)} placeholder="Alamat outlet" /></div>
          </div>}

          {registerStep === 3 && <div className="space-y-3">
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="flex items-center gap-2 text-lg font-black"><Settings2 size={20} />Setup Awal</h3>
              <p className="mt-1 text-sm text-slate-500">MVP: payment method bawaan sudah aktif. Expense category dan printer bisa dirapikan setelah masuk Dashboard.</p>
            </div>
            {['Payment Method default aktif', 'Expense Category default dibuat', 'Printer bisa diset optional nanti'].map(item => <div key={item} className="flex items-center gap-3 rounded-2xl bg-brand-50 p-4 font-bold text-brand-800"><CheckCircle2 size={20} />{item}</div>)}
          </div>}

          {registerStep === 4 && <div className="space-y-3">
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="flex items-center gap-2 text-lg font-black"><PackagePlus size={20} />Product Setup</h3>
              <p className="mt-1 text-sm text-slate-500">Untuk onboarding awal, produk bisa ditambahkan setelah masuk. Klik selesai untuk masuk Dashboard.</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
              Setelah bisnis aktif, gunakan menu <span className="font-black text-brand-700">Produk</span> untuk tambah produk manual atau import Excel.
            </div>
          </div>}

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            {registerStep > 0 && <button type="button" disabled={busy} onClick={() => { setError(''); setRegisterStep(step => step - 1); }} className="btn-secondary flex-1"><ArrowLeft size={18} />Kembali</button>}
            <button disabled={busy} className="btn-primary flex-[2]">{busy ? 'Membuat bisnis...' : registerStep === registerSteps.length - 1 ? 'Selesai & Masuk Dashboard' : 'Lanjut'}<ArrowRight size={18} /></button>
          </div>
        </form>}
      </div>
    </section>
  </div>;
}
