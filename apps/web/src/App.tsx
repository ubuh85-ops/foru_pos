import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ClipboardList, History, Layers3, LogOut, Menu, Percent, Printer, ReceiptText, ShoppingBag, Store, Tag, UserCog, X } from 'lucide-react';
import { api, type User } from './api';
import HeaderOutletSelector from './components/HeaderOutletSelector';
import { OutletProvider } from './OutletContext';
import Login from './pages/Login';
import OutletSelect from './pages/OutletSelect';
import POS from './pages/POS';
import Shift from './pages/ShiftPage';
import InventoryPage from './pages/InventoryPage';
import ProductPage from './pages/ProductPage';
import DashboardPage from './pages/DashboardPage';
import ReportsPage from './pages/ReportsPage';
import ExpensesPage from './pages/ExpensesPage';
import SalesHistoryPage from './pages/SalesHistoryPage';
import { Categories, Coupons, CustomerItemListPrint, KitchenTicketPrint, Outlets, PrinterSettings, ReceiptPrint, SaleDetail } from './pages/Pages';
import { OrderDetail, Orders } from './pages/Orders';
import VariantGroupsPage from './pages/VariantGroupsPage';
import UserManagementPage from './pages/UserManagementPage';
import { initSyncService, recordLocalAudit } from './sync';
import { checkInventoryStockAlerts } from './inventoryAlerts';
import ShiftBanner from './components/ShiftBanner';

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
  ,['/inventory', 'Inventory Dashboard', Store],
  ['/inventory/warehouses', 'Warehouse', Store],
  ['/inventory/items', 'Bahan Baku', Layers3],
  ['/inventory/stock-in', 'Stok Masuk', ReceiptText],
  ['/inventory/stock-out', 'Stok Keluar', ReceiptText],
  ['/inventory/transfers', 'Transfer Stock', ReceiptText],
  ['/inventory/adjustments', 'Penyesuaian Stok', Percent],
  ['/inventory/opname', 'Stock Opname', ClipboardList],
  ['/inventory/history', 'Riwayat Stok', History],
  ['/inventory/alerts', 'Notifikasi Stok', History]
] as const;

