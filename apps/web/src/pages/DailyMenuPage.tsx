import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { API, api, handleUnauthorizedSession, rupiah } from '../api';
import { useOutlet } from '../OutletContext';

type Product={id:string;name:string};
type Partner={id:string;name:string;type:string;status:string};
type Schedule={id:string;scheduleDate:string;product:Product;productionPartnerId?:string|null;productionPartner?:Partner|null;priceOverride:string|null;quota:number|null;soldQty:number;isAvailable:boolean;sortOrder:number;cutoffAt:string|null};
type RecapItem={id:string;productId:string;productName:string;productionPartnerId?:string|null;productionPartnerName?:string|null;variantName:string;qty:number;serviceDate:string;itemNote:string|null;fulfillmentStatus:string;addons:{addonName:string}[];sale:{id:string;orderNumber:string;customerName:string;customerPhone:string;orderNote:string|null;status:string;paidAt:string|null}};
const fulfillmentOptions=[['PENDING','Belum diproses'],['PROCESSING','Sedang diproses'],['READY','Sudah dipacking'],['COMPLETED','Sudah diserahkan']] as const;
const fulfillmentLabel=(status:string)=>fulfillmentOptions.find(([value])=>value===status)?.[1]||status;
function packingProgress(items:RecapItem[]){
  const total=items.reduce((sum,item)=>sum+item.qty,0);
  const packed=items.filter(item=>['READY','COMPLETED'].includes(item.fulfillmentStatus)).reduce((sum,item)=>sum+item.qty,0);
  const handed=items.filter(item=>item.fulfillmentStatus==='COMPLETED').reduce((sum,item)=>sum+item.qty,0);
  return `${packed}/${total} dipacking · ${handed}/${total} diserahkan`;
}
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const label=(date:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'full',timeZone:'UTC'}).format(new Date(date));
const localTime=(value:string|null)=>{if(!value)return '';const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
function scheduleValues(form:HTMLFormElement){const data=new FormData(form);return {productionPartnerId:String(data.get('productionPartnerId')||'')||null,priceOverride:data.get('priceOverride')===''?null:Number(data.get('priceOverride')),quota:data.get('quota')===''?null:Number(data.get('quota')),isAvailable:data.get('isAvailable')==='on',sortOrder:Number(data.get('sortOrder')||0),cutoffAt:data.get('cutoffAt')?new Date(String(data.get('cutoffAt'))).toISOString():null};}
function ScheduleFields({row,partners}:{row?:Schedule;partners:Partner[]}){return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
  <label className="text-xs">Mitra Produksi<select name="productionPartnerId" className="input" defaultValue={row?.productionPartnerId||''}><option value="">Default produk / Belum Ditentukan</option>{partners.filter(p=>p.status==='ACTIVE'||p.id===row?.productionPartnerId).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <label className="text-xs">Harga khusus (kosong = harga outlet)<input aria-label="Harga khusus" name="priceOverride" className="input" type="number" min="0" step="0.01" defaultValue={row?.priceOverride??''}/></label>
  <label className="text-xs">Kuota (kosong = tanpa batas)<input name="quota" className="input" type="number" min={row?.soldQty??0} defaultValue={row?.quota??''}/></label>
  <label className="text-xs">Cutoff (zona waktu perangkat)<input name="cutoffAt" className="input" type="datetime-local" defaultValue={localTime(row?.cutoffAt??null)}/></label>
  <label className="text-xs">Urutan<input name="sortOrder" className="input" type="number" min="0" defaultValue={row?.sortOrder??0}/></label>
  <label className="flex items-center gap-2 text-sm"><input name="isAvailable" type="checkbox" defaultChecked={row?.isAvailable??true}/> Aktif</label>
</div>;}
export default function DailyMenuPage({recap=false}:{recap?:boolean}){
  const {outletList}=useOutlet();
  const [outletId,setOutletId]=useState('');
  const [date,setDate]=useState(today());
  const [to,setTo]=useState(today());
  const [rows,setRows]=useState<Schedule[]>([]);
  const [products,setProducts]=useState<Product[]>([]);
  const [partners,setPartners]=useState<Partner[]>([]);
  const [items,setItems]=useState<RecapItem[]>([]);
  const [status,setStatus]=useState('');const [payment,setPayment]=useState('');
  const [productId,setProductId]=useState('');const [customer,setCustomer]=useState('');
  const [productionPartnerId,setProductionPartnerId]=useState('');
  const [view,setView]=useState<'production'|'packing'>('production');
  const [error,setError]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{if(!recap||busy)return;const timer=window.setInterval(()=>{if(!document.hidden)setRevision(n=>n+1);},15000);return()=>window.clearInterval(timer);},[recap,busy]);
  useEffect(()=>{if(!outletId&&outletList[0])setOutletId(outletList[0].id);},[outletList,outletId]);
  const month=date.slice(0,7),lastDay=new Date(Number(date.slice(0,4)),Number(date.slice(5,7)),0).getDate();
  useEffect(()=>{
    if(!outletId)return;let active=true;setError('');
    const params=new URLSearchParams({outletId,from:recap?date:month+'-01',to:recap?to:month+'-'+lastDay});
    if(status)params.set('status',status);if(payment)params.set('paymentStatus',payment);if(productId)params.set('productId',productId);if(productionPartnerId)params.set('productionPartnerId',productionPartnerId);if(customer)params.set('customer',customer);
    const load=recap?api<RecapItem[]>(`/admin/preorder/recap?${params}`).then(data=>{if(active)setItems(data);}):api<Schedule[]>(`/admin/preorder/schedules?${params}`).then(data=>{if(active)setRows(data);});
    load.catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};
  },[outletId,date,to,month,lastDay,recap,status,payment,productId,productionPartnerId,customer,revision]);
  useEffect(()=>{if(!outletId)return;let active=true;setProducts([]);api<Product[]>(`/pos/products?outlet_id=${encodeURIComponent(outletId)}`).then(data=>{if(active)setProducts(data);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[outletId]);
  useEffect(()=>{if(!outletId)return;api<Partner[]>(`/production-partners?outletId=${encodeURIComponent(outletId)}`).then(setPartners).catch(()=>setPartners([]));},[outletId]);
  async function download(){const params=new URLSearchParams({outletId,from:date,to});if(status)params.set('status',status);if(payment)params.set('paymentStatus',payment);if(productId)params.set('productId',productId);if(productionPartnerId)params.set('productionPartnerId',productionPartnerId);if(customer)params.set('customer',customer);const token=localStorage.getItem('token');const response=await fetch(`${API}/admin/preorder/recap/export?${params}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});if(response.status===401){const body=await response.json().catch(()=>({}));handleUnauthorizedSession(body.message);throw new Error(body.message||'Sesi berakhir');}if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'Download gagal');}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`rekap-daily-preorder-${date}-${to}.xlsx`;a.click();URL.revokeObjectURL(url);}
  async function mutate(path:string,method:string,data?:unknown){setBusy(true);setError('');setMessage('');try{const result=await api<{count?:number}>(path,{method,...(data!==undefined?{body:JSON.stringify(data)}:{})});setRevision(n=>n+1);setMessage(path.endsWith('/fulfill')?'Status item tersimpan.':result.count!==undefined?`${result.count} baris diproses. Jadwal yang sudah ada tidak ditimpa.`:'Tersimpan.');}catch(e){setError((e as Error).message);if(path.endsWith('/fulfill'))setRevision(n=>n+1);}finally{setBusy(false);}}
  function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);void mutate('/admin/preorder/schedules','POST',{outletId,scheduleDate:date,productId:data.get('productId'),...scheduleValues(e.currentTarget)});}
  const groups=new Map<string,RecapItem[]>();
  for(const item of items){const key=item.serviceDate.slice(0,10)+'|'+(view==='production'?item.productId:item.sale.id);groups.set(key,[...(groups.get(key)||[]),item]);}
  return <div className="p-4 lg:p-8">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black">{recap?'Rekap Daily Pre-Order':'Daily Menu Schedule'}</h1><p className="text-sm text-slate-500">{recap?'Produksi dan packing berdasarkan tanggal layanan.':'Pilih menu individual dari Master Product untuk setiap tanggal.'}</p></div><div className="flex gap-3 text-sm font-bold text-brand-700"><Link to={recap?'/preorder/schedules':'/preorder/recap'}>{recap?'Kelola jadwal':'Lihat rekap'}</Link><Link to="/orders/preorder-recap">Rekap jadwal lama</Link></div></div>
    <div className="mb-4 flex flex-wrap gap-3"><label>Outlet<select className="input" value={outletId} onChange={e=>setOutletId(e.target.value)}>{outletList.map(outlet=><option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label><label>{recap?'Dari tanggal':'Tanggal menu'}<input className="input" type="date" value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);if(to<e.target.value)setTo(e.target.value);}}}/></label>{recap&&<label>Sampai tanggal<input className="input" type="date" min={date} value={to} onChange={e=>{if(e.target.value)setTo(e.target.value);}}/></label>}</div>
    {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}{message&&<p role="status" className="mb-4 text-green-700">{message}</p>}
    {!recap?<>
      <div className="mb-5 grid grid-cols-7 gap-1 rounded-2xl border bg-white p-3">{['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map(day=><span key={day} className="py-1 text-center text-xs font-bold text-slate-500">{day}</span>)}{Array.from({length:new Date(month+'-01T12:00:00').getDay()},(_,index)=><span key={'blank'+index}/>)}{Array.from({length:lastDay},(_,index)=>{const key=month+'-'+String(index+1).padStart(2,'0'),count=rows.filter(row=>row.scheduleDate.startsWith(key)).length;return <button key={key} onClick={()=>setDate(key)} aria-pressed={date===key} className={`rounded-lg p-2 text-sm ${date===key?'bg-brand-700 text-white':'bg-slate-50'}`}><b>{index+1}</b><span className="block text-xs">{count} menu</span></button>;})}</div>
      <h2 className="mb-3 text-lg font-bold">{label(date)}</h2>
      <div className="space-y-3">{rows.filter(row=>row.scheduleDate.startsWith(date)).map(row=><form key={row.id+revision} className="rounded-2xl border bg-white p-4" onSubmit={e=>{e.preventDefault();void mutate(`/admin/preorder/schedules/${row.id}`,'PUT',scheduleValues(e.currentTarget));}}><div className="mb-3 flex justify-between"><div><b>{row.product.name}</b><p className="text-xs text-slate-500">{row.productionPartner?.name||'Default produk / Belum Ditentukan'}</p></div><span className="text-sm">Dipesan {row.soldQty}{row.quota!==null?` / ${row.quota}`:''}</span></div><ScheduleFields row={row} partners={partners}/><div className="mt-3 flex gap-2"><button disabled={busy} className="btn-primary">Simpan</button><button disabled={busy} type="button" className="btn border text-red-700" onClick={()=>void mutate(`/admin/preorder/schedules/${row.id}`,'DELETE')}>{row.soldQty?'Nonaktifkan':'Hapus'}</button></div></form>)}</div>
      <form onSubmit={create} className="my-5 rounded-2xl border bg-white p-4"><h3 className="mb-3 font-bold">Tambah produk</h3><select name="productId" required className="input mb-3" defaultValue=""><option value="" disabled>Pilih Master Product</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select><ScheduleFields partners={partners}/><button disabled={busy||!outletId} className="btn-primary mt-3">Tambah ke {date}</button></form>
      <form className="rounded-2xl border bg-white p-4" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void mutate('/admin/preorder/schedules/copy','POST',{outletId,sourceDate:date,targetDates:String(data.get('dates')).split(',').map(value=>value.trim()).filter(Boolean)});}}><h3 className="font-bold">Salin menu {date}</h3><label className="text-sm">Tanggal tujuan, pisahkan dengan koma<input required className="input my-2" name="dates" placeholder="2026-10-07, 2026-10-09"/></label><p className="mb-3 text-xs text-slate-500">Cutoff digeser sesuai selisih hari. Jumlah dipesan dimulai dari nol. Jadwal yang sudah ada tetap dipertahankan.</p><button disabled={busy} className="btn border">Salin jadwal</button></form>
    </>:<>
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5"><select aria-label="Status order" className="input" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Pesanan aktif</option>{['OPEN_ORDER','PENDING_PAYMENT','PAID','CANCELLED','REJECTED','VOID'].map(value=><option key={value}>{value}</option>)}</select><select aria-label="Status pembayaran" className="input" value={payment} onChange={e=>setPayment(e.target.value)}><option value="">Semua pembayaran</option><option value="PAID">Lunas</option><option value="UNPAID">Belum lunas</option></select><select aria-label="Produk" className="input" value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Semua produk</option>{products.map(product=><option key={product.id} value={product.id}>{product.name}</option>)}</select><select aria-label="Mitra Produksi" className="input" value={productionPartnerId} onChange={e=>setProductionPartnerId(e.target.value)}><option value="">Semua Mitra</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input className="input" placeholder="Cari nama / WhatsApp customer" value={customer} onChange={e=>setCustomer(e.target.value)}/></div>
      <div className="mb-4 flex flex-wrap gap-2"><button className={view==='production'?'btn-primary':'btn border'} onClick={()=>setView('production')}>Produksi per produk</button><button className={view==='packing'?'btn-primary':'btn border'} onClick={()=>setView('packing')}>Packing per customer</button><button className="btn border" onClick={()=>void download().catch(e=>setError(e.message))}>Download Excel per Mitra</button></div>
      <p className="mb-3 text-sm font-semibold">{items.reduce((sum,item)=>sum+item.qty,0)} item · {new Set(items.map(item=>item.sale.id)).size} pesanan</p>
      {!items.length&&<p className="rounded-xl bg-white p-5">Tidak ada pesanan pada filter ini.</p>}
      <div className="space-y-3">{[...groups].map(([key,group])=>{
        const first=group[0];
        return <details key={key} open={view==='packing'} className="rounded-2xl border bg-white p-4">
          <summary className="cursor-pointer">
            <span className="block text-sm font-bold text-violet-700">{label(first.serviceDate)}</span>
            <b>{view==='production'?first.productName:first.sale.customerName}</b>
            <span className="ml-3">{group.reduce((sum,item)=>sum+item.qty,0)} item</span>
            <span className="mt-1 block text-xs font-semibold text-slate-500">{packingProgress(group)}</span>
          </summary>
          <div className="mt-3 space-y-2">{group.map(item=>{
            const editable=['PENDING_PAYMENT','PAID'].includes(item.sale.status);
            return <div key={item.id} className="flex flex-col gap-3 border-t py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><b>{view==='production'?item.sale.customerName:item.productName}</b>
                <p className="text-xs text-slate-500">{item.variantName} {item.addons.map(addon=>addon.addonName).join(', ')} {item.itemNote&&`· ${item.itemNote}`}</p>
                <p className="text-xs">{item.sale.customerPhone} · <Link className="text-brand-700" to={`/orders/${item.sale.id}`}>{item.sale.orderNumber}</Link> · {item.sale.paidAt?'Lunas':'Belum lunas'}</p>
                {item.sale.orderNote&&<p className="text-xs">{item.sale.orderNote}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3"><b>×{item.qty}</b>
                <label className="min-w-44 text-xs font-semibold">Status item
                  <select aria-label={`Status ${item.productName} untuk ${item.sale.customerName}`} disabled={busy||!editable} className="input mt-1 text-sm disabled:opacity-60" value={item.fulfillmentStatus} onChange={e=>void mutate(`/admin/preorder/orders/${item.sale.id}/fulfill`,'POST',{itemId:item.id,serviceDate:item.serviceDate.slice(0,10),status:e.target.value,expectedStatus:item.fulfillmentStatus})}>
                    {fulfillmentOptions.map(([value,text])=><option key={value} value={value}>{text}</option>)}
                  </select>
                  {!editable&&<span className="mt-1 block font-normal text-slate-500">{item.sale.status==='OPEN_ORDER'?'Terima pesanan dahulu untuk mengubah status.':fulfillmentLabel(item.fulfillmentStatus)}</span>}
                </label>
              </div>
            </div>;
          })}</div>
        </details>;
      })}</div>
    </>}
  </div>;
}
