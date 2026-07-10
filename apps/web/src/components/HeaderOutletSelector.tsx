import { ChevronDown } from 'lucide-react';
import { useOutlet } from '../OutletContext';

export default function HeaderOutletSelector() {
  const { outletList, selectedOutlet, selectedOutletId, setSelectedOutletId } = useOutlet();

  return (
    <label className="relative flex h-12 min-w-0 max-w-[13rem] shrink items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 font-semibold text-slate-700 shadow-sm sm:max-w-[16rem] md:min-w-[13rem]">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${selectedOutlet ? 'bg-green-600' : 'bg-red-500'}`} />
      <span className="min-w-0 flex-1 truncate">{selectedOutlet?.name || 'Pilih outlet'}</span>
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
