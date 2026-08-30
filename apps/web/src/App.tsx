import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { BarChart3, Boxes, Calculator, CalendarDays, ChevronDown, ClipboardList, Clock3, Layers, LayoutDashboard, LogOut, Menu, Package, PackageSearch, Printer, Settings, ShoppingCart, Smartphone, Store, Tags, TrendingUp, Users, Wallet, Warehouse, X } from 'lucide-react';
import { api, clearAuthSession, SESSION_EXPIRED_EVENT, type User } from './api';
import HeaderOutletSelector from './components/HeaderOutletSelector';
import { ConfirmDialog } from './components/ForuDialog';
import NewOrderNotifier from './components/NewOrderNotifier';
import AndroidOrderPush, { deactivateAndroidOrderPush } from './components/AndroidOrderPush';
import { OutletProvider } from './OutletContext';
import Login from './pages/Login';
import OutletSelect from './pages/OutletSelect';
import POS from './pages/POS';
import Shift from './pages/ShiftPage';
import InventoryPage from './pages/InventoryPage';
import ProductPage from './pages/ProductPage';
import OutletPage from './pages/OutletPage';
import DashboardPage from './pages/DashboardPage';
import ReportsPage from './pages/ReportsPage';
import ExpensesPage from './pages/ExpensesPage';
import SalesHistoryPage from './pages/SalesHistoryPage';
import { Coupons, CustomerItemListPrint, KitchenTicketPrint, PrinterSettings, ReceiptPrint, SaleDetail } from './pages/Pages';
import SettingsPage from './pages/SettingsPage';
import { OrderDetail, Orders } from './pages/Orders';
import VariantGroupsPage from './pages/VariantGroupsPage';
import UserManagementPage from './pages/UserManagementPage';
import CustomerOrderPage from './pages/CustomerOrderPage';
import CustomerOrderStatusPage from './pages/CustomerOrderStatusPage';
import PreOrderRecapPage from './pages/PreOrderRecapPage';
import MenuAvailabilityPage from './pages/MenuAvailabilityPage';
import CategoriesPage from './pages/CategoriesPage';
import { initSyncService, recordLocalAudit } from './sync';
import { checkInventoryStockAlerts } from './inventoryAlerts';
import ShiftBanner from './components/ShiftBanner';
import { AppDialog } from './components/ui/AppDialog';

type NavItem = readonly [path: string, label: string, Icon: typeof LayoutDashboard];
type NavGroup = { key: string; label: string; items: NavItem[] };

const dashboardNav: NavItem = ['/dashboard', 'Dashboard', LayoutDashboard];
const navGroups: NavGroup[] = [
  {
    key: 'master',
    label: 'MASTER DATA',
    items: [
      ['/products', 'Produk', Package],
      ['/categories', 'Kategori', Tags],
      ['/variant-groups', 'Variant Group', Layers],
      ['/inventory/items', 'Bahan Baku', Boxes],
      ['/inventory/warehouses', 'Warehouse', Warehouse],
      ['/outlets', 'Outlet', Store]
    ]
  },
  {
    key: 'operasional',
    label: 'OPERASIONAL',
    items: [
      ['/pos', 'POS / Kasir', ShoppingCart],
      ['/menu-availability', 'Ketersediaan Menu', PackageSearch],
      ['/orders', 'Order', ClipboardList],
      ['/orders/preorder-recap', 'Rekap Pre-Order', CalendarDays],
      ['/shift', 'Shift', Clock3],
      ['/inventory', 'Inventory', PackageSearch],
      ['/expenses', 'Pengeluaran', Wallet]
    ]
  },
  {
    key: 'laporan',
    label: 'LAPORAN',
    items: [
      ['/reports', 'Penjualan', BarChart3],
      ['/inventory/history', 'Inventory', Boxes],
      ['/reports', 'COGS', Calculator],
      ['/reports', 'Profit & Loss', TrendingUp]
    ]
  },
  {
    key: 'pengaturan',
    label: 'PENGATURAN',
    items: [
      ['/printers', 'Printer', Printer],
      ['/users', 'User & Akses', Users],
      ['/device', 'Device', Smartphone],
      ['/settings', 'Settings', Settings]
    ]
  }
];

