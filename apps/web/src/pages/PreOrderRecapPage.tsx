import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Clock3, Package, ShoppingBag, Store, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, rupiah } from '../api';
import { useOutlet } from '../OutletContext';

type GroupBy='customer'|'category'|'product';
type Preset='today'|'tomorrow'|'7days'|'custom';
type RecapItem={id:string;productId:string;productName:string;variantName:string;selectedVariantsJson:any;itemNote?:string|null;qty:number;addons:{id:string;addonName:string}[];category:{id:string|null;name:string;sortOrder:number}};
type RecapOrder={id:string;orderNumber?:string|null;customerName:string;customerPhone?:string|null;orderType:string;status:string;scheduledAt:string;grandTotal:number;outlet:{id:string;name:string;code:string;timezone:string};items:RecapItem[]};
type ProductGroup={id:string;name:string;qty:number;lines:{order:RecapOrder;item:RecapItem}[];variants:Map<string,number>};

const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const addDays=(date:Date,days:number)=>{const next=new Date(date);next.setDate(next.getDate()+days);return next;};
const startOfDay=(value:string)=>new Date(`${value}T00:00:00`).toISOString();
const endExclusive=(value:string)=>new Date(`${value}T24:00:00`).toISOString();
const time=(value:string)=>new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const dateLabel=(value:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'long'}).format(new Date(`${value}T12:00:00`));
const statusLabel=(value:string)=>({OPEN_ORDER:'Menunggu Konfirmasi',ACCEPTED:'Dikonfirmasi',PENDING_PAYMENT:'Menunggu Pembayaran',PAID:'Dibayar',COMPLETED:'Selesai',REJECTED:'Ditolak',CANCELLED:'Dibatalkan',VOID:'Void'}[value]||value.replaceAll('_',' '));
const optionText=(item:RecapItem)=>{
  const selected=Array.isArray(item.selectedVariantsJson)?item.selectedVariantsJson.map((row:any)=>row?.name||row?.optionName).filter(Boolean):[];
  return [item.variantName&&item.variantName!=='Base'?item.variantName:null,...selected,...item.addons.map(addon=>addon.addonName),item.itemNote].filter(Boolean).join(' · ');
};

