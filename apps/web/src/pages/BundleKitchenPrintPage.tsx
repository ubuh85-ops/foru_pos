import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, dt } from '../api';
import { KitchenTicketPrint } from './Pages';
import { printWithBluetoothFallback } from '../printer';
import type { PosBundleSnapshot } from '../posBundle';

type KitchenSale = { id:string;orderNumber:string;transactionNumber?:string;createdAt:string;customerName?:string;
  outlet:{name:string};cashier?:{name:string};items:{id:string;productName:string;variantName?:string;qty:number;itemNote?:string;
    itemType?:string;bundleSelectionsJson?:PosBundleSnapshot[];addons?:{id:string;addonName:string}[]}[] };
export default function BundleKitchenPrintPage(){
  const {saleId}=useParams();const [sale,setSale]=useState<KitchenSale|null>(null);const [error,setError]=useState('');
  useEffect(()=>{let active=true;api<KitchenSale>(`/sales/${encodeURIComponent(saleId||'')}`).then(sale=>{if(active)setSale(sale);}).catch(error=>{if(active)setError((error as Error).message);});return()=>{active=false;};},[saleId]);
  if(error)return <p role="alert" className="p-4 text-red-700">{error}</p>;
  if(!sale)return <p className="p-4">Memuat kitchen ticket...</p>;
  if(!sale.items.some(item=>item.itemType==='BUNDLE'))return <KitchenTicketPrint/>;
  return <div className="mx-auto max-w-sm bg-white p-6 font-mono text-sm print:p-0"><div className="mb-4 text-center"><h1 className="text-4xl font-black">{(sale.customerName||'WALK IN').toUpperCase()}</h1><p>{sale.transactionNumber||sale.orderNumber}</p><p>{dt(sale.createdAt)}</p><p>{sale.outlet.name}</p><p>Kasir: {sale.cashier?.name}</p></div>
    <div className="border-y py-2">{sale.items.map(item=><div key={item.id} className="py-2"><b>{item.qty}x {item.productName}</b>{item.itemType==='BUNDLE'&&Array.isArray(item.bundleSelectionsJson)?item.bundleSelectionsJson.map((component,index)=><p key={index}>{component.qty*item.qty}x {component.productName} ({component.variantName||'Base'})</p>):<p>{item.variantName}</p>}{item.addons?.map(addon=><p key={addon.id}>+ {addon.addonName}</p>)}{item.itemNote&&<p className="font-black">NOTE: {item.itemNote.toUpperCase()}</p>}</div>)}</div>
    <button className="btn-primary mt-5 w-full print:hidden" onClick={()=>void printWithBluetoothFallback(sale,'kitchen-ticket',`/kitchen-ticket/${sale.id}`)}>Print</button>
  </div>;
}
