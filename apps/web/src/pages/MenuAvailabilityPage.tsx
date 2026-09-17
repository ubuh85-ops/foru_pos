import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api, type User } from '../api';
import { useOutlet } from '../OutletContext';
import { toast } from '../toast';

type StockMode='UNLIMITED'|'MANUAL'|'RECIPE';
type MenuRow={productId:string;name:string;sku?:string|null;category:string;imageUrl?:string|null;enabled:boolean;isAvailable:boolean;stockMode:StockMode;stockQty:number|null;lowStockThreshold:number;stockStatus:string};

const statusText=(row:MenuRow)=>{
  if(!row.enabled)return 'Dinonaktifkan';
  if(row.stockStatus==='LOW_STOCK')return `Mau habis${row.stockQty===null?'':` · sisa ${row.stockQty}`}`;
  if(row.stockStatus==='OUT_OF_STOCK'||row.stockStatus==='SOLD_OUT')return 'Habis';
  if(['RECIPE_MISSING','WAREHOUSE_NOT_CONFIGURED','UNIT_CONVERSION_MISSING'].includes(row.stockStatus))return 'Perlu setup resep';
  if(row.stockMode==='MANUAL')return `Tersedia · stok ${row.stockQty??0}`;
  if(row.stockMode==='RECIPE'&&row.stockQty!==null)return `Tersedia · estimasi ${row.stockQty}`;
  return 'Tersedia';
};
const statusClass=(row:MenuRow)=>row.stockStatus==='LOW_STOCK'?'bg-amber-50 text-amber-700':row.isAvailable?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700';

export default function MenuAvailabilityPage(){
  const {selectedOutletId}=useOutlet();
  const user=JSON.parse(localStorage.getItem('user')||'null') as User|null;
  const canConfigure=user?.role==='OWNER'||user?.role==='SUPERVISOR';
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
    const next=!row.enabled;setSaving(row.productId);
    try{await api('/menu-availability',{method:'PATCH',body:JSON.stringify({outletId:selectedOutletId,productId:row.productId,isAvailable:next})});toast.success(`${row.name} ${next?'diaktifkan':'ditandai habis'}.`);await load();}
    catch(e){toast.error((e as Error).message);}
    finally{setSaving(null);}
  }
  return <div className="p-4 lg:p-8"><div className="mb-6"><h2 className="text-3xl font-black">Ketersediaan Menu</h2><p className="text-slate-500">Atur ketersediaan dan stok produk untuk outlet aktif.</p></div>
    <div className="mb-5 rounded-3xl bg-white p-4 shadow-sm"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19}/><input className="input pl-11" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari menu, SKU, atau kategori..."/></div></div>
    {loading?<div className="p-10 text-center text-slate-400">Memuat ketersediaan menu...</div>:<div className="space-y-5">{groups.map(([category,items])=><section key={category} className="overflow-hidden rounded-3xl bg-white shadow-sm"><div className="border-b bg-slate-50 px-5 py-3 text-sm font-black uppercase tracking-wide text-slate-600">{category}</div><div className="divide-y">{items.map(row=><div key={row.productId} className="p-4 sm:px-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0 lg:w-64"><h3 className="truncate font-black">{row.name}</h3><p className="text-xs text-slate-400">{row.sku||'Tanpa SKU'}</p><span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black ${statusClass(row)}`}>{statusText(row)}</span></div><StockControls row={row} outletId={selectedOutletId!} canConfigure={!!canConfigure} busy={saving===row.productId} toggle={()=>toggle(row)} reload={load}/></div></div>)}</div></section>)}{!groups.length&&<div className="rounded-3xl bg-white p-10 text-center text-slate-400">Menu tidak ditemukan.</div>}</div>}
  </div>;
}

function StockControls({row,outletId,canConfigure,busy,toggle,reload}:{row:MenuRow;outletId:string;canConfigure:boolean;busy:boolean;toggle:()=>void;reload:()=>Promise<void>}){
  const [mode,setMode]=useState<StockMode>(row.stockMode),[threshold,setThreshold]=useState(row.lowStockThreshold),[qty,setQty]=useState(row.stockQty??0),[reason,setReason]=useState('Update stok outlet'),[saving,setSaving]=useState(false);
  useEffect(()=>{setMode(row.stockMode);setThreshold(row.lowStockThreshold);setQty(row.stockQty??0);},[row.stockMode,row.lowStockThreshold,row.stockQty]);
  async function saveSettings(){
    setSaving(true);try{await api('/menu-availability/stock-settings',{method:'PATCH',body:JSON.stringify({outletId,productId:row.productId,stockMode:mode,lowStockThreshold:threshold})});toast.success('Pengaturan stok disimpan.');await reload();}catch(e){toast.error((e as Error).message);}finally{setSaving(false);}
  }
  async function saveQty(){
    setSaving(true);try{await api('/menu-availability/stock',{method:'PATCH',body:JSON.stringify({outletId,productId:row.productId,stockQty:qty,reason})});toast.success('Jumlah stok diperbarui.');await reload();}catch(e){toast.error((e as Error).message);}finally{setSaving(false);}
  }
  return <div className="flex min-w-0 flex-1 flex-col gap-3 xl:flex-row xl:items-end xl:justify-end">
    {canConfigure&&<><label className="min-w-44"><span className="mb-1 block text-xs font-bold text-slate-500">Mode stok</span><select className="input h-10 py-1" value={mode} onChange={e=>setMode(e.target.value as StockMode)}><option value="UNLIMITED">Tanpa batas</option><option value="MANUAL">Stok manual</option><option value="RECIPE">Berdasarkan resep</option></select></label><label className="w-32"><span className="mb-1 block text-xs font-bold text-slate-500">Batas menipis</span><input className="input h-10 py-1" type="number" min="0" step="1" value={threshold} onChange={e=>setThreshold(Number(e.target.value||0))}/></label><button disabled={saving} onClick={saveSettings} className="btn-soft h-10 whitespace-nowrap">Simpan Mode</button></>}
    {row.stockMode==='MANUAL'&&<><label className="w-28"><span className="mb-1 block text-xs font-bold text-slate-500">Stok aktual</span><input className="input h-10 py-1" type="number" min="0" step="1" value={qty} onChange={e=>setQty(Number(e.target.value||0))}/></label><label className="min-w-44 flex-1 xl:max-w-60"><span className="mb-1 block text-xs font-bold text-slate-500">Alasan</span><input className="input h-10 py-1" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Contoh: stok opname"/></label><button disabled={saving} onClick={saveQty} className="btn-primary h-10 whitespace-nowrap px-4">Update Stok</button></>}
    <button disabled={busy||saving} onClick={toggle} className={`h-10 whitespace-nowrap rounded-xl px-4 text-xs font-black ${row.enabled?'bg-slate-100 text-slate-700':'bg-emerald-100 text-emerald-800'} disabled:opacity-50`}>{row.enabled?'Tandai Habis':'Aktifkan Menu'}</button>
  </div>;
}