export default function PreOrderRecapPage(){
  const {outletList}=useOutlet();
  const today=dateKey(new Date());
  const [preset,setPreset]=useState<Preset>('today');
  const [from,setFrom]=useState(today);
  const [to,setTo]=useState(today);
  const [outletId,setOutletId]=useState('');
  const [status,setStatus]=useState('');
  const [groupBy,setGroupBy]=useState<GroupBy>('customer');
  const [orders,setOrders]=useState<RecapOrder[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  function applyPreset(next:Preset){
    setPreset(next);
    if(next==='today'){setFrom(today);setTo(today);}
    if(next==='tomorrow'){const value=dateKey(addDays(new Date(),1));setFrom(value);setTo(value);}
    if(next==='7days'){setFrom(today);setTo(dateKey(addDays(new Date(),6)));}
  }
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    const params=new URLSearchParams({from:startOfDay(from),to:endExclusive(to)});
    if(outletId)params.set('outletId',outletId);if(status)params.set('status',status);
    api<RecapOrder[]>(`/orders/preorder-recap?${params}`).then(rows=>active&&setOrders(rows)).catch(e=>active&&setError((e as Error).message)).finally(()=>active&&setLoading(false));
    return()=>{active=false};
  },[from,to,outletId,status]);

  const summary=useMemo(()=>({orders:orders.length,customers:new Set(orders.map(order=>order.customerPhone||order.customerName.trim().toLowerCase())).size,items:orders.reduce((sum,order)=>sum+order.items.reduce((n,item)=>n+item.qty,0),0),sales:orders.reduce((sum,order)=>sum+Number(order.grandTotal),0)}),[orders]);
  const peaks=useMemo(()=>{
    const rows=new Map<string,number>();for(const order of orders){const hour=new Date(order.scheduledAt).getHours();const label=`${String(hour).padStart(2,'0')}:00–${String((hour+1)%24).padStart(2,'0')}:00`;rows.set(label,(rows.get(label)||0)+order.items.reduce((n,item)=>n+item.qty,0));}return [...rows].map(([label,qty])=>({label,qty})).sort((a,b)=>a.label.localeCompare(b.label));
  },[orders]);
  const categories=useMemo(()=>{
    const map=new Map<string,{id:string;name:string;sortOrder:number;products:Map<string,{name:string;qty:number}>}>();
    for(const order of orders)for(const item of order.items){const key=item.category.id||item.category.name,row=map.get(key)||{id:key,name:item.category.name,sortOrder:item.category.sortOrder,products:new Map()};const product=row.products.get(item.productId)||{name:item.productName,qty:0};product.qty+=item.qty;row.products.set(item.productId,product);map.set(key,row);}return [...map.values()].sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name));
  },[orders]);
  const products=useMemo(()=>{
    const map=new Map<string,ProductGroup>();
    for(const order of orders)for(const item of order.items){const row:ProductGroup=map.get(item.productId)||{id:item.productId,name:item.productName,qty:0,lines:[],variants:new Map<string,number>()};row.qty+=item.qty;row.lines.push({order,item});const variant=optionText(item)||'Regular';row.variants.set(variant,(row.variants.get(variant)||0)+item.qty);map.set(item.productId,row);}return [...map.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name));
  },[orders]);

  return <div className="min-h-screen bg-soft/40 p-4 pb-24 lg:p-7">
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-black text-brand-700">OPERASIONAL</p><h1 className="text-3xl font-black">Rekap Pre-Order</h1><p className="text-slate-500">Produksi berdasarkan jadwal pesanan, bukan tanggal dibuat.</p></div><Link to="/orders" className="btn-soft">Semua Order</Link></div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">{(['today','tomorrow','7days','custom'] as Preset[]).map(value=><button key={value} onClick={()=>applyPreset(value)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${preset===value?'bg-ink text-white':'bg-white text-slate-500 shadow-sm'}`}>{value==='today'?'Hari Ini':value==='tomorrow'?'Besok':value==='7days'?'7 Hari':'Custom'}</button>)}</div>
      <div className="mb-5 grid gap-3 rounded-3xl bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Dari"><input type="date" className="input" value={from} onChange={e=>{setPreset('custom');setFrom(e.target.value)}}/></Field><Field label="Sampai"><input type="date" className="input" min={from} value={to} onChange={e=>{setPreset('custom');setTo(e.target.value)}}/></Field>
        <Field label="Outlet"><Select value={outletId} onChange={setOutletId}><option value="">Semua Outlet</option>{outletList.map(outlet=><option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</Select></Field>
        <Field label="Status"><Select value={status} onChange={setStatus}><option value="">Aktif (tanpa batal)</option>{['OPEN_ORDER','ACCEPTED','PENDING_PAYMENT','PAID','COMPLETED','REJECTED','CANCELLED','VOID'].map(value=><option key={value} value={value}>{statusLabel(value)}</option>)}</Select></Field>
        <Field label="Group By"><Select value={groupBy} onChange={value=>setGroupBy(value as GroupBy)}><option value="customer">Nama Pemesan</option><option value="category">Kategori</option><option value="product">Produk</option></Select></Field>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat icon={ShoppingBag} label="Total Order" value={String(summary.orders)}/><Stat icon={Users} label="Total Customer" value={String(summary.customers)}/><Stat icon={Package} label="Total Item" value={String(summary.items)}/><Stat icon={Store} label="Total Sales" value={rupiah(summary.sales)}/></div>
      {!!peaks.length&&<div className="mb-5 flex gap-2 overflow-x-auto">{peaks.map(row=><div key={row.label} className="shrink-0 rounded-2xl bg-white px-4 py-3 text-sm shadow-sm"><b>{row.label}</b><span className="ml-3 text-brand-700">{row.qty} item</span></div>)}</div>}
      {error&&<div className="mb-4 rounded-2xl bg-red-50 p-4 font-bold text-red-700">{error}</div>}{loading&&<div className="rounded-3xl bg-white p-8 text-center font-bold text-slate-400">Memuat rekap...</div>}
      {!loading&&!orders.length&&<div className="rounded-3xl bg-white p-8 text-center text-slate-400"><CalendarDays className="mx-auto mb-2"/><b>Belum ada Pre-Order pada periode ini.</b></div>}
      {!loading&&groupBy==='customer'&&<div className="space-y-3">{orders.map(order=><OrderCard key={order.id} order={order}/>)}</div>}
      {!loading&&groupBy==='category'&&<div className="space-y-3">{categories.map(category=>{const total=[...category.products.values()].reduce((n,p)=>n+p.qty,0);return <details open key={category.id} className="rounded-3xl bg-white p-5 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between text-lg font-black"><span>{category.name.toUpperCase()}</span><span className="flex items-center gap-2 text-brand-700">{total} item <ChevronDown size={18}/></span></summary><div className="mt-4 divide-y">{[...category.products.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name)).map(product=><div key={product.name} className="flex justify-between py-3"><span>{product.name}</span><b>{product.qty}</b></div>)}</div></details>})}</div>}
      {!loading&&groupBy==='product'&&<div className="space-y-3">{products.map(product=><details open key={product.id} className="rounded-3xl bg-white p-5 shadow-sm"><summary className="flex cursor-pointer list-none justify-between gap-3"><span className="text-lg font-black">{product.name}</span><span className="shrink-0 font-black text-brand-700">{product.qty} item</span></summary>{product.variants.size>1&&<div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">{[...product.variants].map(([name,qty])=><div key={name} className="flex justify-between py-1"><span>{name}</span><b>{qty}</b></div>)}</div>}<div className="mt-3 divide-y">{product.lines.map(({order,item})=><Link key={item.id} to={`/orders/${order.id}`} className="grid grid-cols-[60px_1fr_auto] gap-3 py-3 text-sm hover:text-brand-700"><b>{time(order.scheduledAt)}</b><span>{order.customerName}<small className="block text-slate-400">{optionText(item)}</small></span><b>{item.qty}</b></Link>)}</div></details>)}</div>}
    </div>
  </div>;
}

function Field({label,children}:{label:string;children:any}){return <label><span className="label">{label}</span>{children}</label>}
function Select({value,onChange,children}:{value:string;onChange:(value:string)=>void;children:any}){return <select className="input" value={value} onChange={e=>onChange(e.target.value)}>{children}</select>}
function Stat({icon:Icon,label,value}:{icon:any;label:string;value:string}){return <div className="rounded-3xl bg-white p-4 shadow-sm"><Icon size={19} className="mb-3 text-brand-600"/><p className="text-xs font-black text-slate-400">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>}
function OrderCard({order}:{order:RecapOrder}){const total=order.items.reduce((n,item)=>n+item.qty,0);return <article className="rounded-3xl bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-2 sm:flex-row"><div><Link to={`/orders/${order.id}`} className="text-xl font-black hover:text-brand-700">{order.customerName}</Link><p className="mt-1 flex items-center gap-2 text-sm text-slate-500"><Clock3 size={15}/>{time(order.scheduledAt)} · {order.orderType.replaceAll('_',' ')} · {order.outlet.name}</p><Link to={`/orders/${order.id}`} className="text-sm font-bold text-brand-700">{order.orderNumber}</Link></div><div className="sm:text-right"><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700">{statusLabel(order.status)}</span><p className="mt-2 text-xs text-slate-400">{dateLabel(dateKey(new Date(order.scheduledAt)))}</p></div></div><div className="my-4 divide-y rounded-2xl bg-slate-50 px-4">{order.items.map(item=><div key={item.id} className="py-3 text-sm"><b>{item.qty}x {item.productName}</b>{optionText(item)&&<p className="text-xs text-slate-500">{optionText(item)}</p>}</div>)}</div><div className="flex justify-between font-black"><span>Total: {total} item</span><span className="text-brand-700">{rupiah(order.grandTotal)}</span></div></article>}
