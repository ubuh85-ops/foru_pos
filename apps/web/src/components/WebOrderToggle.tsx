import { useState } from 'react';
import { Store } from 'lucide-react';
import { api } from '../api';
import { useOutlet } from '../OutletContext';
import { toast } from '../toast';

export default function WebOrderToggle() {
  const { selectedOutlet, refreshOutlets } = useOutlet();
  const [saving, setSaving] = useState(false);
  if (!selectedOutlet?.customerOrderingEnabled) return null;
  const open = selectedOutlet.acceptingCustomerOrders !== false;
  async function toggle() {
    if (!selectedOutlet || saving) return;
    try {
      setSaving(true);
      await api(`/outlets/${selectedOutlet.id}/customer-orders`, { method: 'PATCH', body: JSON.stringify({ acceptingCustomerOrders: !open }) });
      await refreshOutlets();
      toast.success(!open ? 'Web Order dibuka.' : 'Web Order ditutup sementara.');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return <button type="button" onClick={toggle} disabled={saving} title={open ? 'Tutup Web Order sementara' : 'Buka Web Order'} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition disabled:opacity-50 ${open ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>
    <Store size={17} />
    <span className="hidden lg:inline">{saving ? 'Memproses...' : open ? 'Web Order Buka' : 'Web Order Tutup'}</span>
  </button>;
}