const bottomNav: NavItem[] = [
  ['/pos', 'Kasir', ShoppingCart],
  ['/orders', 'Orders', ClipboardList],
  ['/shift', 'Shift', Clock3]
];

function businessIdOf(user: Partial<User> | null | undefined) {
  return user?.business?.id || user?.businessId || user?.membership?.businessId || '';
}

const knownRoutes = new Set([
  '/pos',
  '/menu-availability',
  '/orders',
  '/orders/preorder-recap',
  '/shift',
  '/expenses',
  '/sales',
  '/dashboard',
  '/coupons',
  '/categories',
  '/variant-groups',
  '/printers',
  '/users',
  '/device',
  '/settings',
  '/products',
  '/outlets',
  '/reports',
  '/inventory',
  '/inventory/warehouses',
  '/inventory/items',
  '/inventory/stock-in',
  '/inventory/stock-out',
  '/inventory/transfers',
  '/inventory/adjustments',
  '/inventory/opname',
  '/inventory/history',
  '/inventory/alerts',
  '/select-outlet'
]);

const inventoryRoutePermissions: Record<string, string> = {
  '/inventory': 'inventory.dashboard',
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
  return user.role === 'OWNER' || (user.inventoryPermissions || []).includes(permission) || (permission === 'inventory.dashboard' && (user.inventoryPermissions || []).includes('inventory.report'));
}
function hasUserPermission(user: User, permission: string) {
  return user.role === 'OWNER' || (user.inventoryPermissions || []).includes(permission);
}
function canSeeInventoryPath(user: User, path: string) {
  if (!path.startsWith('/inventory')) return true;
  if (!hasInventoryPermission(user, 'inventory.view')) return false;
  return hasInventoryPermission(user, inventoryRoutePermissions[path] || 'inventory.view');
}

function canSeePath(user: User, path: string) {
  if (!knownRoutes.has(path)) return false;
  if (path === '/dashboard') return hasUserPermission(user, 'dashboard.view');
  if (!canSeeInventoryPath(user, path)) return false;
  return user.role === 'OWNER' || !['/coupons', '/outlets', '/categories', '/variant-groups', '/printers', '/users', '/reports'].includes(path);
}

