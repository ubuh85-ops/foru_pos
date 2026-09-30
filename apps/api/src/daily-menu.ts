import type { DailyMenuSchedule, Outlet, Prisma } from '@prisma/client';
import type { Router, Request } from 'express';
import { z } from 'zod';
import { ApiError, asyncRoute, prisma, money, allow } from './lib.js';
import { priceCart, validateCoupon, type CartLine } from './discount.js';
import * as XLSX from 'xlsx';

export const serviceDateInput=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
},'Tanggal tidak valid');
export const dateValue=(value:string)=>new Date(`${serviceDateInput.parse(value)}T00:00:00Z`);
export function dateWindow(outlet:Pick<Outlet,'timezone'|'preorderDisplayDays'>,now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:outlet.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  const from=dateValue(`${get('year')}-${get('month')}-${get('day')}`);
  return {from,to:new Date(from.getTime()+outlet.preorderDisplayDays*86400000)};
}
export function assertOrderMode(outlet:Pick<Outlet,'webOrderMode'|'preOrderEnabled'>,mode:string){
  if(mode==='PREORDER'&&(outlet.webOrderMode==='NORMAL_ONLY'||!outlet.preOrderEnabled))throw new ApiError(400,'Daily Pre-Order tidak tersedia di outlet ini');
  if(mode==='NORMAL'&&outlet.webOrderMode==='PREORDER_ONLY')throw new ApiError(400,'Outlet ini hanya menerima Daily Pre-Order');
}
export function publicDailyWhere(outlet:Outlet,now=new Date()):Prisma.DailyMenuScheduleWhereInput{
  const {from,to}=dateWindow(outlet,now);
  return {outletId:outlet.id,scheduleDate:{gte:from,lt:to},isAvailable:true,OR:[{cutoffAt:null},{cutoffAt:{gt:now}}],product:{businessId:outlet.businessId,status:'ACTIVE',outlets:{some:{outletId:outlet.id,isActive:true,status:'ACTIVE'}}}};
}
type DailyLine=CartLine&{serviceDate?:string;dailyMenuScheduleId?:string};
export function validateDailyItem(row:DailyMenuSchedule|undefined,outlet:Outlet,item:DailyLine,requested:number,now=new Date()){
  const {from,to}=dateWindow(outlet,now);
  if(!row||row.outletId!==outlet.id||row.productId!==item.productId||!row.isAvailable||
    row.scheduleDate.toISOString().slice(0,10)!==item.serviceDate||row.scheduleDate<from||row.scheduleDate>=to||
    (row.cutoffAt!==null&&row.cutoffAt<=now))throw new ApiError(409,`Menu tidak tersedia / cutoff lewat: ${item.productId}, ${item.serviceDate}`);
  if(row.quota!==null&&row.soldQty+requested>row.quota)throw new ApiError(409,`Kuota ${item.productId} (${item.serviceDate}) tidak cukup; tersisa ${row.quota-row.soldQty}`);
}
export function requestedSchedules(items:DailyLine[]){
  const totals=new Map<string,number>();
  for(const item of items){
    if(!Number.isInteger(item.qty)||item.qty<1||item.qty>50)throw new ApiError(400,'Jumlah item tidak valid');
    if(!item.dailyMenuScheduleId||!item.serviceDate)throw new ApiError(400,`Tanggal dan jadwal wajib diisi: ${item.productId}`);
    serviceDateInput.parse(item.serviceDate);
    totals.set(item.dailyMenuScheduleId,(totals.get(item.dailyMenuScheduleId)||0)+item.qty);
  }
  return totals;
}
export async function dailyTotals(tx:Prisma.TransactionClient,outlet:Outlet,items:DailyLine[],couponCode?:string,reserve=false){
  assertOrderMode(outlet,'PREORDER');
  const requested=requestedSchedules(items);
  // Lock schedules in a stable order. Admin edits, cancellation and checkout share these locks.
  if(reserve)for(const id of [...requested.keys()].sort())await tx.$queryRaw`SELECT id FROM daily_menu_schedules WHERE id=${id} AND outlet_id=${outlet.id} FOR UPDATE`;
  const rows=await tx.dailyMenuSchedule.findMany({where:{...publicDailyWhere(outlet),id:{in:[...requested.keys()]}},include:{productionPartner:true,product:{select:{name:true,outlets:{where:{outletId:outlet.id},select:{productionPartner:true}}}}}});
  const byId=new Map(rows.map(row=>[row.id,row]));
  for(const item of items){
    const row=byId.get(item.dailyMenuScheduleId!);
    try{validateDailyItem(row,outlet,item,requested.get(item.dailyMenuScheduleId!)!);}catch(error){if(error instanceof ApiError&&row)throw new ApiError(error.status,error.message.replace(item.productId,row.product.name));throw error;}
  }
  const lines=await priceCart(items,outlet.id,'DINE_IN',outlet.businessId,{db:tx,dailyPrices:items.map(item=>{const value=byId.get(item.dailyMenuScheduleId!)!.priceOverride;return value===null?null:Number(value);})});
  const gross=money(lines.reduce((sum,line)=>sum+line.gross,0));
  if(reserve&&couponCode)await tx.$queryRaw`SELECT id FROM coupons WHERE business_id=${outlet.businessId} AND coupon_code=${couponCode.trim().toUpperCase()} FOR UPDATE`;
  const couponResult=couponCode?await validateCoupon(couponCode,outlet.id,lines,undefined,outlet.businessId,tx):null;
  const couponDiscount=Math.min(gross,couponResult?.discountAmount||0);
  if(reserve)for(const [id,qty] of [...requested].sort(([a],[b])=>a.localeCompare(b))){
    const updated=await tx.$executeRaw`UPDATE daily_menu_schedules SET sold_qty=sold_qty+${qty}, updated_at=NOW() WHERE id=${id} AND is_available=true AND (cutoff_at IS NULL OR cutoff_at>clock_timestamp()) AND (quota IS NULL OR sold_qty+${qty}<=quota)`;
    if(updated!==1)throw new ApiError(409,'Menu baru saja ditutup atau kuota habis. Perbarui keranjang.');
  }
  return {lines:lines.map((line,index)=>{const row=byId.get(items[index]!.dailyMenuScheduleId!)!,partner=row.productionPartner||row.product.outlets?.[0]?.productionPartner;return {...line,serviceDate:dateValue(items[index]!.serviceDate!),dailyMenuScheduleId:items[index]!.dailyMenuScheduleId,productionPartnerId:partner?.id,productionPartnerName:partner?.name||'Belum Ditentukan',productionPartnerType:partner?.type,priceSource:'DAILY_MENU'};}),gross,productDiscount:0,transactionDiscount:0,couponResult,couponDiscount,grand:money(gross-couponDiscount),totalHpp:money(lines.reduce((sum,line)=>sum+line.hpp*line.qty,0))};
}
export async function releaseDailyQuota(tx:Prisma.TransactionClient,saleId:string){
  const claimed=await tx.sale.updateMany({where:{id:saleId,orderMode:'PREORDER',quotaReleasedAt:null},data:{quotaReleasedAt:new Date()}});
  if(!claimed.count)return;
  const items=await tx.saleItem.findMany({where:{saleId,dailyMenuScheduleId:{not:null}}});
  const totals=new Map<string,number>();
  for(const item of items)totals.set(item.dailyMenuScheduleId!, (totals.get(item.dailyMenuScheduleId!)||0)+item.qty);
  for(const [id,qty] of [...totals].sort(([a],[b])=>a.localeCompare(b)))await tx.dailyMenuSchedule.update({where:{id},data:{soldQty:{decrement:qty}}});
}

