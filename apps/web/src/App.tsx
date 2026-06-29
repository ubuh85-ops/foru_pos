import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ClipboardList, History, Layers3, LogOut, Menu, Percent, Printer, ReceiptText, ShoppingBag, Store, Tag, UserCog, X } from 'lucide-react';
import type { User } from './api';
import Login from './pages/Login';
import POS from './pages/POS';
import { Categories, Coupons, CustomerItemListPrint, Dashboard, Expenses, KitchenTicketPrint, Outlets, PrinterSettings, Products, ReceiptPrint, Reports, SaleDetail, Sales, Shift } from './pages/Pages';
import { OrderDetail, Orders } from './pages/Orders';
import VariantGroupsPage from './pages/VariantGroupsPage';
import UserManagementPage from './pages/UserManagementPage';
import { initSyncService, recordLocalAudit } from './sync';

const nav = [
  ['/pos', 'Kasir', ShoppingBag],
  ['/orders', 'Orders', ClipboardList],
  ['/shift', 'Shift', Store],
  ['/expenses', 'Pengeluaran', ReceiptText],
  ['/sales', 'Riwayat', History],
  ['/dashboard', 'Dashboard', BarChart3],
  ['/coupons', 'Kupon', Tag],
  ['/categories', 'Kategori', Layers3],
  ['/variant-groups', 'Variant', Layers3],
  ['/printers', 'Printer', Printer],
  ['/users', 'User Management', UserCog],
  ['/products', 'Produk', Menu],
  ['/outlets', 'Outlet', Store],
  ['/reports', 'Laporan', Percent]
] as const;