const inventoryRoutePermissions: Record<string, string> = {
  '/inventory': 'inventory.report',
  '/inventory/warehouses': 'inventory.warehouse',
  '/inventory/items': 'inventory.item_management',
  '/inventory/stock-in': 'inventory.stock_in',
  '/inventory/stock-out': 'inventory.stock_out',
  '/inventory/transfers': 'inventory.transfer',
  '/inventory/adjustments': 'inventory.adjustment',
  '/inventory/opname': 'inventory.opname',
  '/inventory/history': 'inventory.report',
  '/inventory/alerts': 'inventory.view'
};
function hasInventoryPermission(user: User, permission: string) {
  return user.role === 'OWNER' || (user.inventoryPermissions || []).includes(permission);
}
function canSeeInventoryPath(user: User, path: string) {
  if (!path.startsWith('/inventory')) return true;
  if (!hasInventoryPermission(user, 'inventory.view')) return false;
  return hasInventoryPermission(user, inventoryRoutePermissions[path] || 'inventory.view');
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => JSON.parse(localStorage.getItem('user') || 'null'));
  useEffect(() => { initSyncService(); }, []);
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    const refreshUser = () => api<any>('/auth/me').then(me => {
      if (!me) return;
      const next: User = { id: me.id, name: me.name, role: me.role, outletIds: me.outletIds || [], inventoryPermissions: me.inventoryPermissions || [] };
      localStorage.setItem('user', JSON.stringify(next));
      setUser(next);
    }).catch(() => {});
    refreshUser();
    const onFocus = () => refreshUser();
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshUser(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  if (!user) return <Login onLogin={setUser} />;
  return <OutletProvider user={user}><Routes><Route path="*" element={<Shell user={user} logout={() => { recordLocalAudit('LOGOUT','USER',user.id,{name:user.name}); localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); }} />} /></Routes></OutletProvider>;
}

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const [open, setOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('foru:sidebar_hidden') === '1');
  const loc = useLocation();
  const navigate = useNavigate();
  const allowed = nav.filter(([p]) => {
    if (!canSeeInventoryPath(user, p)) return false;
    return user.role === 'OWNER' || !['/coupons', '/outlets', '/categories', '/variant-groups', '/printers', '/users', '/reports'].includes(p);
  });
  function toggleSidebar() { setSidebarHidden(v => { localStorage.setItem('foru:sidebar_hidden', v ? '0' : '1'); return !v; }); }
  useEffect(() => {
    if (localStorage.getItem('foru:must_select_outlet') === '1' && loc.pathname !== '/select-outlet') {
      navigate('/select-outlet', { replace: true });
    }
  }, [loc.pathname, navigate]);
  useEffect(() => {
    if (!hasInventoryPermission(user, 'inventory.view')) return;
    const run = () => checkInventoryStockAlerts().catch(() => {});
    run();
    const timer = window.setInterval(run, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [user.role]);
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
  if (loc.pathname === '/select-outlet') return <Routes>
    <Route path="/select-outlet" element={<OutletSelect user={user} logout={logout} />} />
    <Route path="*" element={<Navigate to="/select-outlet" replace />} />
  </Routes>;

  return <div className="min-h-screen max-w-full overflow-x-hidden md:flex">
    {open && <button aria-label="Tutup menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] md:hidden" />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(20rem,calc(100vw-3rem))] flex-col border-r border-slate-200 bg-white p-4 text-ink shadow-sm transition-all sm:p-5 md:static md:translate-x-0 ${sidebarHidden ? 'md:w-20 md:min-w-20 md:max-w-20 md:basis-20 md:px-3' : 'md:w-72 md:min-w-72 md:max-w-72 md:basis-72 md:px-5'} ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className={`mb-5 flex shrink-0 items-center ${sidebarHidden ? 'justify-center md:mb-4' : 'justify-between sm:mb-8'}`}><button onClick={() => { navigate('/pos'); setOpen(false); }} className={`flex min-w-0 items-center gap-3 ${sidebarHidden ? 'md:justify-center' : ''}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500 text-xl font-black text-white">F</span><span className={`min-w-0 text-left ${sidebarHidden ? 'md:hidden' : 'md:block'}`}><b className="block truncate text-lg font-semibold">FORU POS</b><small className="block truncate text-slate-500">jualan jadi ringan.</small></span></button><button onClick={() => setOpen(false)} className="rounded-xl p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-700 md:hidden"><X /></button></div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0 pb-4">{allowed.map(([p, label, Icon]) => <NavLink key={p} to={p} title={label} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-2xl font-semibold ${sidebarHidden ? 'justify-center px-0 py-3' : 'px-4 py-3 md:justify-start md:px-4'} ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700'}`}><Icon className="shrink-0 text-brand-600" size={20} /><span className={`truncate ${sidebarHidden ? 'md:hidden' : 'md:inline'}`}>{label}</span></NavLink>)}</nav>
      <div className={`mt-4 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 ${sidebarHidden ? 'p-2 text-center' : 'p-4 text-left'}`}><b className={`block truncate font-semibold ${sidebarHidden ? 'md:hidden' : 'md:block'}`}>{user.name}</b><div className={`mb-3 truncate text-xs text-slate-500 ${sidebarHidden ? 'md:hidden' : 'md:block'}`}>{user.role}</div><button onClick={logout} title="Keluar" className={`flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-700 ${sidebarHidden ? 'justify-center' : 'justify-start'}`}><LogOut size={16} /><span className={sidebarHidden ? 'md:hidden' : 'md:inline'}>Keluar</span></button></div>
    </aside>
    <main className="min-w-0 max-w-full flex-1 overflow-x-hidden pb-20 md:pb-0">
      <header className="sticky top-0 z-30 flex h-16 max-w-full items-center justify-between gap-3 overflow-hidden border-b border-slate-200 bg-white px-4 md:px-6 lg:px-8"><button onClick={() => setOpen(true)} className="shrink-0 text-slate-700 md:hidden"><Menu /></button><button onClick={toggleSidebar} title={sidebarHidden?'Tampilkan menu':'Sembunyikan menu'} className="hidden shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-brand-50 hover:text-brand-700 md:block"><Menu size={20}/></button><HeaderOutletSelector /><ShiftBanner /><div className="ml-auto flex min-w-0 shrink-0 items-center gap-2"><span className="pill bg-brand-100 text-brand-700">{user.role}</span></div></header>
      <Routes>
        <Route path="/pos" element={<POS />} />
        <Route path="/select-outlet" element={<OutletSelect user={user} logout={logout} />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/shift" element={<Shift />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/sales" element={<SalesHistoryPage />} />
        <Route path="/sales/:id" element={<SaleDetail />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/coupons" element={user.role === 'OWNER' ? <Coupons /> : <Navigate to="/pos" />} />
        <Route path="/categories" element={user.role === 'OWNER' ? <Categories /> : <Navigate to="/pos" />} />
        <Route path="/variant-groups" element={user.role === 'OWNER' ? <VariantGroupsPage /> : <Navigate to="/pos" />} />
        <Route path="/printers" element={user.role === 'OWNER' ? <PrinterSettings /> : <Navigate to="/pos" />} />
        <Route path="/users" element={user.role === 'OWNER' ? <UserManagementPage /> : <Navigate to="/pos" />} />
        <Route path="/products" element={<ProductPage />} />
        <Route path="/outlets" element={user.role === 'OWNER' ? <Outlets /> : <Navigate to="/pos" />} />
        <Route path="/reports" element={user.role === 'OWNER' ? <ReportsPage /> : <Navigate to="/pos" />} />
        <Route path="/inventory/*" element={hasInventoryPermission(user, 'inventory.view') ? <InventoryPage user={user} /> : <Navigate to="/pos" />} />
        <Route path="/receipt/:saleId" element={<ReceiptPrint />} />
        <Route path="/kitchen-ticket/:saleId" element={<KitchenTicketPrint />} />
        <Route path="/customer-item-list/:saleId" element={<CustomerItemListPrint />} />
        <Route path="*" element={<Navigate to="/select-outlet" replace />} />
      </Routes>
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t bg-white p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] md:hidden">{allowed.slice(0, 3).map(([p, label, Icon]) => <NavLink key={p} to={p} className={({ isActive }) => `flex flex-col items-center gap-1 py-1 text-xs font-semibold ${isActive ? 'text-brand-600' : 'text-slate-400'}`}><Icon size={21} />{label}</NavLink>)}</nav>
  </div>;
}
