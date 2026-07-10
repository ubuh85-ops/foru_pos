import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, rupiah } from '../api';
import { useOutlet } from '../OutletContext';

export default function ShiftBanner({ activeShift: providedShift }: { activeShift?: any }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedOutletId } = useOutlet();
  const [loadedShift, setLoadedShift] = useState<any>(null);
  const activeShift = providedShift ?? loadedShift;

  useEffect(() => {
    if (providedShift !== undefined) return;
    let alive = true;

    async function load() {
      if (!selectedOutletId) {
        if (alive) setLoadedShift(null);
        return;
      }
      try {
        const active = await api<any>(`/outlets/${selectedOutletId}/active-shift`).catch(async () => {
          const legacy = await api<any>(`/cash-sessions/active?outletId=${selectedOutletId}`);
          return legacy?.outletId === selectedOutletId ? legacy : null;
        });
        if (alive) setLoadedShift(active);
      } catch {
        if (alive) setLoadedShift(null);
      }
    }

    load();
    const onRefresh = () => load();
    window.addEventListener('focus', onRefresh);
    window.addEventListener('foru:shift-changed', onRefresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('foru:shift-changed', onRefresh);
    };
  }, [location.pathname, providedShift, selectedOutletId]);

  if (!selectedOutletId) return null;

  if (!activeShift) {
    return (
      <>
        <button onClick={() => navigate('/shift')} className="btn-primary min-h-10 shrink-0 px-3 text-xs md:hidden">
          <Power size={16} /> Buka Kasir
        </button>
        <div className="hidden h-12 min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 text-sm text-amber-900 shadow-sm md:flex">
          <div className="min-w-0 truncate">
            <b>Shift belum dibuka.</b> <span className="hidden lg:inline">Silakan buka kasir untuk mulai transaksi.</span>
          </div>
          <button onClick={() => navigate('/shift')} className="btn-primary min-h-9 shrink-0 px-3 text-xs">
            <Power size={16} /> Buka Kasir
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="hidden h-12 min-w-0 flex-1 items-center rounded-2xl border border-brand-100 bg-brand-50 px-3 text-sm text-brand-800 shadow-sm md:flex">
      <span className="truncate">
        <b>Shift aktif:</b> {activeShift.shiftNumber || activeShift.shift_number || '-'} · Dibuka oleh{' '}
        {activeShift.openedBy || activeShift.opened_by || activeShift.cashier?.name || '-'} · Kas awal{' '}
        {rupiah(activeShift.openingCash || activeShift.opening_cash || 0)}
      </span>
    </div>
  );
}