const scheduleInput=z.object({outletId:z.string().min(1),scheduleDate:serviceDateInput,productId:z.string().min(1),productionPartnerId:z.string().nullable().default(null),priceOverride:z.number().finite().nonnegative().max(999999999999).nullable().default(null),quota:z.number().int().nonnegative().max(2147483647).nullable().default(null),isAvailable:z.boolean().default(true),sortOrder:z.number().int().min(0).max(100000).default(0),cutoffAt:z.string().datetime({offset:true}).nullable().default(null)});
const fulfillmentStatusInput=z.enum(['PENDING','PROCESSING','READY','COMPLETED']);
export const fulfillmentInput=z.object({serviceDate:serviceDateInput,status:fulfillmentStatusInput,itemId:z.string().min(1).optional(),expectedStatus:fulfillmentStatusInput.optional()});
export async function fulfillDailyItems(tx:Prisma.TransactionClient,saleId:string,input:z.infer<typeof fulfillmentInput>){
  const updated=await tx.saleItem.updateMany({
    where:{saleId,serviceDate:dateValue(input.serviceDate),dailyMenuScheduleId:{not:null},...(input.itemId?{id:input.itemId}:{}),...(input.expectedStatus?{fulfillmentStatus:input.expectedStatus}:{})},
    data:{fulfillmentStatus:input.status,fulfilledAt:input.status==='COMPLETED'?new Date():null}
  });
  if(!updated.count)throw new ApiError(input.expectedStatus?409:404,input.expectedStatus?'Status item sudah berubah atau item tidak tersedia. Muat ulang rekap.':'Item tidak ditemukan pada pesanan dan tanggal ini');
  return updated;
}
export function registerDailyMenuAdmin(api:Router,assertOutlet:(req:Request,id:string)=>Promise<unknown>){
  async function scope(req:Request,outletId:string){await assertOutlet(req,outletId);return {outletId,outlet:{businessId:req.user!.businessId}};}
  async function partner(req:Request,id:string,outletId?:string){const row=await prisma.productionPartner.findFirst({where:{id,businessId:req.user!.businessId,...(outletId?{outletId}:{})}});if(!row)throw new ApiError(400,'Mitra Produksi tidak valid untuk outlet ini');return row;}
  const partnerInput=z.object({outletId:z.string(),name:z.string().trim().min(2).max(120),type:z.enum(['INTERNAL_KITCHEN','EXTERNAL_VENDOR']),contactName:z.string().trim().max(100).nullable().default(null),phone:z.string().trim().max(30).nullable().default(null),address:z.string().trim().max(300).nullable().default(null),notes:z.string().trim().max(500).nullable().default(null),sortOrder:z.number().int().min(0).max(100000).default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
  api.get('/production-partners',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const outletId=z.string().parse(req.query.outletId);await scope(req,outletId);res.json(await prisma.productionPartner.findMany({where:{businessId:req.user!.businessId,outletId},orderBy:[{sortOrder:'asc'},{name:'asc'}]}));}));
  api.post('/production-partners',allow('OWNER'),asyncRoute(async(req,res)=>{const d=partnerInput.parse(req.body);await scope(req,d.outletId);res.status(201).json(await prisma.productionPartner.create({data:{...d,businessId:req.user!.businessId}}));}));
  api.put('/production-partners/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const id=String(req.params.id),current=await partner(req,id);const d=partnerInput.partial().omit({outletId:true}).parse(req.body);res.json(await prisma.productionPartner.update({where:{id:current.id},data:d}));}));
  api.delete('/production-partners/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const current=await partner(req,String(req.params.id));res.json(await prisma.productionPartner.update({where:{id:current.id},data:{status:'INACTIVE'}}));}));
  api.get('/admin/preorder/schedules',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
    const d=z.object({outletId:z.string(),from:serviceDateInput,to:serviceDateInput}).parse(req.query);
    res.json(await prisma.dailyMenuSchedule.findMany({where:{...await scope(req,d.outletId),scheduleDate:{gte:dateValue(d.from),lte:dateValue(d.to)}},include:{productionPartner:true,product:{select:{id:true,name:true,outlets:{where:{outletId:d.outletId},select:{productionPartner:true}}}}},orderBy:[{scheduleDate:'asc'},{sortOrder:'asc'}]}));
  }));
  api.post('/admin/preorder/schedules',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
    const d=scheduleInput.parse(req.body);await scope(req,d.outletId);
    const product=await prisma.product.findFirst({where:{id:d.productId,businessId:req.user!.businessId,status:'ACTIVE',outlets:{some:{outletId:d.outletId,isActive:true,status:'ACTIVE'}}}});
    if(!product)throw new ApiError(400,'Produk tidak aktif di outlet ini');
    if(d.productionPartnerId)await partner(req,d.productionPartnerId,d.outletId);
    res.status(201).json(await prisma.dailyMenuSchedule.create({data:{...d,scheduleDate:dateValue(d.scheduleDate),cutoffAt:d.cutoffAt?new Date(d.cutoffAt):null}}));
  }));
  api.put('/admin/preorder/schedules/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
    const d=scheduleInput.omit({outletId:true,scheduleDate:true,productId:true}).parse(req.body),id=String(req.params.id);
    res.json(await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM daily_menu_schedules WHERE id=${id} FOR UPDATE`;
      const row=await tx.dailyMenuSchedule.findUnique({where:{id}});if(!row)throw new ApiError(404,'Jadwal tidak ditemukan');await scope(req,row.outletId);
      if(d.productionPartnerId)await partner(req,d.productionPartnerId,row.outletId);
      if(d.quota!==null&&d.quota<row.soldQty)throw new ApiError(400,`Kuota minimal ${row.soldQty}, sesuai pesanan masuk`);
      return tx.dailyMenuSchedule.update({where:{id},data:d});
    }));
  }));
  api.delete('/admin/preorder/schedules/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
    const id=String(req.params.id);
    res.json(await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM daily_menu_schedules WHERE id=${id} FOR UPDATE`;
      const row=await tx.dailyMenuSchedule.findUnique({where:{id},include:{_count:{select:{items:true}}}});if(!row)throw new ApiError(404,'Jadwal tidak ditemukan');await scope(req,row.outletId);
      // Keep referenced schedules to preserve order history.
      return row._count.items?tx.dailyMenuSchedule.update({where:{id},data:{isAvailable:false}}):tx.dailyMenuSchedule.delete({where:{id}});
    }));
  }));
  api.post('/admin/preorder/schedules/copy',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
    const d=z.object({outletId:z.string(),sourceDate:serviceDateInput,targetDates:z.array(serviceDateInput).min(1).max(60)}).parse(req.body);await scope(req,d.outletId);
    const rows=await prisma.dailyMenuSchedule.findMany({where:{outletId:d.outletId,scheduleDate:dateValue(d.sourceDate)}});
    if(!rows.length)throw new ApiError(400,'Jadwal sumber kosong');
    const data=[...new Set(d.targetDates)].filter(date=>date!==d.sourceDate).flatMap(date=>rows.map(row=>({outletId:d.outletId,productId:row.productId,productionPartnerId:row.productionPartnerId,scheduleDate:dateValue(date),priceOverride:row.priceOverride,quota:row.quota,isAvailable:row.isAvailable,sortOrder:row.sortOrder,cutoffAt:row.cutoffAt?new Date(row.cutoffAt.getTime()+dateValue(date).getTime()-dateValue(d.sourceDate).getTime()):null})));
    res.json(await prisma.dailyMenuSchedule.createMany({data,skipDuplicates:true}));
  }));
  api.get(['/admin/preorder/recap','/admin/preorder/recap/production','/admin/preorder/recap/customers'],asyncRoute(async(req,res)=>{
    const d=z.object({outletId:z.string(),from:serviceDateInput,to:serviceDateInput,status:z.enum(['OPEN_ORDER','PENDING_PAYMENT','PAID','COMPLETED','CANCELLED','REJECTED','VOID']).optional(),paymentStatus:z.enum(['PAID','UNPAID']).optional(),productId:z.string().optional(),productionPartnerId:z.string().optional(),customer:z.string().optional()}).parse(req.query);
    await scope(req,d.outletId);
    const sale:Prisma.SaleWhereInput={businessId:req.user!.businessId,orderMode:'PREORDER',status:d.status??{notIn:['CANCELLED','REJECTED','VOID']},...(d.paymentStatus?{paidAt:d.paymentStatus==='PAID'?{not:null}:null}:{}),...(d.customer?{OR:[{customerName:{contains:d.customer,mode:'insensitive'}},{customerPhone:{contains:d.customer}}]}:{})};
    const items=await prisma.saleItem.findMany({where:{outletId:d.outletId,serviceDate:{gte:dateValue(d.from),lte:dateValue(d.to)},...(d.productId?{productId:d.productId}:{}),...(d.productionPartnerId?{productionPartnerId:d.productionPartnerId}:{}),sale},include:{addons:true,sale:{select:{id:true,orderNumber:true,customerName:true,customerPhone:true,orderNote:true,status:true,paidAt:true}}},orderBy:[{serviceDate:'asc'},{productName:'asc'}]});
    if(req.path.endsWith('/production')||req.path.endsWith('/customers')){
      const production=req.path.endsWith('/production');
      const groups=new Map<string,{serviceDate:string;productId?:string|null;productName?:string;customerName?:string;customerPhone?:string|null;orderId?:string;qty:number;items:typeof items}>();
      for(const item of items){
        const serviceDate=item.serviceDate!.toISOString().slice(0,10),key=`${serviceDate}:${production?item.productId:item.sale.id}`;
        const group=groups.get(key)??{serviceDate,...(production?{productId:item.productId,productName:item.productName}:{customerName:item.sale.customerName,customerPhone:item.sale.customerPhone,orderId:item.sale.id}),qty:0,items:[]};
        group.qty+=item.qty;group.items.push(item);groups.set(key,group);
      }
      return res.json([...groups.values()]);
    }
    res.json(items);
  }));
  api.get('/admin/preorder/recap/export',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
    const d=z.object({outletId:z.string(),from:serviceDateInput,to:serviceDateInput,status:z.enum(['OPEN_ORDER','PENDING_PAYMENT','PAID','COMPLETED','CANCELLED','REJECTED','VOID']).optional(),paymentStatus:z.enum(['PAID','UNPAID']).optional(),productId:z.string().optional(),productionPartnerId:z.string().optional(),customer:z.string().optional()}).parse(req.query);
    await scope(req,d.outletId);
    if((dateValue(d.to).getTime()-dateValue(d.from).getTime())/86400000>90)throw new ApiError(400,'Rentang download maksimal 90 hari');
    const sale:Prisma.SaleWhereInput={businessId:req.user!.businessId,orderMode:'PREORDER',status:d.status??{notIn:['CANCELLED','REJECTED','VOID']},...(d.paymentStatus?{paidAt:d.paymentStatus==='PAID'?{not:null}:null}:{}),...(d.customer?{OR:[{customerName:{contains:d.customer,mode:'insensitive'}},{customerPhone:{contains:d.customer}}]}:{})};
    const items=await prisma.saleItem.findMany({where:{outletId:d.outletId,serviceDate:{gte:dateValue(d.from),lte:dateValue(d.to)},...(d.productId?{productId:d.productId}:{}),...(d.productionPartnerId?{productionPartnerId:d.productionPartnerId}:{}),sale},include:{addons:true,productionPartner:true,dailyMenuSchedule:{include:{productionPartner:true}},product:{select:{outlets:{where:{outletId:d.outletId},select:{productionPartner:true}}}},sale:{select:{orderNumber:true,customerName:true,customerPhone:true,orderNote:true,status:true,paidAt:true}}},orderBy:[{serviceDate:'asc'},{productName:'asc'}]});
    if(!items.length)throw new ApiError(404,'Tidak ada data pada filter ini');
    const outlet=await prisma.outlet.findUniqueOrThrow({where:{id:d.outletId},select:{name:true}});
    const groups=new Map<string,typeof items>();
    for(const item of items){const name=item.productionPartnerName||item.productionPartner?.name||item.dailyMenuSchedule?.productionPartner?.name||item.product?.outlets[0]?.productionPartner?.name||'Belum Ditentukan';groups.set(name,[...(groups.get(name)||[]),item]);}
    const workbook=XLSX.utils.book_new();
    const summary=new Map<string,{Tanggal:string;Mitra:string;Menu:string;'Total Qty':number}>();
    for(const [name,rows] of groups){
      const details=rows.map(item=>({'Tanggal Layanan':item.serviceDate!.toISOString().slice(0,10),'Nama Pemesan':item.sale.customerName,'No. WhatsApp':item.sale.customerPhone||'','No. Order':item.sale.orderNumber||'','Nama Menu':item.productName,'Varian':item.variantName,'Topping':item.addons.map(a=>a.addonName).join(', '),'Qty':item.qty,'Catatan Item':item.itemNote||'','Catatan Order':item.sale.orderNote||'','Pembayaran':item.sale.paidAt?'Lunas':'Belum Lunas','Status Item':item.fulfillmentStatus}));
      for(const item of rows){const date=item.serviceDate!.toISOString().slice(0,10),key=`${date}|${name}|${item.productName}`,row=summary.get(key)??{Tanggal:date,Mitra:name,Menu:item.productName,'Total Qty':0};row['Total Qty']+=item.qty;summary.set(key,row);}
      const sheet=XLSX.utils.json_to_sheet(details);sheet['!cols']=[12,22,18,24,28,18,24,8,28,28,14,18].map(w=>({wch:w}));XLSX.utils.book_append_sheet(workbook,sheet,name.replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'Mitra');
    }
    const summarySheet=XLSX.utils.json_to_sheet([...summary.values()]);summarySheet['!cols']=[12,24,30,12].map(w=>({wch:w}));XLSX.utils.book_append_sheet(workbook,summarySheet,'Rekap Produksi',true);
    const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="rekap-daily-preorder-${outlet.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-${d.from}-${d.to}.xlsx"`);res.send(buffer);
  }));
  api.post('/admin/preorder/orders/:id/fulfill',asyncRoute(async(req,res)=>{
    const d=fulfillmentInput.parse(req.body),id=String(req.params.id);
    res.json(await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM sales WHERE id=${id} FOR UPDATE`;
      const sale=await tx.sale.findUnique({where:{id}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');await scope(req,sale.outletId);
      if(sale.orderMode!=='PREORDER'||!['PENDING_PAYMENT','PAID'].includes(sale.status))throw new ApiError(400,'Terima pesanan terlebih dahulu; pesanan batal tidak dapat diproses');
      return fulfillDailyItems(tx,id,d);
    }));
  }));
}
