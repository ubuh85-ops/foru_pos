import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type User } from './api';

export type Outlet = {
  id: string;
  code?: string;
  name: string;
  status?: string;
  autoPrintReceipt?: boolean;
  autoPrintKitchen?: boolean;
  autoPrintCustomerItemList?: boolean;
  customerOrderingEnabled?: boolean;
  acceptingCustomerOrders?: boolean;
};

type OutletContextValue = {
  outletList: Outlet[];
  selectedOutlet: Outlet | null;
  selectedOutletId: string;
  setSelectedOutletId: (outletId: string) => void;
  setSelectedOutlet: (outlet: Outlet | null) => void;
  refreshOutlets: () => Promise<void>;
};

const OutletContext = createContext<OutletContextValue | null>(null);

function userAllowedOutlets(user: User, rows: Outlet[]) {
  if (user.role === 'OWNER') return rows;
  const allowed = new Set(user.outletIds || []);
  return rows.filter(outlet => allowed.has(outlet.id));
}

function businessIdOf(user: User) {
  return user.business?.id || user.businessId || user.membership?.businessId || '';
}

export function OutletProvider({ user, children }: { user: User; children: ReactNode }) {
  const [outletList, setOutletList] = useState<Outlet[]>([]);
  const [selectedOutletIdState, setSelectedOutletIdState] = useState(() => localStorage.getItem('outletId') || '');
  const businessId = businessIdOf(user);

  const setSelectedOutletId = useCallback((outletId: string) => {
    setSelectedOutletIdState(outletId);
    if (outletId) {
      localStorage.setItem('outletId', outletId);
      localStorage.removeItem('foru:must_select_outlet');
    } else {
      localStorage.removeItem('outletId');
    }
    window.dispatchEvent(new CustomEvent('foru:outlet-changed', { detail: { outletId } }));
  }, []);

  const refreshOutlets = useCallback(async () => {
    const storedBusinessId = localStorage.getItem('foru:business_id') || '';
    if (businessId && storedBusinessId && storedBusinessId !== businessId) {
      localStorage.setItem('foru:business_id', businessId);
      localStorage.removeItem('outletId');
      localStorage.setItem('foru:must_select_outlet', '1');
      setSelectedOutletIdState('');
    } else if (businessId && !storedBusinessId) {
      localStorage.setItem('foru:business_id', businessId);
    }

    const rows = await api<Outlet[]>('/outlets');
    const allowed = userAllowedOutlets(user, rows);
    setOutletList(allowed);

    const stored = localStorage.getItem('outletId') || '';
    const current = selectedOutletIdState;
    const mustSelectOutlet = localStorage.getItem('foru:must_select_outlet') === '1';
    const currentIsValid = !!allowed.find(outlet => outlet.id === current);
    const storedIsValid = !!allowed.find(outlet => outlet.id === stored);
    const next = currentIsValid
      ? current
      : storedIsValid && !mustSelectOutlet
        ? stored
        : !mustSelectOutlet && allowed.length === 1
          ? allowed[0].id
          : '';

    if (next !== current) setSelectedOutletId(next);
  }, [businessId, selectedOutletIdState, setSelectedOutletId, user]);

  useEffect(() => {
    refreshOutlets().catch(() => setOutletList([]));
  }, [refreshOutlets]);

  useEffect(() => {
    const syncFromStorage = () => setSelectedOutletIdState(localStorage.getItem('outletId') || '');
    window.addEventListener('storage', syncFromStorage);
    return () => window.removeEventListener('storage', syncFromStorage);
  }, []);

  const selectedOutlet = useMemo(
    () => outletList.find(outlet => outlet.id === selectedOutletIdState) || null,
    [outletList, selectedOutletIdState]
  );

  const value = useMemo<OutletContextValue>(() => ({
    outletList,
    selectedOutlet,
    selectedOutletId: selectedOutletIdState,
    setSelectedOutletId,
    setSelectedOutlet: outlet => setSelectedOutletId(outlet?.id || ''),
    refreshOutlets
  }), [outletList, refreshOutlets, selectedOutlet, selectedOutletIdState, setSelectedOutletId]);

  return <OutletContext.Provider value={value}>{children}</OutletContext.Provider>;
}

export function useOutlet() {
  const context = useContext(OutletContext);
  if (!context) throw new Error('useOutlet must be used inside OutletProvider');
  return context;
}
