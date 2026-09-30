import { useState } from 'react';
import { api, rupiah } from '../api';

export default function DailyOrderActions({order,onChange}:{order:{id:string;status:string;grandTotal:number|string};onChange:()=>void}){
  const [method,setMethod]=useState('CASH'),[cash,setCash]=useState(String(order.grandTotal));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function action(path:string,body:unknown){setBusy(true);setError('');try{await api(`/orders/${order.id}/${path}`,{method:'POST',body:JSON.stringify(body)});onChange();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="mb-3 space-y-3 rounded-xl bg-violet-50 p-3">
    <b>Daily Pre-Order · {rupiah(order.grandTotal)}</b><p className="text-xs">Harga dan tanggal mengikuti pesanan customer. Penyerahan dicatat per tanggal melalui rekap packing.</p>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {order.status==='OPEN_ORDER'&&<button disabled={busy} className="btn-primary w-full" onClick={()=>void action('accept',{})}>Terima pesanan</button>}
    <form className="space-y-2" onSubmit={e=>{e.preventDefault();void action('pay',{paymentMethod:method,...(method==='CASH'?{cashReceived:Number(cash)}:{})});}}><label className="text-sm">Metode pembayaran<select className="input" value={method} onChange={e=>setMethod(e.target.value)}>{['CASH','QRIS','TRANSFER','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER'].map(value=><option key={value}>{value}</option>)}</select></label>{method==='CASH'&&<label className="block text-sm">Uang diterima<input required className="input" type="number" min={Number(order.grandTotal)} value={cash} onChange={e=>setCash(e.target.value)}/></label>}<button disabled={busy} className="btn-primary w-full">{busy?'Memproses…':'Catat pembayaran'}</button></form>
  </div>;
}
