import { ChevronDown } from 'lucide-react';
import { type User } from '../api';
import { useOutlet } from '../OutletContext';

export default function HeaderOutletSelector() {
  const { outletList, selectedOutlet, selectedOutletId, setSelectedOutletId } = useOutlet();
  const user = JSON.parse(localStorage.getItem('user') || 'null') as User | null;
  const businessName = user?.business?.name || user?.business?.code || '';

  return (
    <label className="relative flex h-12 min-w-0 max-w-[13rem] shrink items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 font-semibold text-slate-700 shadow-sm sm:max-w-[18rem] md:min-w-[13rem]">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${selectedOutlet ? 'bg-green-600' : 'bg-red-500'}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-tight">{selectedOutlet?.name || 'Pilih outlet'}</span>
        {businessName && <span className="hidden truncate text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:block">{businessName}</span>}
      </span>
      <ChevronDown className="shrink-0 text-slate-400" size={17} />
      <select
        aria-label="Pilih outlet aktif"
        value={selectedOutletId}
        onChange={e => setSelectedOutletId(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {!selectedOutletId && <option value="">Pilih outlet</option>}
        {outletList.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
      </select>
    </label>
  );
}
