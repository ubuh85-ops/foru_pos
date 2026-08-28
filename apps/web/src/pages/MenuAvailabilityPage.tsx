import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api';
import { useOutlet } from '../OutletContext';
import { toast } from '../toast';

type MenuRow={productId:string;name:string;sku?:string|null;category:string;imageUrl?:string|null;isAvailable:boolean};

export default function MenuAvailabilityPage(){
  const {selectedOutletId}=useOutlet();
  const [rows,setRows]=useState<MenuRow[]>([]),[query,setQuery]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState<string|null>(null);
  async function load(){
    if(!selectedOutletId){setRows([]);return;}
    setLoading(true);
    try{setRows(await api<MenuRow[]>(`/menu-availability?outletId=${selectedOutletId}&_=${Date.now()}`));}
    catch(e){toast.error((e as Error).message);}
    finally{setLoading(false);}
  }
  useEffect(()=>{load();},[selectedOutletId]);
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return rows.filter(row=>!q||[row.name,row.sku,row.category].some(value=>String(value||'').toLowerCase().includes(q)));},[rows,query]);
  const groups=useMemo(()=>{const map=new Map<string,MenuRow[]>();for(const row of filtered)map.set(row.category,[...(map.get(row.category)||[]),row]);return [...map];},[filtered]);
  async function toggle(row:MenuRow){
    const next=!row.isAvailable;setSaving(row.productId);setRows(current=>current.map(item=>item.productId===row.productId?{...item,isAvailable:next}:item));
    try{await api('/menu-availability',{method:'PATCH',body:JSON.stringify({outletId:selectedOutletId,productId:row.productId,isAvailable:next})});toast.success(`${row.name} ${next?'tersedia':'ditandai habis'}.`);}
    catch(e){setRows(current=>current.map(item=>item.productId===row.productId?{...item,isAvailable:row.isAvailable}:item));toast.error((e as Error).message);}
    finally{setSaving(null);}
  }
  return <div className="p-4 lg:p-8"><div className="mb-6"><h2 className="text-3xl font-black">Ketersediaan Menu</h2><p className="text-slate-500">Atur menu tersedia atau habis untuk outlet aktif.</p></div>
    <div className="mb-5 rounded-3xl bg-white p-4 shadow-sm"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19}/><input className="input pl-11" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari menu, SKU, atau kategori..."/></div></div>
    {loading?<div className="p-10 text-center text-slate-400">Memuat ketersediaan menu...</div>:<div className="space-y-5">{groups.map(([category,items])=><section key={category} className="overflow-hidden rounded-3xl bg-white shadow-sm"><div className="border-b bg-slate-50 px-5 py-3 text-sm font-black uppercase tracking-wide text-slate-600">{category}</div><div className="divide-y">{items.map(row=><div key={row.productId} className="flex items-center justify-between gap-4 p-4 sm:px-5"><div className="min-w-0"><h3 className="truncate font-black">{row.name}</h3><p className="text-xs text-slate-400">{row.sku||'Tanpa SKU'}</p></div><button disabled={saving===row.productId} onClick={()=>toggle(row)} className={`relative flex h-10 w-32 shrink-0 items-center rounded-full px-2 text-xs font-black transition ${row.isAvailable?'justify-end bg-emerald-100 text-emerald-800':'justify-start bg-slate-200 text-slate-600'} disabled:opacity-50`}><span className="absolute h-7 w-7 rounded-full bg-white shadow" style={{left:row.isAvailable?'calc(100% - 2.25rem)':'0.5rem'}}/><span className={row.isAvailable?'mr-8':'ml-8'}>{row.isAvailable?'Tersedia':'Habis'}</span></button></div>)}</div></section>)}{!groups.length&&<div className="rounded-3xl bg-white p-10 text-center text-slate-400">Menu tidak ditemukan.</div>}</div>}
  </div>;
}
