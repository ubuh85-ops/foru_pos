import { getCachedJson, setLocalJson } from './localDb';

const apiUrl = import.meta.env.VITE_API_URL;

if (!apiUrl) {
  throw new Error('VITE_API_URL is missing');
}

console.log('API URL =', apiUrl);

export const API = apiUrl;
export type User={id:string;name:string;role:'OWNER'|'SUPERVISOR'|'CASHIER';outletIds:string[]};
export async function api<T=any>(path:string,options:RequestInit={}){const local=await localFirst(path,options);if(local!==undefined)return local as T;const token=localStorage.getItem('token');try{const res=await fetch(API+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...options.headers}});const data=await res.json().catch(()=>({}));if(!res.ok){if(res.status===401){localStorage.removeItem('token');localStorage.removeItem('user');}throw new Error(data.message||'Permintaan gagal');}return data as T;}catch(error){const readFallback=offlineFallback(path,options);if(readFallback!==undefined)return readFallback as T;const writeFallback=await offlineWriteFallback(path,options);if(writeFallback!==undefined)return writeFallback as T;throw error;}}
export const rupiah=(n:number|string=0)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n));
export const dt=(s:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(s));

function master(){return getCachedJson<any>('foru:master_data',null)}
async function localFirst(path:string,options:RequestInit={}){if(path==='/auth/login'||path.startsWith('/sync/'))return undefined;const method=(options.method||'GET').toUpperCase();if(method==='GET'){const local=offlineFallback(path,options);if(local!==undefined)return local}if(['POST','PUT','DELETE'].includes(method)&&isOperationalWrite(path))return offlineWriteFallback(path,options);return undefined}
function isOperationalWrite(path:string){return path==='/orders'||path==='/sales'||path==='/expenses'||path==='/cash-sessions/open'||path.startsWith('/cash-sessions/')||path.startsWith('/orders/')||path.startsWith('/print/')}
function offlineFallback(path:string,options:RequestInit={}){if((options.method||'GET').toUpperCase()!=='GET')return undefined;const m=master();if(!m)return undefined;const [route,qs='']=path.split('?');const query=new URLSearchParams(qs);const user=JSON.parse(localStorage.getItem('user')||'null');if(route==='/outlets')return m.outlets||[];if(route==='/categories')return m.categories||[];if(route==='/variant-groups')return m.variantGroups||[];if(route==='/coupons')return m.coupons||[];if(route==='/printers'){const outletId=query.get('outlet_id');return (m.printers||[]).filter((p:any)=>!outletId||p.outletId===outletId)}if(route==='/auth/me')return user?{...user,outlets:(m.outlets||[]).map((outlet:any)=>({outlet}))}:undefined;if(['/sync/master-data','/sync/bootstrap','/sync/pull'].includes(route))return m;if(route==='/cash-sessions/active')return getCachedJson('foru:active_cash_session',null);if(route==='/pos/products'){const outletId=query.get('outlet_id')||localStorage.getItem('outletId');return cachedPosProducts(m,outletId)}if(route==='/orders')return localOrders().filter((o:any)=>!query.get('status')||o.status===query.get('status')).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt)));if(route.startsWith('/orders/'))return localOrders().find((o:any)=>o.id===route.split('/')[2]);if(route==='/sales')return localOrders().filter((o:any)=>['PAID','VOID'].includes(o.status));if(route.startsWith('/sales/'))return localOrders().find((o:any)=>o.id===route.split('/')[2]);if(route==='/expenses')return localExpenses();if(route==='/reports/daily'||route==='/reports/dashboard')return localReport();return undefined}
function cachedPosProducts(m:any,outletId:string|null){if(!outletId)return[];return(m.products||[]).filter((p:any)=>p.status==='ACTIVE'&&(p.outlets||[]).some((o:any)=>o.outletId===outletId&&o.isAvailable!==false&&o.status==='ACTIVE')).map((p:any)=>{const po=(p.outlets||[]).find((o:any)=>o.outletId===outletId);return{...p,basePrice:po?.outletPrice??p.basePrice,baseHpp:po?.outletHpp??p.baseHpp,masterBasePrice:p.basePrice,masterBaseHpp:p.baseHpp,variantGroups:(p.variantGroups||[]).map((vg:any)=>({...vg,group:{...vg.group,options:(vg.group?.options||[]).filter((o:any)=>{if(o.status&&o.status!=='ACTIVE')return false;const oo=(o.outlets||[]).find((x:any)=>x.outletId===outletId);return!oo||oo.status==='ACTIVE'}).map((o:any)=>{const oo=(o.outlets||[]).find((x:any)=>x.outletId===outletId);return{...o,additionalPrice:oo?.additionalPrice??o.additionalPrice,hpp:oo?.hpp??o.hpp,masterAdditionalPrice:o.additionalPrice,masterHpp:o.hpp}})}}))}})}
const shiftRequiredMessage='Shift belum dibuka. Silakan buka kasir terlebih dahulu.';
function requireLocalActiveShift(outletId?:string){const active=getCachedJson<any>('foru:active_cash_session',null);if(!active||active.status!=='OPEN'||(outletId&&active.outletId!==outletId))throw new Error(shiftRequiredMessage);return active}
async function offlineWriteFallback(path:string,options:RequestInit={}){
  const method=(options.method||'GET').toUpperCase();
  if(!['POST','PUT','DELETE'].includes(method))return undefined;
  if(path.startsWith('/sync/'))return undefined;
  const body=typeof options.body==='string'?JSON.parse(options.body||'{}'):{};
  const user=JSON.parse(localStorage.getItem('user')||'null');
  const now=new Date().toISOString();
  const localId=`local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const {enqueueSync,recordLocalAudit}=await import('./sync');
  const audit=(action:string,entityType:string,entityId:string,newValue:any)=>recordLocalAudit(action,entityType,entityId,newValue);
  if(path==='/cash-sessions/open'&&method==='POST'){
    const outlet=(master()?.outlets||[]).find((o:any)=>o.id===body.outletId);
    const session={id:localId,outletId:body.outletId,cashierId:user?.id,openingCash:body.openingCash,openedAt:now,status:'OPEN',outlet,expenses:[],createdOffline:true,syncStatus:'PENDING'};
    await setLocalJson('foru:active_cash_session',session);
    enqueueSync({id:localId,entityType:'CASH_SESSION',entityLocalId:localId,action:'CREATE',payload:withDevice(body)});
    audit('OPEN_SHIFT','CASH_SESSION',localId,session);
    return session;
  }
  if(path.startsWith('/cash-sessions/')&&path.endsWith('/close')&&method==='POST'){
    const active=getCachedJson<any>('foru:active_cash_session',null);
    if(!active)return undefined;
    const report=localReport();
    const expected=Number(active.openingCash||0)+Number(report.payments?.CASH||0)-Number(report.cashDrawerExpense||0);
    const closed={...active,closingCashActual:body.closingCashActual,expectedCash:expected,variance:Number(body.closingCashActual||0)-expected,status:'CLOSED',closedAt:now};
    await setLocalJson('foru:active_cash_session',null);
    enqueueSync({id:active.id,entityType:'CASH_SESSION',entityLocalId:active.id,action:'CLOSE_SHIFT',payload:withDevice({...closed,status:'CLOSED'})});
    await import('./localDb').then(x=>x.backupLocalDatabase().catch(()=>{}));
    audit('CLOSE_SHIFT','CASH_SESSION',active.id,closed);
    return closed;
  }
  if((path==='/orders'||path==='/sales')&&method==='POST'){
    const active=requireLocalActiveShift(body.outletId);
    body.cashSessionId=active.id;
    const paid=path==='/sales';
    const sale=buildLocalSale(localId,body,paid);
    await upsertLocalOrder(sale);
    enqueueSync({id:localId,entityType:paid?'SALE':'ORDER',entityLocalId:localId,action:'CREATE',payload:withDevice(body)});
    audit(paid?'PAYMENT':'SAVE_ORDER',paid?'SALE':'ORDER',localId,sale);
    return sale;
  }
  if(path.startsWith('/orders/')&&method==='PUT'){
    const active=requireLocalActiveShift(body.outletId);
    body.cashSessionId=active.id;
    const id=path.split('/')[2];
    const sale=buildLocalSale(id,body,false);
    const existing=localOrders().find((o:any)=>o.id===id);
    const updated={...sale,id,orderNumber:existing?.orderNumber||sale.orderNumber,createdAt:existing?.createdAt||sale.createdAt,status:'PENDING_PAYMENT'};
    await upsertLocalOrder(updated);
    enqueueSync({id:`${id}_upd_${Date.now()}`,entityType:'ORDER',entityLocalId:id,action:'UPDATE',payload:withDevice(body)});
    audit('EDIT_ORDER','ORDER',id,updated);
    return updated;
  }
  if(path.startsWith('/orders/')&&path.endsWith('/pay')&&method==='POST'){
    const id=path.split('/')[2];
    const existing=localOrders().find((o:any)=>o.id===id);
    if(!existing)return undefined;
    const active=requireLocalActiveShift(existing.outletId);
    body.cashSessionId=active.id;
    if(body.order)body.order.cashSessionId=active.id;
    const updated={...existing,...(body.order?buildLocalSale(id,body.order,true):{}),status:'PAID',paymentMethod:body.paymentMethod,cashReceived:body.cashReceived,paidAt:now,transactionNumber:existing.transactionNumber||`LOCAL-TXN-${existing.outlet?.code||'OUT'}-${now.slice(0,10).replaceAll('-','')}-${String(Date.now()).slice(-4)}`,changeAmount:body.paymentMethod==='CASH'?Math.max(0,Number(body.cashReceived||0)-Number(existing.grandTotal||0)):0};
    await upsertLocalOrder(updated);
    enqueueSync({id:`${id}_pay_${Date.now()}`,entityType:'ORDER',entityLocalId:id,action:'PAY',payload:withDevice({...body,orderId:id})});
    audit('PAYMENT','ORDER',id,updated);
    return updated;
  }
  if(path.startsWith('/orders/')&&path.endsWith('/cancel')&&method==='POST'){
    const id=path.split('/')[2],existing=localOrders().find((o:any)=>o.id===id);
    if(!existing)return undefined;
    const updated={...existing,status:'CANCELLED',cancelledAt:now,cancelReason:body.reason||'Cancelled offline'};
    await upsertLocalOrder(updated);
    enqueueSync({id:`${id}_cancel_${Date.now()}`,entityType:'ORDER',entityLocalId:id,action:'CANCEL',payload:withDevice(body)});
    audit('CANCEL','ORDER',id,updated);
    return updated;
  }
  if(path==='/expenses'&&method==='POST'){
    const active=requireLocalActiveShift();
    const expense={id:localId,...body,outletId:active.outletId,cashSessionId:active.id,cashierId:user?.id,categoryName:body.categoryName||'Lain-lain',createdAt:now,status:'ACTIVE',createdOffline:true,syncStatus:'PENDING'};
    await upsertLocalExpense(expense);
    enqueueSync({id:localId,entityType:'EXPENSE',entityLocalId:localId,action:'CREATE',payload:withDevice({...body,outletId:expense.outletId,cashSessionId:expense.cashSessionId})});
    audit('ADD_EXPENSE','EXPENSE',localId,expense);
    return expense;
  }
  if(path.startsWith('/print/')||path.includes('/print/')){
    const saleId=path.split('/').filter(Boolean).pop()||localId;
    const log={id:localId,saleId,printType:path.includes('kitchen')?'KITCHEN_TICKET':path.includes('customer-item-list')?'CUSTOMER_ITEM_LIST':'CUSTOMER_RECEIPT',status:'SUCCESS',printedAt:now,printedBy:user?.id};
    enqueueSync({id:localId,entityType:'PRINTER_LOG',entityLocalId:localId,action:'PRINT',payload:withDevice(log)});
    audit('PRINT','PRINTER_LOG',localId,log);
    return log;
  }
  return undefined;
}
function buildLocalSale(localId:string,body:any,paid:boolean){const m=master();const outlet=(m?.outlets||[]).find((o:any)=>o.id===body.outletId);const user=JSON.parse(localStorage.getItem('user')||'null');const products=cachedPosProducts(m,body.outletId);const items=(body.items||[]).map((x:any)=>{const p=products.find((p:any)=>p.id===x.productId);const opts=(p?.variantGroups||[]).flatMap((vg:any)=>vg.group?.options||[]).filter((o:any)=>(x.selectedVariantOptionIds||[]).includes(o.id));const variant=x.variantId?(p?.variants||[]).find((v:any)=>v.id===x.variantId):p?.variants?.[0];const unit=Number(p?.basePrice??variant?.sellingPrice??0)+opts.reduce((s:number,o:any)=>s+Number(o.additionalPrice||0),0);const hpp=Number(p?.baseHpp||0)+opts.reduce((s:number,o:any)=>s+Number(o.hpp||0),0);const gross=unit*Number(x.qty||1);const disc=x.discount?Math.min(gross,x.discount.type==='PERCENTAGE'?gross*Number(x.discount.value||0)/100:Number(x.discount.value||0)):0;return{id:`${localId}_${x.productId}_${Math.random().toString(16).slice(2)}`,saleId:localId,outletId:body.outletId,productId:x.productId,productVariantId:x.variantId,productName:p?.name||'Produk lokal',variantName:opts.map((o:any)=>o.name).join(', ')||variant?.variantName||'Base',itemNote:x.itemNote,qty:x.qty,sellingPrice:unit,finalUnitPrice:unit,hpp,finalUnitHpp:hpp,totalHpp:hpp*Number(x.qty||1),discountType:x.discount?.type,discountValue:x.discount?.value,discountAmount:disc,subtotalAfterDiscount:gross-disc,snapshot:{productName:p?.name,sku:p?.sku||p?.id,price:unit,hpp,variantName:opts.map((o:any)=>o.name).join(', ')||variant?.variantName||'Base',variantOptions:opts,productDiscount:x.discount},addons:[]}});const subtotal=items.reduce((s:number,i:any)=>s+Number(i.sellingPrice)*Number(i.qty),0);const productDiscount=items.reduce((s:number,i:any)=>s+Number(i.discountAmount||0),0);const totalHpp=items.reduce((s:number,i:any)=>s+Number(i.totalHpp||0),0);const afterProduct=subtotal-productDiscount;const transactionDiscount=body.transactionDiscount?Math.min(afterProduct,body.transactionDiscount.type==='PERCENTAGE'?afterProduct*Number(body.transactionDiscount.value||0)/100:Number(body.transactionDiscount.value||0)):0;const grand=Math.max(0,afterProduct-transactionDiscount);const date=new Date().toISOString().slice(0,10).replaceAll('-','');const number=`LOCAL-${outlet?.code||'OUT'}-${date}-${String(Date.now()).slice(-4)}`;return{...withDevice({id:localId,localId,serverId:null,idempotencyKey:localId,orderNumber:paid?undefined:number,transactionNumber:paid?number:undefined,outletId:body.outletId,cashierId:user?.id,cashSessionId:body.cashSessionId,customerName:body.customerName||'Walk In',subtotal,subtotalBeforeDiscount:subtotal,productDiscountTotal:productDiscount,transactionDiscountAmount:transactionDiscount,couponCode:body.couponCode,couponDiscountAmount:0,taxAmount:0,serviceChargeAmount:0,grandTotal:grand,totalAmount:grand,discountAmount:productDiscount+transactionDiscount,totalHpp,grossProfit:grand-totalHpp,paymentMethod:paid?body.paymentMethod:undefined,cashReceived:paid?body.cashReceived:undefined,changeAmount:paid&&body.paymentMethod==='CASH'?Math.max(0,Number(body.cashReceived||0)-grand):0,status:paid?'PAID':'PENDING_PAYMENT',createdAt:new Date().toISOString(),paidAt:paid?new Date().toISOString():undefined,outlet,cashier:{name:user?.name||'Offline'},items,transactionSnapshot:{items,transactionDiscount:body.transactionDiscount,couponCode:body.couponCode,tax:0,serviceCharge:0},createdOffline:true,syncStatus:'PENDING'})}}
function withDevice<T extends Record<string,any>>(value:T){return{...value,deviceId:getCachedJson('foru:device_id',''),appVersion:'1.0.0',databaseVersion:1}}
function localOrders(){return getCachedJson<any[]>('foru:local_orders',[])}
async function upsertLocalOrder(order:any){const rows=localOrders().filter((x:any)=>x.id!==order.id);rows.unshift(order);await setLocalJson('foru:local_orders',rows)}
function localExpenses(){return getCachedJson<any[]>('foru:local_expenses',[])}
async function upsertLocalExpense(expense:any){const rows=localExpenses().filter((x:any)=>x.id!==expense.id);rows.unshift(expense);await setLocalJson('foru:local_expenses',rows)}
function localReport(){const sales=localOrders().filter((o:any)=>o.status==='PAID');const expenses=localExpenses().filter((e:any)=>e.status!=='CANCELLED');const sum=(key:string)=>sales.reduce((n:number,s:any)=>n+Number(s[key]||0),0);const gross=sum('subtotalBeforeDiscount'),productDiscount=sum('productDiscountTotal'),transactionDiscount=sum('transactionDiscountAmount'),couponDiscount=sum('couponDiscountAmount'),net=sum('grandTotal'),hpp=sum('totalHpp');const payments=Object.fromEntries(['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER'].map(p=>[p,sales.filter((s:any)=>s.paymentMethod===p).reduce((n:number,s:any)=>n+Number(s.grandTotal||0),0)]));const cashDrawerExpense=expenses.filter((e:any)=>e.paymentSource==='CASH_DRAWER').reduce((n:number,e:any)=>n+Number(e.amount||0),0);return{grossSales:gross,productDiscount,transactionDiscount,couponDiscount,netSales:net,paidSalesAmount:net,pendingOrdersCount:localOrders().filter((o:any)=>o.status==='PENDING_PAYMENT').length,pendingOrdersAmount:localOrders().filter((o:any)=>o.status==='PENDING_PAYMENT').reduce((n:number,o:any)=>n+Number(o.grandTotal||0),0),totalHpp:hpp,grossProfit:net-hpp,grossMargin:net?((net-hpp)/net*100):0,totalTransactions:sales.length,averageTicket:sales.length?net/sales.length:0,payments,cashDrawerExpense,nonCashExpense:expenses.filter((e:any)=>e.paymentSource==='NON_CASH').reduce((n:number,e:any)=>n+Number(e.amount||0),0),ownerTransferExpense:expenses.filter((e:any)=>e.paymentSource==='OWNER_TRANSFER').reduce((n:number,e:any)=>n+Number(e.amount||0),0),totalExpense:expenses.reduce((n:number,e:any)=>n+Number(e.amount||0),0),expenseByCategory:[],netCashMovement:Number(payments.CASH||0)-cashDrawerExpense,outlets:[],sales}}