export default function App() {
  const [user, setUser] = useState<User | null>(() => JSON.parse(localStorage.getItem('user') || 'null'));
  useEffect(() => { initSyncService(); }, []);
  if (!user) return <Login onLogin={setUser} />;
  return <Routes><Route path="*" element={<Shell user={user} logout={() => { recordLocalAudit('LOGOUT','USER',user.id,{name:user.name}); localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); }} />} /></Routes>;
}

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const [open, setOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('foru:sidebar_hidden') === '1');
  const loc = useLocation();
  const navigate = useNavigate();
  const allowed = nav.filter(([p]) => user.role === 'OWNER' || !['/coupons', '/outlets', '/categories', '/variant-groups', '/printers', '/users'].includes(p));
  function toggleSidebar() { setSidebarHidden(v => { localStorage.setItem('foru:sidebar_hidden', v ? '0' : '1'); return !v; }); }
  useEffect(() => {
    if (!(window as any).Capacitor?.isNativePlatform?.()) return;
    if (!history.state?.foruBackGuard) history.replaceState({ ...(history.state || {}), foruBackGuard: true }, '', location.href);
    const keepAppOpen = () => {
      const mainPages = ['/pos', '/orders', '/shift'];
      if (mainPages.includes(location.pathname)) {
        history.pushState({ ...(history.state || {}), foruBackGuard: true }, '', location.href);
      }
    };
    window.addEventListener('popstate', keepAppOpen);
    return () => window.removeEventListener('popstate', keepAppOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    history.pushState({ ...(history.state || {}), foruSidebarOpen: true }, '', location.href);
    const closeSidebar = () => {
      setOpen(false);
      history.pushState({ ...(history.state || {}), foruBackGuard: true }, '', location.href);
    };
    window.addEventListener('popstate', closeSidebar, { once: true });
    return () => window.removeEventListener('popstate', closeSidebar);
  }, [open]);
  return <div className="min-h-screen max-w-full overflow-x-hidden lg:flex">
    {open && <button aria-label="Tutup menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] lg:hidden" />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(20rem,calc(100vw-3rem))] flex-col bg-ink p-4 text-white shadow-2xl transition-all sm:p-5 lg:static lg:translate-x-0 lg:shadow-none ${sidebarHidden ? 'lg:w-20 lg:px-3' : 'lg:w-72'} ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className={`mb-5 flex shrink-0 items-center ${sidebarHidden ? 'justify-center lg:mb-4' : 'justify-between sm:mb-8'}`}><button onClick={() => { navigate('/pos'); setOpen(false); }} className={`flex min-w-0 items-center gap-3 ${sidebarHidden ? 'lg:justify-center' : ''}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500 text-xl font-black">F</span><span className={`min-w-0 text-left ${sidebarHidden ? 'lg:hidden' : ''}`}><b className="block truncate text-lg">FORU POS</b><small className="block truncate text-white/60">jualan jadi ringan.</small></span></button><button onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-white/10 lg:hidden"><X /></button></div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 pb-4">{allowed.map(([p, label, Icon]) => <NavLink key={p} to={p} title={label} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl font-semibold ${sidebarHidden ? 'justify-center px-2 py-3' : 'px-4 py-3'} ${isActive ? 'bg-brand-500 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'}`}><Icon className="shrink-0" size={20} /><span className={`truncate ${sidebarHidden ? 'lg:hidden' : ''}`}>{label}</span></NavLink>)}</nav>
      <div className={`mt-4 shrink-0 rounded-2xl bg-white/5 ${sidebarHidden ? 'p-2 text-center' : 'p-4'}`}><b className={`block truncate ${sidebarHidden ? 'lg:hidden' : ''}`}>{user.name}</b><div className={`mb-3 truncate text-xs text-white/50 ${sidebarHidden ? 'lg:hidden' : ''}`}>{user.role}</div><button onClick={logout} title="Keluar" className={`flex items-center gap-2 text-sm text-white/70 ${sidebarHidden ? 'justify-center' : ''}`}><LogOut size={16} /><span className={sidebarHidden ? 'lg:hidden' : ''}>Keluar</span></button></div>
    </aside>
    <main className="min-w-0 max-w-full flex-1 overflow-x-hidden pb-20 lg:pb-0">
      <header className="sticky top-0 z-30 flex h-16 max-w-full items-center justify-between gap-3 overflow-hidden border-b bg-cream/90 px-4 backdrop-blur lg:px-8"><button onClick={() => setOpen(true)} className="shrink-0 lg:hidden"><Menu /></button><button onClick={toggleSidebar} title={sidebarHidden?'Tampilkan menu':'Sembunyikan menu'} className="hidden shrink-0 rounded-xl border bg-white p-2 text-slate-600 hover:bg-slate-50 lg:block"><Menu size={20}/></button><div className="min-w-0"><h1 className="truncate font-extrabold">{allowed.find(x => x[0] === loc.pathname)?.[1] || 'FORU POS'}</h1><p className="hidden text-xs text-slate-500 sm:block">Kelola operasional FORU dalam satu tempat</p></div><div className="ml-auto flex min-w-0 shrink-0 items-center gap-2"><span className="pill bg-brand-100 text-brand-700">{user.role}</span></div></header>
      <Routes>
        <Route path="/pos" element={<POS />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/shift" element={<Shift />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/sales/:id" element={<SaleDetail />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/coupons" element={user.role === 'OWNER' ? <Coupons /> : <Navigate to="/pos" />} />
        <Route path="/categories" element={user.role === 'OWNER' ? <Categories /> : <Navigate to="/pos" />} />
        <Route path="/variant-groups" element={user.role === 'OWNER' ? <VariantGroupsPage /> : <Navigate to="/pos" />} />
        <Route path="/printers" element={user.role === 'OWNER' ? <PrinterSettings /> : <Navigate to="/pos" />} />
        <Route path="/users" element={user.role === 'OWNER' ? <UserManagementPage /> : <Navigate to="/pos" />} />
        <Route path="/products" element={<Products />} />
        <Route path="/outlets" element={user.role === 'OWNER' ? <Outlets /> : <Navigate to="/pos" />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/receipt/:saleId" element={<ReceiptPrint />} />
        <Route path="/kitchen-ticket/:saleId" element={<KitchenTicketPrint />} />
        <Route path="/customer-item-list/:saleId" element={<CustomerItemListPrint />} />
        <Route path="*" element={<Navigate to={user.role === 'OWNER' ? '/dashboard' : '/pos'} replace />} />
      </Routes>
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t bg-white p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] lg:hidden">{allowed.slice(0, 3).map(([p, label, Icon]) => <NavLink key={p} to={p} className={({ isActive }) => `flex flex-col items-center gap-1 py-1 text-xs font-semibold ${isActive ? 'text-brand-600' : 'text-slate-400'}`}><Icon size={21} />{label}</NavLink>)}</nav>
  </div>;
}