function isVisibleElement(el: Element) {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function clickTopModalClose() {
  const modals = Array.from(document.querySelectorAll<HTMLElement>('[data-back-modal="true"], [role="dialog"], .fixed.inset-0')).filter(isVisibleElement);
  const modal = modals.at(-1);
  if (!modal) return false;
  const closeButtons = Array.from(modal.querySelectorAll<HTMLButtonElement>('[data-back-close="true"], [aria-label*="Tutup"], [aria-label*="Close"], button')).filter(isVisibleElement);
  const preferred = closeButtons.find(button => {
    if (button.dataset.backClose === 'true') return true;
    const text = (button.textContent || '').trim().toLowerCase();
    return ['×', '✕', 'x', 'batal', 'tutup', 'close', 'ok'].includes(text);
  }) || closeButtons[0];
  if (!preferred) return false;
  preferred.click();
  return true;
}

function clearActiveSearch() {
  const active = document.activeElement;
  const candidates = [
    ...(active instanceof HTMLInputElement ? [active] : []),
    ...Array.from(document.querySelectorAll<HTMLInputElement>('input[type="search"], input[placeholder*="Cari"], input[placeholder*="Search"]'))
  ];
  const input = candidates.find(el => isVisibleElement(el) && el.value && (el.type === 'search' || /cari|search/i.test(el.placeholder || '')));
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  return true;
}

const rootPages = new Set([
  '/pos',
  '/orders',
  '/shift',
  '/expenses',
  '/sales',
  '/dashboard',
  '/coupons',
  '/categories',
  '/variant-groups',
  '/printers',
  '/users',
  '/device',
  '/settings',
  '/products',
  '/outlets',
  '/reports',
  '/inventory',
  '/inventory/warehouses',
  '/inventory/items',
  '/inventory/stock-in',
  '/inventory/stock-out',
  '/inventory/transfers',
  '/inventory/adjustments',
  '/inventory/opname',
  '/inventory/history',
  '/inventory/alerts',
  '/select-outlet'
]);

export default function App() {
  const loc = useLocation();
  const [user, setUser] = useState<User | null>(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [sessionExpiredOpen, setSessionExpiredOpen] = useState(false);
  useEffect(() => { initSyncService(); }, []);
  useEffect(() => {
    const onSessionExpired = () => {
      if (!localStorage.getItem('token')) return;
      setSessionExpiredOpen(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    const refreshUser = () => api<any>('/auth/me').then(me => {
      if (!me) return;
      const next: User = {
        id: me.id,
        name: me.name,
        role: me.role,
        outletIds: me.outletIds || [],
        inventoryPermissions: me.inventoryPermissions || [],
        assignedWarehouseId: me.assignedWarehouseId || null,
        businessId: me.business?.id || me.businessId || me.membership?.businessId,
        business: me.business,
        membership: me.membership
      };
      const previousBusinessId = localStorage.getItem('foru:business_id') || '';
      const nextBusinessId = businessIdOf(next);
      if (previousBusinessId && nextBusinessId && previousBusinessId !== nextBusinessId) {
        localStorage.removeItem('outletId');
        localStorage.setItem('foru:must_select_outlet', '1');
      }
      if (nextBusinessId) localStorage.setItem('foru:business_id', nextBusinessId);
      const currentOutletId = localStorage.getItem('outletId') || '';
      if (currentOutletId && !next.outletIds.includes(currentOutletId)) {
        localStorage.removeItem('outletId');
        localStorage.setItem('foru:must_select_outlet', '1');
      }
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
  const sessionExpiredDialog = sessionExpiredOpen && user ? <AppDialog
    title="Sesi Berakhir"
    description="Silakan login kembali untuk melanjutkan."
    tone="warning"
    buttons={[{
      label: 'Login Ulang',
      variant: 'primary',
      onClick: () => {
        clearAuthSession();
        setSessionExpiredOpen(false);
        setUser(null);
      }
    }]}
  /> : null;
  if (loc.pathname.startsWith('/order/')) return <Routes>
    <Route path="/order/status/:token" element={<CustomerOrderStatusPage />} />
    <Route path="/order/:businessSlug/:outletSlug" element={<CustomerOrderPage />} />
    <Route path="*" element={<Navigate to="/order/status/invalid" replace />} />
  </Routes>;
  if (!user) return <>{sessionExpiredDialog}<Login onLogin={setUser} /></>;
  return <OutletProvider user={user}><NewOrderNotifier /><AndroidOrderPush /><Routes><Route path="*" element={<Shell user={user} logout={() => { recordLocalAudit('LOGOUT','USER',user.id,{name:user.name}); void deactivateAndroidOrderPush().catch(() => {}).finally(() => { clearAuthSession(); setUser(null); }); }} />} /></Routes>{sessionExpiredDialog}</OutletProvider>;
}

function Shell({ user, logout }: { user: User; logout: () => void }) {
  const [open, setOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    const saved = localStorage.getItem('foru:sidebar_hidden');
    if (saved) return saved === '1';
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches;
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('foru:sidebar_groups') || '{}');
    } catch {
      return {};
    }
  });
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const dashboardAllowed = canSeePath(user, dashboardNav[0]);
  const visibleGroups = navGroups
    .map(group => ({ ...group, items: group.items.filter(([path]) => canSeePath(user, path)) }))
    .filter(group => group.items.length > 0);
  const mobileAllowed = bottomNav.filter(([path]) => canSeePath(user, path));
  function toggleSidebar() { setSidebarHidden(v => { localStorage.setItem('foru:sidebar_hidden', v ? '0' : '1'); return !v; }); }
  function toggleGroup(key: string) {
    setOpenGroups(current => {
      const next = { ...current, [key]: !(current[key] ?? true) };
      localStorage.setItem('foru:sidebar_groups', JSON.stringify(next));
      return next;
    });
  }
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
    if (Capacitor.getPlatform() !== 'android') return;
    let mounted = true;
    let remove: (() => void) | undefined;
    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (clickTopModalClose()) return;
      if (open) { setOpen(false); return; }
      if (clearActiveSearch()) return;
      if (!rootPages.has(loc.pathname) && canGoBack) { navigate(-1); return; }
      if (!rootPages.has(loc.pathname)) {
        const fallback = loc.pathname.startsWith('/orders/') ? '/orders'
          : loc.pathname.startsWith('/sales/') ? '/sales'
            : loc.pathname.startsWith('/inventory/') ? '/inventory'
              : '/pos';
        navigate(fallback);
        return;
      }
      setExitConfirmOpen(true);
    }).then(handle => {
      if (!mounted) handle.remove();
      else remove = () => handle.remove();
    });
    return () => {
      mounted = false;
      remove?.();
    };
  }, [loc.pathname, navigate, open]);
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
    <aside className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(20rem,calc(100vw-3rem))] flex-col border-r border-slate-200 bg-white p-4 text-ink shadow-sm transition-all sm:p-5 md:static md:translate-x-0 ${sidebarHidden ? 'md:w-20 md:min-w-20 md:max-w-20 md:basis-20 md:px-3' : 'md:w-[17.5rem] md:min-w-[17.5rem] md:max-w-[17.5rem] md:basis-[17.5rem] md:px-4'} ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className={`mb-5 flex shrink-0 items-center ${sidebarHidden ? 'justify-center md:mb-4' : 'justify-between sm:mb-8'}`}><button onClick={() => { navigate('/pos'); setOpen(false); }} className={`flex min-w-0 items-center gap-3 ${sidebarHidden ? 'md:justify-center' : ''}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500 text-xl font-black text-white">F</span><span className={`min-w-0 text-left ${sidebarHidden ? 'md:hidden' : 'md:block'}`}><b className="block truncate text-lg font-semibold">FORU POS</b><small className="block truncate text-slate-500">jualan jadi ringan.</small></span></button><button onClick={() => setOpen(false)} className="rounded-xl p-2 text-slate-500 hover:bg-brand-50 hover:text-brand-700 md:hidden"><X /></button></div>
      <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0 pb-4">
        {dashboardAllowed && <NavLink
          to={dashboardNav[0]}
          title={dashboardNav[1]}
          onClick={() => setOpen(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-xl font-semibold ${sidebarHidden ? 'justify-center px-0 py-3' : 'justify-start px-3 py-3 text-left'} ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700'}`}
        >
          <LayoutDashboard className="shrink-0 text-brand-600" size={20} />
          <span className={`truncate ${sidebarHidden ? 'md:hidden' : 'md:inline'}`}>Dashboard</span>
        </NavLink>}

        {visibleGroups.map(group => {
          const expanded = openGroups[group.key] ?? true;
          return <section key={group.key} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              title={group.label}
              className={`flex w-full items-center rounded-xl text-[11px] font-black uppercase tracking-[0.12em] text-slate-400 hover:bg-slate-50 ${sidebarHidden ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2'}`}
            >
              <span className={sidebarHidden ? 'md:hidden' : 'md:inline'}>{group.label}</span>
              <span className={sidebarHidden ? 'hidden' : 'inline-flex'}>
                <ChevronDown size={15} className={`transition ${expanded ? 'rotate-0' : '-rotate-90'}`} />
              </span>
              {sidebarHidden && <span className="hidden h-1.5 w-1.5 rounded-full bg-slate-300 md:block" />}
            </button>
            {expanded && <div className="space-y-1">
              {group.items.map(([path, label, Icon]) => <NavLink
                key={`${group.key}-${label}-${path}`}
                to={path}
                title={label}
                end={path === '/inventory'}
                onClick={() => setOpen(false)}
                className={({ isActive }) => `flex items-center gap-3 rounded-xl font-semibold ${sidebarHidden ? 'justify-center px-0 py-3' : 'justify-start px-3 py-2.5 text-left'} ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-700'}`}
              >
                <Icon className="shrink-0 text-brand-600" size={20} />
                <span className={`truncate ${sidebarHidden ? 'md:hidden' : 'md:inline'}`}>{label}</span>
              </NavLink>)}
            </div>}
          </section>;
        })}
      </nav>
      <div className={`mt-4 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 ${sidebarHidden ? 'p-2 text-center' : 'p-4 text-left'}`}><b className={`block truncate font-semibold ${sidebarHidden ? 'md:hidden' : 'md:block'}`}>{user.name}</b><div className={`mb-3 truncate text-xs text-slate-500 ${sidebarHidden ? 'md:hidden' : 'md:block'}`}>{user.role}</div><button onClick={logout} title="Keluar" className={`flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-700 ${sidebarHidden ? 'justify-center' : 'justify-start'}`}><LogOut size={16} /><span className={sidebarHidden ? 'md:hidden' : 'md:inline'}>Keluar</span></button></div>
    </aside>
    <main className="min-w-0 max-w-full flex-1 overflow-x-hidden pb-20 md:pb-0">
      <header className="sticky top-0 z-30 flex h-16 max-w-full items-center justify-between gap-3 overflow-hidden border-b border-slate-200 bg-white px-4 md:px-6 lg:px-8"><button onClick={() => setOpen(true)} className="shrink-0 text-slate-700 md:hidden"><Menu /></button><button onClick={toggleSidebar} title={sidebarHidden?'Tampilkan menu':'Sembunyikan menu'} className="hidden shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-brand-50 hover:text-brand-700 md:block"><Menu size={20}/></button><HeaderOutletSelector /><ShiftBanner /><div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">{user.role === 'OWNER' && <button onClick={() => navigate('/users')} className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-brand-50 hover:text-brand-700 sm:flex"><Users size={16} /> User</button>}<span className="pill bg-brand-100 text-brand-700">{user.role}</span></div></header>
      <Routes>
        <Route path="/pos" element={<POS />} />
        <Route path="/menu-availability" element={<MenuAvailabilityPage />} />
        <Route path="/select-outlet" element={<OutletSelect user={user} logout={logout} />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/preorder-recap" element={<PreOrderRecapPage />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/shift" element={<Shift />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/sales" element={<SalesHistoryPage />} />
        <Route path="/sales/:id" element={<SaleDetail />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/coupons" element={user.role === 'OWNER' ? <Coupons /> : <Navigate to="/pos" />} />
        <Route path="/categories" element={user.role === 'OWNER' ? <CategoriesPage /> : <Navigate to="/pos" />} />
        <Route path="/variant-groups" element={user.role === 'OWNER' ? <VariantGroupsPage /> : <Navigate to="/pos" />} />
        <Route path="/printers" element={user.role === 'OWNER' ? <PrinterSettings /> : <Navigate to="/pos" />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/users" element={user.role === 'OWNER' ? <UserManagementPage /> : <Navigate to="/pos" />} />
        <Route path="/products" element={<ProductPage />} />
        <Route path="/outlets" element={user.role === 'OWNER' ? <OutletPage /> : <Navigate to="/pos" />} />
        <Route path="/reports" element={user.role === 'OWNER' ? <ReportsPage /> : <Navigate to="/pos" />} />
        <Route path="/inventory/*" element={hasInventoryPermission(user, 'inventory.view') ? <InventoryPage user={user} /> : <Navigate to="/pos" />} />
        <Route path="/receipt/:saleId" element={<ReceiptPrint />} />
        <Route path="/kitchen-ticket/:saleId" element={<KitchenTicketPrint />} />
        <Route path="/customer-item-list/:saleId" element={<CustomerItemListPrint />} />
        <Route path="*" element={<Navigate to="/select-outlet" replace />} />
      </Routes>
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t bg-white p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] md:hidden">{mobileAllowed.map(([p, label, Icon]) => <NavLink key={p} to={p} className={({ isActive }) => `flex flex-col items-center gap-1 py-1 text-xs font-semibold ${isActive ? 'text-brand-600' : 'text-slate-400'}`}><Icon size={21} />{label}</NavLink>)}</nav>
    {exitConfirmOpen && <ConfirmDialog
      tone="danger"
      title="Keluar Aplikasi?"
      description="Apakah Anda yakin ingin keluar dari FORU POS?"
      cancelText="Batal"
      confirmText="Keluar"
      onCancel={() => setExitConfirmOpen(false)}
      onConfirm={() => { setExitConfirmOpen(false); CapacitorApp.exitApp(); }}
    />}
  </div>;
}
