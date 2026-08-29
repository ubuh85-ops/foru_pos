import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors, { type CorsOptions } from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';
import { promises as fs } from 'fs';
import sharp from 'sharp';
import { allow, ApiError, assertOutlet, asyncRoute, auth, dayRange, defaultBusinessForUser, defaultInventoryPermissions, hasPermission, money, prisma, requirePermission, tenantAnd, tenantScope } from './lib.js';
import { discountAmount, legacyVariantPrice, priceCart, validateCoupon } from './discount.js';
import { validatePublicSchedule } from './preorder.js';
import { sendCustomerWebOrderPush } from './push.js';

const defaultCorsOrigins = [
  'http://localhost',
  'http://localhost:5173',
  'http://192.168.1.24:5173',
  'http://103.253.244.190:5173',
  'capacitor://localhost',
  'ionic://localhost'
];
function parseOrigins(value?: string) {
  return (value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}
function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}
const corsOrigins = [
  ...defaultCorsOrigins,
  ...parseOrigins(process.env.WEB_URL),
  ...parseOrigins(process.env.CORS_ORIGINS)
]
  .map(normalizeOrigin)
  .filter(Boolean);
const allowedCorsOrigins = new Set(corsOrigins);
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedCorsOrigins.has(normalizeOrigin(origin))) return callback(null, true);
    return callback(new ApiError(403, `Origin ${origin} tidak diizinkan oleh CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};

const app = express();
const storageRoot = path.resolve(process.env.STORAGE_DIR || 'storage');

app.use(cors(corsOptions));
app.use('/storage/products', express.static(path.join(storageRoot, 'products'), {
  fallthrough: false,
  maxAge: '30d',
  immutable: true
}));

app.use(express.json({
  limit: "5mb",
}));

app.use(express.urlencoded({
  extended: true,
  limit: "5mb",
}));
const api=express.Router(); app.use('/api',api);
api.get('/health',(_q,r)=>r.json({ok:true}));
const outletInclude={defaultInventoryWarehouse:true,warehouses:true};
const defaultInventoryUnitNames=['Gram','Kg','Ml','Liter','Pcs','Box','Pack','Botol','Cup'];
const defaultInventoryCategoryNames=['Minuman','Makanan','Bumbu','Packaging','Bahan Baku','Lainnya'];

function safeCode(value:string,fallback:string){
  const code=value.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);
  return code || fallback;
}

const registerBusinessBody=z.object({
  businessName:z.string().trim().min(2,'Nama bisnis wajib diisi'),
  businessCode:z.string().trim().optional(),
  ownerName:z.string().trim().min(2,'Nama owner wajib diisi'),
  username:z.string().trim().min(3,'Username minimal 3 karakter'),
  password:z.string().min(8,'Password minimal 8 karakter'),
  confirmPassword:z.string().optional(),
  phone:z.string().trim().optional(),
  email:z.string().trim().email('Email tidak valid').optional().or(z.literal('')),
  address:z.string().trim().optional(),
  outletCode:z.string().trim().min(2,'Kode outlet wajib diisi'),
  outletName:z.string().trim().min(2,'Nama outlet wajib diisi'),
  outletAddress:z.string().trim().optional(),
  outletPhone:z.string().trim().optional(),
  warehouseCode:z.string().trim().optional(),
  warehouseName:z.string().trim().optional()
}).superRefine((d,ctx)=>{
  if(d.confirmPassword!==undefined&&d.password!==d.confirmPassword)ctx.addIssue({code:'custom',path:['confirmPassword'],message:'Password dan konfirmasi password harus sama'});
});

api.post('/auth/register-business',asyncRoute(async(req,res)=>{
  const d=registerBusinessBody.parse(req.body);
  const businessCode=safeCode(d.businessCode||d.businessName,'BUSINESS');
  const outletCode=safeCode(d.outletCode,'OUTLET');
  const warehouseCode=safeCode(d.warehouseCode||`${outletCode}_WH`,'WAREHOUSE');
  const existingBusiness=await prisma.business.findUnique({where:{code:businessCode}});
  if(existingBusiness)throw new ApiError(409,'Kode bisnis sudah digunakan');
  const existingUser=await prisma.user.findUnique({where:{username:d.username}});
  if(existingUser)throw new ApiError(409,'Username sudah digunakan');

  const result=await prisma.$transaction(async(tx)=>{
    const business=await tx.business.create({data:{
      code:businessCode,
      name:d.businessName,
      phone:d.phone||null,
      email:d.email||null,
      address:d.address||null,
      status:'ACTIVE'
    }});
    const user=await tx.user.create({data:{
      name:d.ownerName,
      username:d.username,
      passwordHash:await bcrypt.hash(d.password,10),
      role:'OWNER',
      status:'ACTIVE',
      lastLogin:new Date(),
      inventoryPermissions:defaultInventoryPermissions('OWNER')
    }});
    const membership=await tx.businessMembership.create({data:{businessId:business.id,userId:user.id,role:'OWNER',status:'ACTIVE'}});
    const outlet=await tx.outlet.create({data:{
      businessId:business.id,
      code:outletCode,
      name:d.outletName,
      address:d.outletAddress||d.address||null,
      phone:d.outletPhone||d.phone||null,
      status:'ACTIVE'
    }});
    const warehouse=await tx.inventoryWarehouse.create({data:{
      businessId:business.id,
      code:warehouseCode,
      name:d.warehouseName||`${d.outletName} Warehouse`,
      type:'OUTLET',
      outletId:outlet.id,
      address:d.outletAddress||d.address||null,
      status:'ACTIVE'
    }});
    const updatedOutlet=await tx.outlet.update({where:{id:outlet.id},data:{inventoryWarehouseId:warehouse.id},include:outletInclude});
    await tx.userOutlet.create({data:{userId:user.id,outletId:outlet.id,status:'ACTIVE'}});
    await tx.inventoryUnit.createMany({data:defaultInventoryUnitNames.map((name,sortOrder)=>({businessId:business.id,name,sortOrder,status:'ACTIVE'})),skipDuplicates:true});
    await tx.inventoryCategory.createMany({data:defaultInventoryCategoryNames.map((name,sortOrder)=>({businessId:business.id,name,sortOrder,status:'ACTIVE'})),skipDuplicates:true});
    return {business,user,membership,outlet:updatedOutlet};
  });
  const inventoryPermissions=defaultInventoryPermissions('OWNER');
  const payload={id:result.user.id,businessId:result.business.id,membershipId:result.membership.id,role:'OWNER',outletIds:[result.outlet.id],assignedWarehouseId:null};
  res.status(201).json({
    token:jwt.sign(payload,process.env.JWT_SECRET||'dev-secret',{expiresIn:'12h'}),
    user:{id:result.user.id,name:result.user.name,username:result.user.username,role:'OWNER',status:result.user.status,outletIds:payload.outletIds,inventoryPermissions,assignedWarehouseId:null,business:result.business,membership:{id:result.membership.id,businessId:result.membership.businessId,role:result.membership.role,status:result.membership.status}},
    business:result.business,
    membership:{id:result.membership.id,businessId:result.membership.businessId,role:result.membership.role,status:result.membership.status},
    permissions:inventoryPermissions,
    outlets:[result.outlet]
  });
}));

api.post('/auth/login',asyncRoute(async(req,res)=>{
  const {username,password}=z.object({username:z.string(),password:z.string()}).parse(req.body);
  const user=await prisma.user.findUnique({where:{username},include:{outlets:{include:{outlet:true}}}});
  if(!user||user.status!=='ACTIVE'||!await bcrypt.compare(password,user.passwordHash)) throw new ApiError(401,'Username atau password salah');
  const membership=await defaultBusinessForUser(user.id);
  if(!membership) throw new ApiError(403,'Akses bisnis tidak ditemukan');
  const role=membership.role;
  const outletIds=role==='OWNER'
    ? (await prisma.outlet.findMany({where:{status:'ACTIVE',businessId:membership.businessId},select:{id:true}})).map(x=>x.id)
    : user.outlets
      .filter(x=>x.status==='ACTIVE'&&x.outlet.status==='ACTIVE'&&x.outlet.businessId===membership.businessId)
      .map(x=>x.outletId);
  const inventoryPermissions=user.inventoryPermissions.length?user.inventoryPermissions:defaultInventoryPermissions(role);
  const payload={id:user.id,businessId:membership.businessId,membershipId:membership.id,role,outletIds,assignedWarehouseId:user.assignedWarehouseId};
  await prisma.user.update({where:{id:user.id},data:{lastLogin:new Date()}});
  res.json({
    token:jwt.sign(payload,process.env.JWT_SECRET||'dev-secret',{expiresIn:'12h'}),
    user:{id:user.id,name:user.name,role,outletIds:payload.outletIds,inventoryPermissions,assignedWarehouseId:user.assignedWarehouseId},
    business:membership.business,
    membership:{id:membership.id,businessId:membership.businessId,role:membership.role,status:membership.status},
    permissions:inventoryPermissions,
    outlets:await prisma.outlet.findMany({where:{id:{in:outletIds}},include:outletInclude,orderBy:{name:'asc'}})
  });
}));
api.get('/auth/me',auth,asyncRoute(async(req,res)=>{const user=await prisma.user.findUnique({where:{id:req.user!.id},select:{id:true,name:true,username:true,role:true,status:true,lastLogin:true,inventoryPermissions:true,assignedWarehouseId:true,assignedWarehouse:true,outlets:{where:{status:'ACTIVE'},select:{outlet:true}}}});const membership=await prisma.businessMembership.findUnique({where:{id:req.user!.membershipId},include:{business:true}});res.json(user?{...user,role:req.user!.role,outletIds:req.user!.outletIds,inventoryPermissions:req.user!.inventoryPermissions,assignedWarehouseId:req.user!.assignedWarehouseId,business:membership?.business,membership:membership&&{id:membership.id,businessId:membership.businessId,role:membership.role,status:membership.status}}:null);}));

function publicSlug(value:string){
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
async function resolvePublicOrderOutlet(businessSlug:string,outletSlug:string){
  const businesses=await prisma.business.findMany({where:{status:'ACTIVE'}});
  const wantedBusiness=publicSlug(businessSlug);
  const business=businesses.find(b=>publicSlug(b.code)===wantedBusiness||publicSlug(b.name)===wantedBusiness);
  if(!business)throw new ApiError(404,'Business tidak ditemukan');
  const outlets=await prisma.outlet.findMany({where:{businessId:business.id,status:'ACTIVE'},include:outletInclude});
  const wantedOutlet=publicSlug(outletSlug);
  const outlet=outlets.find(o=>publicSlug(o.customerOrderingSlug||'')===wantedOutlet||publicSlug(o.code)===wantedOutlet||publicSlug(o.name)===wantedOutlet);
  if(!outlet)throw new ApiError(404,'Outlet tidak ditemukan');
  return {business,outlet};
}
function publicProductShape(p:any,outletId:string,channel='DINE_IN'){
  const po=p.outlets?.[0];
  const dineInPrice=po?.outletPrice??p.basePrice;
  const cp=p.channelPrices?.[0];
  const activePrice=cp?.price??dineInPrice;
  return {
    id:p.id,
    sku:p.sku,
    name:p.name,
    category:p.categoryRef?.name||p.category,
    categoryRef:p.categoryRef?{id:p.categoryRef.id,name:p.categoryRef.name,sortOrder:p.categoryRef.sortOrder}:null,
    description:p.description,
    imageUrl:p.imageUrl,
    isAvailable:!!po&&po.isAvailable&&po.isActive&&po.status==='ACTIVE',
    isRecommended:!!po?.isRecommended,
    basePrice:Number(activePrice),
    priceChannel:channel,
    variants:(p.variants||[]).map((v:any)=>({id:v.id,variantName:v.variantName,sellingPrice:legacyVariantPrice(Number(p.basePrice),Number(activePrice),Number(v.sellingPrice))})),
    addons:(p.addons||[]).map((a:any)=>({id:a.id,addonName:a.addonName,price:Number(a.price)})),
    variantGroups:(p.variantGroups||[]).map((vg:any)=>({
      id:vg.id,
      group:{
        id:vg.group.id,
        name:vg.group.name,
        minSelect:vg.group.minSelect,
        maxSelect:vg.group.maxSelect,
        required:vg.group.required,
        options:vg.group.options
          .filter((o:any)=>!o.outlets?.[0]||o.outlets[0].status==='ACTIVE')
          .map((o:any)=>({id:o.id,name:o.name,additionalPrice:Number(o.outlets?.[0]?.additionalPrice??o.additionalPrice)}))
      }
    }))
  };
}
const publicOrderItemInput=z.object({productId:z.string(),variantId:z.string().optional(),selectedVariantOptionIds:z.array(z.string()).default([]),qty:z.number().int().min(1).max(50),addonIds:z.array(z.string()).default([]),itemNote:z.string().trim().max(255).optional()});
const publicOrderInput=z.object({
  customerName:z.string().trim().min(2,'Nama customer wajib diisi').max(80),
  customerPhone:z.string().trim().regex(/^\+?[0-9][0-9\s-]{7,19}$/,'Nomor WhatsApp tidak valid'),
  orderType:z.enum(['DINE_IN','TAKE_AWAY','DELIVERY']),
  tableNumber:z.string().trim().max(30).optional().or(z.literal('')),
  orderNote:z.string().trim().max(500).optional().or(z.literal('')),
  isPreOrder:z.boolean().default(false),
  scheduledAt:z.string().datetime({offset:true}).nullable().optional(),
  customerOrderRequestId:z.string().trim().min(8).max(120),
  items:z.array(publicOrderItemInput).min(1).max(30)
});
const publicOrderRate=new Map<string,{count:number;resetAt:number}>();
function assertPublicOrderRateLimit(req:express.Request){
  const now=Date.now();
  const key=`${req.ip||'unknown'}:${req.params.businessSlug}:${req.params.outletSlug}`;
  const current=publicOrderRate.get(key);
  if(!current||current.resetAt<now){
    publicOrderRate.set(key,{count:1,resetAt:now+10*60*1000});
    return;
  }
  current.count+=1;
  if(current.count>30)throw new ApiError(429,'Terlalu banyak percobaan order. Silakan coba lagi beberapa menit lagi.');
}
api.get('/public/order/status/:token',asyncRoute(async(req,res)=>{
  const sale=await prisma.sale.findUnique({where:{publicOrderToken:String(req.params.token)},include:{outlet:true,business:true,items:{include:{addons:true}}}});
  if(!sale)throw new ApiError(404,'Status pesanan tidak ditemukan');
  res.json({orderNumber:sale.orderNumber,status:sale.status,customerName:sale.customerName,customerPhone:sale.customerPhone,tableNumber:sale.tableNumber,orderType:sale.orderType,orderNote:sale.orderNote,isPreOrder:sale.isPreOrder,scheduledAt:sale.scheduledAt,rejectionReason:sale.rejectionReason,grandTotal:sale.grandTotal,submittedAt:sale.submittedAt,acceptedAt:sale.acceptedAt,paidAt:sale.paidAt,outlet:{name:sale.outlet.name,code:sale.outlet.code,timezone:sale.outlet.timezone},business:{name:sale.business.name,code:sale.business.code,logoUrl:sale.business.logoUrl},items:sale.items.map(i=>({id:i.id,productName:i.productName,variantName:i.variantName,qty:i.qty,itemNote:i.itemNote,subtotalAfterDiscount:i.subtotalAfterDiscount,addons:i.addons.map(a=>({addonName:a.addonName,price:a.price}))}))});
}));
api.get('/public/order/:businessSlug/:outletSlug',asyncRoute(async(req,res)=>{
  const {business,outlet}=await resolvePublicOrderOutlet(String(req.params.businessSlug),String(req.params.outletSlug));
  const enabled=outlet.customerOrderingEnabled&&outlet.acceptingCustomerOrders;
  res.json({business:{name:business.name,code:business.code,logoUrl:business.logoUrl},outlet:{name:outlet.name,code:outlet.code,slug:outlet.customerOrderingSlug||publicSlug(outlet.code),enabled,acceptingCustomerOrders:outlet.acceptingCustomerOrders,allowDineIn:outlet.customerOrderAllowDineIn,allowTakeAway:outlet.customerOrderAllowTakeAway,allowDelivery:outlet.customerOrderAllowDelivery,requestPhone:true,preOrderEnabled:outlet.preOrderEnabled,preOrderMinLeadMinutes:outlet.preOrderMinLeadMinutes,preOrderMaxDaysAhead:outlet.preOrderMaxDaysAhead,preOrderSlotMinutes:outlet.preOrderSlotMinutes,openTime:outlet.customerOrderOpenTime,closeTime:outlet.customerOrderCloseTime,operatingDays:outlet.customerOrderOperatingDays,timezone:outlet.timezone}});
}));
api.get('/public/order/:businessSlug/:outletSlug/products',asyncRoute(async(req,res)=>{
  const {business,outlet}=await resolvePublicOrderOutlet(String(req.params.businessSlug),String(req.params.outletSlug));
  if(!outlet.customerOrderingEnabled||!outlet.acceptingCustomerOrders)throw new ApiError(403,'Pesanan online sedang ditutup');
  const products=await prisma.product.findMany({where:{businessId:business.id,status:'ACTIVE',OR:[{categoryId:null},{categoryRef:{status:'ACTIVE'}}],outlets:{some:{outletId:outlet.id,isActive:true,status:'ACTIVE'}}},include:{categoryRef:true,outlets:{where:{outletId:outlet.id,isActive:true}},variants:{where:{status:'ACTIVE'}},addons:{where:{status:'ACTIVE'}},variantGroups:{orderBy:{sortOrder:'asc'},include:{group:{include:{options:{where:{status:'ACTIVE'},orderBy:{sortOrder:'asc'},include:{outlets:{where:{outletId:outlet.id}}}}}}}}},orderBy:[{categoryRef:{sortOrder:'asc'}},{name:'asc'}]});
  res.json(products.map(p=>publicProductShape(p,outlet.id)));
}));
api.post('/public/order/:businessSlug/:outletSlug/preview',asyncRoute(async(req,res)=>{
  const items=z.object({items:z.array(publicOrderItemInput).min(1).max(30)}).parse(req.body).items;
  const {business,outlet}=await resolvePublicOrderOutlet(String(req.params.businessSlug),String(req.params.outletSlug));
  if(!outlet.customerOrderingEnabled||!outlet.acceptingCustomerOrders)throw new ApiError(403,'Pesanan online sedang ditutup');
  const totals=await buildOrderTotals({user:{businessId:business.id,id:'CUSTOMER_WEB'}},{outletId:outlet.id,items} as any);
  res.json({subtotal:totals.gross,productDiscount:totals.productDiscount,transactionDiscount:totals.transactionDiscount,couponDiscount:totals.couponDiscount,total:totals.grand});
}));
api.post('/public/order/:businessSlug/:outletSlug/orders',asyncRoute(async(req,res)=>{
  const d=publicOrderInput.parse(req.body);
  assertPublicOrderRateLimit(req);
  const {business,outlet}=await resolvePublicOrderOutlet(String(req.params.businessSlug),String(req.params.outletSlug));
  if(!outlet.customerOrderingEnabled||!outlet.acceptingCustomerOrders)throw new ApiError(403,'Pesanan online sedang ditutup');
  if(d.orderType==='DINE_IN'&&!outlet.customerOrderAllowDineIn)throw new ApiError(400,'Dine In tidak tersedia untuk pesanan online');
  if(d.orderType==='TAKE_AWAY'&&!outlet.customerOrderAllowTakeAway)throw new ApiError(400,'Take Away tidak tersedia untuk pesanan online');
  if(d.orderType==='DELIVERY'&&!outlet.customerOrderAllowDelivery)throw new ApiError(400,'Delivery tidak tersedia untuk pesanan online');
  const scheduledAt=validatePublicSchedule(d,outlet);
  const existing=await prisma.sale.findUnique({where:{customerOrderRequestId:d.customerOrderRequestId},include:{items:{include:{addons:true}},outlet:true}});
  if(existing){
    if(existing.businessId!==business.id||existing.outletId!==outlet.id)throw new ApiError(409,'Request order sudah digunakan');
    return res.status(200).json({id:existing.id,orderNumber:existing.orderNumber,publicOrderToken:existing.publicOrderToken,status:existing.status,grandTotal:existing.grandTotal,outlet:{name:existing.outlet.name,code:existing.outlet.code}});
  }
  const fakeReq={user:{businessId:business.id,id:'CUSTOMER_WEB'}};
  const totals=await buildOrderTotals(fakeReq,{outletId:outlet.id,customerName:d.customerName,orderType:d.orderType,items:d.items} as any);
  const orderNumber=await nextNumber('ORD',outlet.id,'orderNumber');
  const publicOrderToken=crypto.randomBytes(24).toString('hex');
  const created=await prisma.$transaction(async tx=>tx.sale.create({data:{businessId:business.id,orderNumber,outletId:outlet.id,customerName:d.customerName,customerPhone:d.customerPhone.trim(),tableNumber:d.orderType==='DINE_IN'?d.tableNumber?.trim()||null:null,orderNote:d.orderNote?.trim()||null,orderType:d.orderType,orderSource:'CUSTOMER_WEB',customerOrderRequestId:d.customerOrderRequestId,publicOrderToken,isPreOrder:d.isPreOrder,scheduledAt,submittedAt:new Date(),subtotal:totals.gross,discountAmount:money(totals.productDiscount+totals.transactionDiscount+totals.couponDiscount),totalAmount:totals.grand,subtotalBeforeDiscount:totals.gross,productDiscountTotal:totals.productDiscount,transactionDiscountAmount:totals.transactionDiscount,couponCode:totals.couponResult?.coupon.couponCode,couponDiscountAmount:totals.couponDiscount,grandTotal:totals.grand,totalHpp:totals.totalHpp,grossProfit:0,status:'OPEN_ORDER',items:{create:totals.lines.map(saleItemCreate)}},include:{items:{include:{addons:true}},outlet:true}}));
  res.status(201).json({id:created.id,orderNumber:created.orderNumber,publicOrderToken:created.publicOrderToken,status:created.status,grandTotal:created.grandTotal,outlet:{name:created.outlet.name,code:created.outlet.code}});
  void sendCustomerWebOrderPush(created).catch(error=>console.error('Customer web order push failed',error));
}));

api.use(auth);
const pushDeviceBody=z.object({
  token:z.string().trim().min(20).max(4096),
  outletId:z.string().trim().min(1),
  platform:z.literal('ANDROID').default('ANDROID'),
  deviceName:z.string().trim().max(120).optional()
});
api.post('/push-devices',asyncRoute(async(req,res)=>{
  const d=pushDeviceBody.parse(req.body);
  await assertTenantOutlet(req,d.outletId);
  const device=await prisma.pushDevice.upsert({
    where:{token:d.token},
    create:{token:d.token,platform:d.platform,deviceName:d.deviceName,userId:req.user!.id,businessId:req.user!.businessId,outletId:d.outletId},
    update:{platform:d.platform,deviceName:d.deviceName,userId:req.user!.id,businessId:req.user!.businessId,outletId:d.outletId,isActive:true,lastSeenAt:new Date()}
  });
  res.status(201).json({id:device.id,registered:true});
}));
api.delete('/push-devices/current',asyncRoute(async(req,res)=>{
  const token=z.object({token:z.string().trim().min(20).max(4096)}).parse(req.body).token;
  await prisma.pushDevice.updateMany({where:{token,userId:req.user!.id,businessId:req.user!.businessId},data:{isActive:false}});
  res.json({ok:true});
}));
function tenantWhere(req:any){return tenantScope(req as any);}
function tenantWhereAnd(req:any,...clauses:any[]){return tenantAnd(req as any,...clauses);}
async function assertTenantOutlet(req:any,outletId:string){
  assertOutlet(req,outletId);
  const businessId=req.user?.businessId;
  if(!businessId)throw new ApiError(403,'Business tidak valid');
  const outlet=await prisma.outlet.findFirst({where:{id:outletId,businessId,status:'ACTIVE'}});
  if(!outlet)throw new ApiError(403,'Outlet tidak diizinkan');
  return outlet;
}
async function assertTenantProduct(req:any,productId:string){
  const product=await prisma.product.findFirst({where:tenantWhereAnd(req,{id:productId})});
  if(!product)throw new ApiError(404,'Produk tidak ditemukan');
  return product;
}
async function assertTenantCoupon(req:any,couponId:string){
  const coupon=await prisma.coupon.findFirst({where:tenantWhereAnd(req,{id:couponId})});
  if(!coupon)throw new ApiError(404,'Kupon tidak ditemukan');
  return coupon;
}
async function assertTenantCategory(req:any,id:string){
  const category=await prisma.category.findFirst({where:tenantWhereAnd(req,{id})});
  if(!category)throw new ApiError(404,'Kategori tidak ditemukan');
  return category;
}
async function assertTenantVariantGroup(req:any,id:string){
  const group=await prisma.variantGroup.findFirst({where:tenantWhereAnd(req,{id})});
  if(!group)throw new ApiError(404,'Variant group tidak ditemukan');
  return group;
}
async function assertTenantVariantOption(req:any,id:string){
  const option=await prisma.variantOption.findFirst({where:{id,group:tenantWhere(req)}});
  if(!option)throw new ApiError(404,'Variant option tidak ditemukan');
  return option;
}
async function assertTenantProductVariant(req:any,id:string){
  const variant=await prisma.productVariant.findFirst({where:{id,product:tenantWhere(req)}});
  if(!variant)throw new ApiError(404,'Variant produk tidak ditemukan');
  return variant;
}
async function assertTenantPrinter(req:any,id:string){
  const printer=await prisma.printer.findFirst({where:tenantWhereAnd(req,{id})});
  if(!printer)throw new ApiError(404,'Printer tidak ditemukan');
  return printer;
}
const userSelect={id:true,name:true,username:true,role:true,status:true,lastLogin:true,createdAt:true,updatedAt:true,inventoryPermissions:true,assignedWarehouseId:true,assignedWarehouse:true,outlets:{where:{status:'ACTIVE' as const},include:{outlet:true},orderBy:{outlet:{name:'asc' as const}}}};
const userBase=z.object({
  name:z.string().min(2),
  username:z.string().min(3),
  password:z.string().min(8).optional(),
  confirmPassword:z.string().optional(),
  pin:z.string().regex(/^\d+$/,'PIN hanya boleh angka').optional().or(z.literal('')),
  role:z.enum(['OWNER','SUPERVISOR','CASHIER']),
  status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),
  outletIds:z.array(z.string()).default([]),
  inventoryPermissions:z.array(z.string()).default([]),
  assignedWarehouseId:z.string().nullable().optional()
});
const userBody=userBase.refine(d=>!d.password||d.password===d.confirmPassword,{message:'Password dan confirm password harus sama'})
  .refine(d=>d.role==='OWNER'||d.outletIds.length>0,{message:'Supervisor dan kasir minimal harus punya 1 outlet'})
  .refine(d=>d.role!=='CASHIER'||d.outletIds.length<=1,{message:'Kasir hanya boleh diassign ke 1 outlet'});
const createUserBody=userBody.refine(d=>!!d.password,{message:'Password wajib diisi'});
const updateUserBody=userBase.partial().refine(d=>!d.password||d.password===d.confirmPassword,{message:'Password dan confirm password harus sama'});
async function assertNotLastOwner(req:any,userId:string,next?:{role?:string,status?:string}){
  const user=await prisma.user.findFirst({where:{id:userId,memberships:{some:{businessId:req.user!.businessId}}},include:{outlets:true,memberships:{where:{businessId:req.user!.businessId}}}});
  if(!user)throw new ApiError(404,'User tidak ditemukan');
  const currentMembership=user.memberships[0];
  const currentRole=currentMembership?.role??user.role;
  const currentStatus=currentMembership?.status??user.status;
  const willRemainOwner=(next?.role??currentRole)==='OWNER'&&(next?.status??currentStatus)==='ACTIVE';
  if(willRemainOwner)return user;
  if(currentRole==='OWNER'&&currentStatus==='ACTIVE'){
    const owners=await prisma.businessMembership.count({where:{businessId:req.user!.businessId,role:'OWNER',status:'ACTIVE',userId:{not:userId},user:{status:'ACTIVE'}}});
    if(owners<1)throw new ApiError(400,'Tidak boleh menonaktifkan atau menghapus OWNER terakhir.');
  }
  return user;
}
async function syncUserOutlets(tx:any,userId:string,role:string,outletIds:string[]){
  if(role==='OWNER'){await tx.userOutlet.deleteMany({where:{userId}});return;}
  await tx.userOutlet.deleteMany({where:{userId,outletId:{notIn:outletIds}}});
  for(const outletId of outletIds)await tx.userOutlet.upsert({where:{userId_outletId:{userId,outletId}},update:{status:'ACTIVE'},create:{userId,outletId,status:'ACTIVE'}});
}
async function validateTenantOutletIds(req:any,outletIds:string[]){
  const ids=[...new Set(outletIds)];
  if(!ids.length)return;
  for(const outletId of ids)await assertTenantOutlet(req,outletId);
}
async function validateUserWarehouse(role:string,outletIds:string[],assignedWarehouseId?:string|null,businessId?:string){
  if(role!=='CASHIER')return null;
  if(!assignedWarehouseId)return null;
  const wh=await prisma.inventoryWarehouse.findUnique({where:{id:assignedWarehouseId}});
  if(!wh||wh.status!=='ACTIVE')throw new ApiError(400,'Warehouse tidak ditemukan atau tidak aktif');
  if(wh.businessId&&businessId&&wh.businessId!==businessId)throw new ApiError(400,'Warehouse tidak ditemukan atau tidak aktif');
  if(wh.outletId&&!outletIds.includes(wh.outletId))throw new ApiError(400,'Warehouse kasir harus sesuai outlet yang diassign');
  return wh.id;
}
async function keepValidUserWarehouse(role:string,outletIds:string[],assignedWarehouseId?:string|null,businessId?:string){
  if(role!=='CASHIER'||!assignedWarehouseId)return null;
  const wh=await prisma.inventoryWarehouse.findUnique({where:{id:assignedWarehouseId}});
  if(!wh||wh.status!=='ACTIVE')return null;
  if(wh.businessId&&businessId&&wh.businessId!==businessId)return null;
  if(wh.outletId&&!outletIds.includes(wh.outletId))return null;
  return wh.id;
}
api.get('/users',allow('OWNER'),asyncRoute(async(req,res)=>{
  const where:any={memberships:{some:{businessId:req.user!.businessId}}};
  if(req.query.role)where.role=String(req.query.role);
  if(req.query.status)where.status=String(req.query.status);
  if(req.query.q){const q=String(req.query.q);where.OR=[{name:{contains:q,mode:'insensitive'}},{username:{contains:q,mode:'insensitive'}}];}
  if(req.query.outlet_id)where.outlets={some:{outletId:String(req.query.outlet_id),status:'ACTIVE'}};
  res.json(await prisma.user.findMany({where,select:userSelect,orderBy:{createdAt:'desc'}}));
}));
api.post('/users',allow('OWNER'),asyncRoute(async(req,res)=>{
  const d=createUserBody.parse(req.body);
  if(await prisma.user.findUnique({where:{username:d.username}}))throw new ApiError(409,'Username sudah digunakan');
  await validateTenantOutletIds(req,d.outletIds);
  const assignedWarehouseId=await validateUserWarehouse(d.role,d.outletIds,d.assignedWarehouseId,req.user!.businessId);
  const passwordHash=await bcrypt.hash(d.password!,10);
  const pinHash=d.pin?await bcrypt.hash(d.pin,10):undefined;
  const created=await prisma.$transaction(async tx=>{
    const inventoryPermissions=d.role==='OWNER'||d.role==='SUPERVISOR'?defaultInventoryPermissions(d.role):d.inventoryPermissions;
    const user=await tx.user.create({data:{name:d.name,username:d.username,passwordHash,pinHash,role:d.role,status:d.status,inventoryPermissions,assignedWarehouseId}});
    await tx.businessMembership.create({data:{businessId:req.user!.businessId,userId:user.id,role:d.role,status:d.status}});
    await syncUserOutlets(tx,user.id,d.role,d.outletIds);
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'USER',entityId:user.id,action:'USER_CREATED',oldValue:Prisma.JsonNull,newValue:{name:d.name,username:d.username,role:d.role,status:d.status,outletIds:d.outletIds,inventoryPermissions,assignedWarehouseId},changedBy:req.user!.id}});
    return tx.user.findUnique({where:{id:user.id},select:userSelect});
  });
  res.status(201).json(created);
}));
api.get('/users/:id',allow('OWNER'),asyncRoute(async(req,res)=>{
  const user=await prisma.user.findFirst({where:{id:String(req.params.id),memberships:{some:{businessId:req.user!.businessId}}},select:userSelect});
  if(!user)throw new ApiError(404,'User tidak ditemukan');
  res.json(user);
}));
api.put('/users/:id',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const d=updateUserBody.parse(req.body);
  const existing=await assertNotLastOwner(req,id,{role:d.role,status:d.status});
  if(d.username&&d.username!==existing.username&&await prisma.user.findUnique({where:{username:d.username}}))throw new ApiError(409,'Username sudah digunakan');
  const nextRole=d.role||existing.role;
  const nextOutletIds=d.outletIds||existing.outlets?.map((x:any)=>x.outletId)||[];
  if((nextRole==='SUPERVISOR'||nextRole==='CASHIER')&&nextOutletIds.length<1)throw new ApiError(400,'Supervisor dan kasir minimal harus punya 1 outlet');
  if(nextRole==='CASHIER'&&nextOutletIds.length>1)throw new ApiError(400,'Kasir hanya boleh diassign ke 1 outlet');
  await validateTenantOutletIds(req,nextOutletIds);
  const nextAssignedWarehouseId=d.assignedWarehouseId!==undefined
    ? await validateUserWarehouse(nextRole,nextOutletIds,d.assignedWarehouseId,req.user!.businessId)
    : await keepValidUserWarehouse(nextRole,nextOutletIds,existing.assignedWarehouseId,req.user!.businessId);
  const data:any={name:d.name,username:d.username,role:d.role,status:d.status,assignedWarehouseId:nextRole==='CASHIER'?nextAssignedWarehouseId:null};
  if(d.password)data.passwordHash=await bcrypt.hash(d.password,10);
  if(d.pin)data.pinHash=await bcrypt.hash(d.pin,10);
  if(d.inventoryPermissions)data.inventoryPermissions=(nextRole==='OWNER'||nextRole==='SUPERVISOR')?defaultInventoryPermissions(nextRole):d.inventoryPermissions;
  const updated=await prisma.$transaction(async tx=>{
    const user=await tx.user.update({where:{id},data});
    if(d.role||d.status)await tx.businessMembership.upsert({where:{businessId_userId:{businessId:req.user!.businessId,userId:id}},update:{role:d.role||user.role,status:d.status||user.status},create:{businessId:req.user!.businessId,userId:id,role:d.role||user.role,status:d.status||user.status}});
    if(d.outletIds||d.role)await syncUserOutlets(tx,id,d.role||user.role,nextOutletIds);
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'USER',entityId:id,action:'USER_UPDATED',oldValue:{name:existing.name,username:existing.username,role:existing.role,status:existing.status,inventoryPermissions:existing.inventoryPermissions,assignedWarehouseId:existing.assignedWarehouseId},newValue:{...data,outletIds:d.outletIds},changedBy:req.user!.id}});
    return tx.user.findUnique({where:{id},select:userSelect});
  });
  res.json(updated);
}));
api.delete('/users/:id',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const existing=await assertNotLastOwner(req,id,{status:'INACTIVE'});
  const updated=await prisma.$transaction(async tx=>{
    const user=await tx.user.update({where:{id},data:{status:'INACTIVE'},select:userSelect});
    await tx.businessMembership.updateMany({where:{userId:id,businessId:req.user!.businessId},data:{status:'INACTIVE'}});
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'USER',entityId:id,action:'USER_SOFT_DELETED',oldValue:{status:existing.status},newValue:{status:'INACTIVE'},changedBy:req.user!.id}});
    return user;
  });
  res.json(updated);
}));
api.post('/users/:id/reset-password',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const d=z.object({password:z.string().min(8),confirmPassword:z.string()}).refine(x=>x.password===x.confirmPassword,{message:'Password dan confirm password harus sama'}).parse(req.body);
  const user=await prisma.user.findFirst({where:{id,memberships:{some:{businessId:req.user!.businessId}}}});
  if(!user)throw new ApiError(404,'User tidak ditemukan');
  await prisma.user.update({where:{id},data:{passwordHash:await bcrypt.hash(d.password,10)}});
  await prisma.auditLog.create({data:{businessId:req.user!.businessId,entityType:'USER',entityId:id,action:'USER_PASSWORD_RESET',oldValue:Prisma.JsonNull,newValue:{reset:true},changedBy:req.user!.id}});
  res.json({ok:true});
}));
api.get('/users/:id/outlets',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.userOutlet.findMany({where:{userId:String(req.params.id),outlet:{businessId:req.user!.businessId,status:'ACTIVE'}},include:{outlet:true},orderBy:{outlet:{name:'asc'}}}))));
api.put('/users/:id/outlets',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const user=await prisma.user.findFirst({where:{id,memberships:{some:{businessId:req.user!.businessId}}}});
  if(!user)throw new ApiError(404,'User tidak ditemukan');
  const outletIds=z.object({outletIds:z.array(z.string())}).parse(req.body).outletIds;
  if(user.role!=='OWNER'&&outletIds.length<1)throw new ApiError(400,'Supervisor dan kasir minimal harus punya 1 outlet');
  if(user.role==='CASHIER'&&outletIds.length>1)throw new ApiError(400,'Kasir hanya boleh diassign ke 1 outlet');
  await validateTenantOutletIds(req,outletIds);
  const assignedWarehouseId=await keepValidUserWarehouse(user.role,outletIds,user.assignedWarehouseId,req.user!.businessId);
  const rows=await prisma.$transaction(async tx=>{await syncUserOutlets(tx,id,user.role,outletIds);if(user.role==='CASHIER'&&assignedWarehouseId!==user.assignedWarehouseId)await tx.user.update({where:{id},data:{assignedWarehouseId}});await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'USER',entityId:id,action:'USER_OUTLETS_UPDATED',oldValue:Prisma.JsonNull,newValue:{outletIds,assignedWarehouseId},changedBy:req.user!.id}});return tx.userOutlet.findMany({where:{userId:id},include:{outlet:true},orderBy:{outlet:{name:'asc'}}});});
  res.json(rows);
}));
const outletPrintSettingsSchema={
  autoPrintReceipt:z.coerce.boolean().optional(),
  autoPrintKitchen:z.coerce.boolean().optional(),
  autoPrintCustomerItemList:z.coerce.boolean().optional()
};
const outletCustomerOrderingSchema={
  customerOrderingEnabled:z.coerce.boolean().optional(),
  customerOrderingSlug:z.string().trim().min(2).nullable().optional(),
  acceptingCustomerOrders:z.coerce.boolean().optional(),
  customerOrderAllowDineIn:z.coerce.boolean().optional(),
  customerOrderAllowTakeAway:z.coerce.boolean().optional(),
  customerOrderAllowDelivery:z.coerce.boolean().optional(),
  customerOrderRequestPhone:z.coerce.boolean().optional(),
  customerOrderSoundEnabled:z.coerce.boolean().optional(),
  preOrderEnabled:z.coerce.boolean().optional(),
  preOrderMinLeadMinutes:z.coerce.number().int().min(0).max(1440).optional(),
  preOrderMaxDaysAhead:z.coerce.number().int().min(0).max(365).optional(),
  preOrderSlotMinutes:z.coerce.number().int().min(5).max(240).optional(),
  customerOrderOpenTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  customerOrderCloseTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  customerOrderOperatingDays:z.array(z.number().int().min(0).max(6)).optional(),
  timezone:z.string().trim().min(3).max(80).optional()
};
const outletWarehouseBody=z.object({inventoryWarehouseId:z.string().nullable().optional(),blockSaleWhenIngredientOutOfStock:z.coerce.boolean().optional(),allowSaleWithoutRecipe:z.coerce.boolean().optional(),...outletPrintSettingsSchema});
api.get('/outlets',asyncRoute(async(req,res)=>res.json(await prisma.outlet.findMany({where:req.user!.role==='OWNER'?tenantWhere(req):tenantWhereAnd(req,{id:{in:req.user!.outletIds}}),include:outletInclude,orderBy:{name:'asc'}}))));
api.post('/outlets',allow('OWNER'),asyncRoute(async(req,res)=>{
  const d=z.object({code:z.string().min(2),name:z.string().min(2),address:z.string().optional(),phone:z.string().optional(),inventoryWarehouseId:z.string().nullable().optional(),blockSaleWhenIngredientOutOfStock:z.coerce.boolean().optional(),allowSaleWithoutRecipe:z.coerce.boolean().optional(),...outletPrintSettingsSchema,...outletCustomerOrderingSchema}).parse(req.body);
  if(d.inventoryWarehouseId)await assertWarehouseAccess(req,d.inventoryWarehouseId);
  res.status(201).json(await prisma.outlet.create({data:{...d,businessId:req.user!.businessId},include:outletInclude}));
}));
api.put('/outlets/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantOutlet(req,id);const d=z.object({code:z.string().min(2).optional(),name:z.string().min(2).optional(),address:z.string().nullable().optional(),phone:z.string().nullable().optional(),inventoryWarehouseId:z.string().nullable().optional(),blockSaleWhenIngredientOutOfStock:z.coerce.boolean().optional(),allowSaleWithoutRecipe:z.coerce.boolean().optional(),...outletCustomerOrderingSchema,...outletPrintSettingsSchema,status:z.enum(['ACTIVE','INACTIVE']).optional()}).parse(req.body);if(d.inventoryWarehouseId)await assertWarehouseAccess(req,d.inventoryWarehouseId);res.json(await prisma.outlet.update({where:{id},data:d,include:outletInclude}));}));
api.put('/outlets/:id/inventory-warehouse',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  await assertTenantOutlet(req,id);
  const d=outletWarehouseBody.parse(req.body);
  if(d.inventoryWarehouseId){
    await assertWarehouseAccess(req,d.inventoryWarehouseId);
  }
  res.json(await prisma.outlet.update({where:{id},data:d,include:outletInclude}));
}));
api.delete('/outlets/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantOutlet(req,id);res.json(await prisma.outlet.update({where:{id},data:{status:'INACTIVE'}}));}));

const printerBody=z.object({outletId:z.string(),printerName:z.string().min(2),printerType:z.enum(['THERMAL']).default('THERMAL'),connectionType:z.enum(['BLUETOOTH','USB','NETWORK','BROWSER']),paperSize:z.enum(['MM58','MM80']).default('MM58'),ipAddress:z.string().nullable().optional(),port:z.coerce.number().int().positive().nullable().optional(),bluetoothAddress:z.string().nullable().optional(),usbVendorId:z.string().nullable().optional(),usbProductId:z.string().nullable().optional(),isCustomerReceipt:z.coerce.boolean().default(false),isKitchenPrinter:z.coerce.boolean().default(false),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
api.get('/printers',allow('OWNER','SUPERVISOR','CASHIER'),asyncRoute(async(req,res)=>{const where:any=tenantWhere(req);if(req.query.outlet_id){await assertTenantOutlet(req,String(req.query.outlet_id));where.outletId=String(req.query.outlet_id);}else if(req.user!.role!=='OWNER')where.outletId={in:req.user!.outletIds};res.json(await prisma.printer.findMany({where,include:{outlet:true},orderBy:{createdAt:'desc'}}));}));
api.post('/printers',allow('OWNER'),asyncRoute(async(req,res)=>{const d=printerBody.parse(req.body);await assertTenantOutlet(req,d.outletId);res.status(201).json(await prisma.printer.create({data:{...d,businessId:req.user!.businessId},include:{outlet:true}}));}));
api.put('/printers/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const d=printerBody.partial().parse(req.body);const existing=await assertTenantPrinter(req,String(req.params.id));await assertTenantOutlet(req,d.outletId||existing.outletId);res.json(await prisma.printer.update({where:{id:existing.id},data:d,include:{outlet:true}}));}));
api.delete('/printers/:id',allow('OWNER'),asyncRoute(async(req,res)=>{await assertTenantPrinter(req,String(req.params.id));res.json(await prisma.printer.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}));}));

const categoryBody=z.object({name:z.string().trim().min(2),description:z.string().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const categoryUpdateBody=categoryBody.partial();
const categoryReorderBody=z.object({
  categories:z.array(z.object({id:z.string().min(1),sortOrder:z.coerce.number().int().nonnegative()})).min(1)
});
api.get('/categories',asyncRoute(async(req,res)=>res.json(await prisma.category.findMany({where:tenantWhere(req),orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/categories',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const d=categoryBody.parse(req.body);
  const max=await prisma.category.aggregate({where:tenantWhere(req),_max:{sortOrder:true}});
  const sortOrder=(max._max.sortOrder??-10)+10;
  res.status(201).json(await prisma.category.create({data:{...d,sortOrder,businessId:req.user!.businessId}}));
}));
api.put('/categories/reorder',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const d=categoryReorderBody.parse(req.body);
  const ids=d.categories.map(category=>category.id);
  if(new Set(ids).size!==ids.length)throw new ApiError(400,'Kategori duplikat dalam urutan.');
  const existing=await prisma.category.findMany({where:tenantWhereAnd(req,{id:{in:ids}}),select:{id:true}});
  if(existing.length!==ids.length)throw new ApiError(403,'Kategori tidak diizinkan.');
  const sortOrders=d.categories.map(category=>category.sortOrder);
  if(new Set(sortOrders).size!==sortOrders.length)throw new ApiError(400,'Urutan kategori harus unik.');
  const updated=await prisma.$transaction(async tx=>{
    for(const category of d.categories){
      await tx.category.update({where:{id:category.id},data:{sortOrder:category.sortOrder}});
    }
    return tx.category.findMany({where:tenantWhere(req),orderBy:[{sortOrder:'asc'},{name:'asc'}]});
  });
  res.json(updated);
}));
api.put('/categories/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantCategory(req,id);res.json(await prisma.category.update({where:{id},data:categoryUpdateBody.parse(req.body)}));}));
api.delete('/categories/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantCategory(req,id);res.json(await prisma.category.update({where:{id},data:{status:'INACTIVE'}}));}));

const variantGroupBase=z.object({name:z.string().min(2),description:z.string().nullable().optional(),minSelect:z.coerce.number().int().min(0).default(0),maxSelect:z.coerce.number().int().min(1).default(1),required:z.coerce.boolean().default(false),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),options:z.array(z.object({name:z.string().min(1),additionalPrice:z.coerce.number().nonnegative().default(0),hpp:z.coerce.number().nonnegative().default(0),sortOrder:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')})).optional()});
const variantGroupBody=variantGroupBase.refine(d=>d.maxSelect>=d.minSelect,{message:'Maksimal pilihan harus >= minimal pilihan'});
api.get('/variant-groups',asyncRoute(async(req,res)=>res.json(await prisma.variantGroup.findMany({where:tenantWhere(req),include:{options:{orderBy:{sortOrder:'asc'}}},orderBy:{name:'asc'}}))));
api.post('/variant-groups',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const d=variantGroupBody.parse(req.body);const {options,...data}=d;res.status(201).json(await prisma.variantGroup.create({data:{...data,businessId:req.user!.businessId,options:{create:options||[]}},include:{options:true}}));}));
api.put('/variant-groups/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantVariantGroup(req,id);res.json(await prisma.variantGroup.update({where:{id},data:variantGroupBase.omit({options:true}).partial().parse(req.body),include:{options:{orderBy:{sortOrder:'asc'}}}}));}));
api.delete('/variant-groups/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantVariantGroup(req,id);res.json(await prisma.variantGroup.update({where:{id},data:{status:'INACTIVE'}}));}));
api.post('/variant-groups/:id/options',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantVariantGroup(req,id);res.status(201).json(await prisma.variantOption.create({data:{variantGroupId:id,...z.object({name:z.string().min(1),additionalPrice:z.coerce.number().nonnegative().default(0),hpp:z.coerce.number().nonnegative().default(0),sortOrder:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')}).parse(req.body)}}));}));
api.put('/variant-options/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantVariantOption(req,id);res.json(await prisma.variantOption.update({where:{id},data:z.object({name:z.string().min(1).optional(),additionalPrice:z.coerce.number().nonnegative().optional(),hpp:z.coerce.number().nonnegative().optional(),sortOrder:z.coerce.number().int().optional(),status:z.enum(['ACTIVE','INACTIVE']).optional()}).parse(req.body)}));}));
api.delete('/variant-options/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantVariantOption(req,id);res.json(await prisma.variantOption.update({where:{id},data:{status:'INACTIVE'}}));}));

const onlineChannels=['GOFOOD','GRABFOOD','SHOPEEFOOD'] as const;
const orderChannels=['DINE_IN','TAKE_AWAY',...onlineChannels] as const;
const onlineChannelSchema=z.enum(onlineChannels);
const orderChannelSchema=z.enum(orderChannels);
const outletPricingInput=z.object({outletId:z.string(),isAvailable:z.coerce.boolean().default(true),isRecommended:z.coerce.boolean().default(false),outletPrice:z.coerce.number().nonnegative().nullable().optional(),outletHpp:z.coerce.number().nonnegative().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const channelPricingInput=z.object({outletId:z.string(),channel:onlineChannelSchema,price:z.coerce.number().nonnegative().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const productImageUrlSchema=z.string().trim().optional().nullable().refine(value=>!value||value===''||/^https?:\/\//i.test(value)||value.startsWith('/storage/products/'),{message:'Image URL tidak valid'});
const productInput=z.object({sku:z.string().trim().optional().nullable(),name:z.string().min(2),categoryId:z.string().optional(),category:z.string().optional(),description:z.string().optional(),imageUrl:productImageUrlSchema,basePrice:z.coerce.number().nonnegative().optional(),baseHpp:z.coerce.number().nonnegative().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),variantGroupIds:z.array(z.string()).default([]),outletIds:z.array(z.string()).default([]),outletPricing:z.array(outletPricingInput).optional(),channelPricing:z.array(channelPricingInput).optional(),variants:z.array(z.object({variantName:z.string(),sellingPrice:z.coerce.number().nonnegative(),hpp:z.coerce.number().nonnegative()})).optional()});
const maxProductImageUploadBytes=12*1024*1024;
const maxProductImageOutputBytes=500*1024;
async function readRawRequest(req:any,maxBytes:number){
  const chunks:Buffer[]=[];let total=0;
  for await (const chunk of req){
    const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    total+=buf.length;
    if(total>maxBytes)throw new ApiError(413,'Ukuran foto maksimal 12MB.');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
function multipartBoundary(req:any){
  const contentType=String(req.headers['content-type']||'');
  const match=contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1]||match?.[2]||'';
}
function parseMultipartImage(body:Buffer,boundary:string){
  const marker=Buffer.from(`--${boundary}`);
  let offset=body.indexOf(marker);
  while(offset!==-1){
    const next=body.indexOf(marker,offset+marker.length);
    if(next===-1)break;
    const part=body.subarray(offset+marker.length,next);
    const headerEnd=part.indexOf(Buffer.from('\r\n\r\n'));
    if(headerEnd!==-1){
      const header=part.subarray(0,headerEnd).toString('utf8');
      if(/name="image"/i.test(header)&&/filename="/i.test(header)){
        const mime=header.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim()||'application/octet-stream';
        let file=part.subarray(headerEnd+4);
        if(file.subarray(0,2).toString()==='\r\n')file=file.subarray(2);
        if(file.subarray(-2).toString()==='\r\n')file=file.subarray(0,-2);
        return {mime,buffer:file};
      }
    }
    offset=next;
  }
  return null;
}
async function compressProductImage(input:Buffer){
  const metadata=await sharp(input,{failOn:'error'}).metadata();
  if(!metadata.format||!['jpeg','jpg','png','webp'].includes(metadata.format))throw new ApiError(400,'Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.');
  for(const size of [1600,1200,1000,800,640]){
    for(const quality of [82,74,66,58,50]){
      const output=await sharp(input).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality}).toBuffer();
      if(output.length<=maxProductImageOutputBytes){
        const outMeta=await sharp(output).metadata();
        return {buffer:output,size:output.length,width:outMeta.width||0,height:outMeta.height||0};
      }
    }
  }
  throw new ApiError(400,'Gambar terlalu besar dan tidak dapat dikompresi. Silakan pilih gambar lain.');
}
const recipeInclude={item:{include:{unit:true,category:true}},usageUnit:true};
const productInclude={categoryRef:true,variants:true,addons:true,recipes:{include:recipeInclude,orderBy:{createdAt:'asc' as const}},outlets:{include:{outlet:true},orderBy:{outlet:{name:'asc' as const}}},channelPrices:{include:{outlet:true},orderBy:[{outlet:{name:'asc' as const}},{channel:'asc' as const}]},variantGroups:{orderBy:{sortOrder:'asc' as const},include:{group:{include:{options:{orderBy:{sortOrder:'asc' as const},include:{outlets:{include:{outlet:true}}}}}}}}};
const recipeRowInput=z.object({inventoryItemId:z.string(),usageQty:z.coerce.number().positive(),usageUnitId:z.string(),wastePercent:z.coerce.number().min(0).max(100).default(0),isActive:z.coerce.boolean().default(true)});
const recipeBody=z.object({items:z.array(recipeRowInput)}).or(recipeRowInput);
function recipeRows(body:unknown){const parsed=recipeBody.parse(body);return 'items' in parsed?parsed.items:[parsed];}
async function assertProduct(req:any,productId:string){return assertTenantProduct(req,productId);}
async function validateRecipeRows(req:any,rows:ReturnType<typeof recipeRows>){
  const itemIds=[...new Set(rows.map(r=>r.inventoryItemId))],unitIds=[...new Set(rows.map(r=>r.usageUnitId))];
  const [items,units]=await Promise.all([prisma.inventoryItem.findMany({where:tenantWhereAnd(req,{id:{in:itemIds},status:'ACTIVE'})}),prisma.inventoryUnit.findMany({where:tenantWhereAnd(req,{id:{in:unitIds},status:'ACTIVE'})})]);
  const foundItems=new Set(items.map(x=>x.id)),foundUnits=new Set(units.map(x=>x.id));
  const duplicate=itemIds.length!==rows.length;
  if(duplicate)throw new ApiError(400,'Bahan baku recipe tidak boleh duplikat');
  for(const row of rows){if(!foundItems.has(row.inventoryItemId))throw new ApiError(400,'Bahan baku recipe tidak ditemukan atau inactive');if(!foundUnits.has(row.usageUnitId))throw new ApiError(400,'Satuan recipe tidak ditemukan atau inactive');}
}
function normalizedUnit(name?:string){return String(name||'').trim().toLowerCase();}
function unitRatio(from?:string,to?:string){
  const a=normalizedUnit(from),b=normalizedUnit(to);
  if(!a||!b||a===b)return 1;
  const map=new Map<string,number>([['kg:gram',1000],['kilogram:gram',1000],['gram:kg',0.001],['gram:kilogram',0.001],['liter:ml',1000],['l:ml',1000],['ml:liter',0.001],['ml:l',0.001]]);
  return map.get(`${a}:${b}`) ?? null;
}
async function inventoryUnitRatio(tx:any,itemId:string,fromUnitId:string,toUnitId:string,fromName?:string,toName?:string){
  if(fromUnitId===toUnitId)return 1;
  const conversion=await tx.inventoryUnitConversion.findUnique({where:{inventoryItemId_fromUnitId_toUnitId:{inventoryItemId:itemId,fromUnitId,toUnitId}}});
  if(conversion)return Number(conversion.multiplier);
  return unitRatio(fromName,toName);
}
function recipeRequiredQty(recipe:any,soldQty=1){
  return Number(recipe.usageQty) * (1 + Number(recipe.wastePercent||0)/100) * soldQty;
}
async function productAvailabilityForOutlet(productId:string,outlet:any){
  const recipes=await prisma.productRecipe.findMany({where:{productId,isActive:true},include:{item:{include:{unit:true}},usageUnit:true},orderBy:{createdAt:'asc'}});
  const warehouse=outlet.defaultInventoryWarehouse;
  if(!recipes.length)return {outlet,warehouse:null,canProduce:null,status:'RECIPE_MISSING',items:[]};
  if(!warehouse)return {outlet,warehouse:null,canProduce:null,status:'WAREHOUSE_NOT_CONFIGURED',items:recipes.map(r=>({recipeId:r.id,item:r.item,requiredQty:recipeRequiredQty(r),availableQty:0,status:'WAREHOUSE_NOT_CONFIGURED'}))};
  const stocks=await prisma.inventoryStock.findMany({where:{warehouseId:warehouse.id,inventoryItemId:{in:recipes.map(r=>r.inventoryItemId)}},include:{item:{include:{unit:true}}}});
  const byItem=new Map(stocks.map(s=>[s.inventoryItemId,s]));
  const items=await Promise.all(recipes.map(async recipe=>{
    const stock=byItem.get(recipe.inventoryItemId),ratio=await inventoryUnitRatio(prisma,recipe.inventoryItemId,recipe.usageUnitId,recipe.item.unitId,recipe.usageUnit.name,recipe.item.unit.name);
    const requiredRecipeUnit=recipeRequiredQty(recipe);
    const requiredStockUnit=ratio==null?null:requiredRecipeUnit*ratio;
    const availableQty=Number(stock?.availableQty ?? stock?.currentQty ?? 0);
    const canProduce=requiredStockUnit&&requiredStockUnit>0?Math.floor(availableQty/requiredStockUnit):0;
    const status=ratio==null?'UNIT_CONVERSION_MISSING':availableQty<=0?'OUT_OF_STOCK':availableQty<Number(requiredStockUnit)?'OUT_OF_STOCK':canProduce<=5?'LOW_STOCK':'AVAILABLE';
    return {recipeId:recipe.id,item:recipe.item,usageQty:Number(recipe.usageQty),usageUnit:recipe.usageUnit,wastePercent:Number(recipe.wastePercent),requiredQty:requiredRecipeUnit,requiredStockUnit,availableQty,canProduce,status};
  }));
  const canProduce=items.some(i=>i.status==='UNIT_CONVERSION_MISSING')?null:Math.min(...items.map(i=>i.canProduce));
  const status=items.some(i=>i.status==='UNIT_CONVERSION_MISSING')?'UNIT_CONVERSION_MISSING':items.some(i=>i.status==='OUT_OF_STOCK')?'OUT_OF_STOCK':(canProduce??0)<=5?'LOW_STOCK':'AVAILABLE';
  return {outlet,warehouse,canProduce,status,items};
}
async function categoryName(req:any,categoryId?:string,category?:string){if(categoryId){const c=await prisma.category.findFirst({where:tenantWhereAnd(req,{id:categoryId})});if(!c)throw new ApiError(400,'Kategori tidak ditemukan');return c.name;} if(category)return category; throw new ApiError(400,'Kategori wajib diisi');}
api.get('/products',asyncRoute(async(req,res)=>{
  const outletId=String(req.query.outletId||'');
  if(outletId)await assertTenantOutlet(req,outletId);
  const categoryId=String(req.query.categoryId||''),status=String(req.query.status||''),availability=String(req.query.availability||''),search=String(req.query.search||'').trim();
  const filters:any[]=[];
  if(outletId)filters.push({outlets:{some:{outletId,isActive:true}}});
  if(categoryId)filters.push({categoryId});
  if(status)filters.push({status});
  if(outletId&&availability==='AVAILABLE')filters.push({outlets:{some:{outletId,isAvailable:true,isActive:true,status:'ACTIVE'}}});
  if(outletId&&availability==='SOLD_OUT')filters.push({outlets:{some:{outletId,isActive:true,isAvailable:false}}});
  if(search)filters.push({OR:[{name:{contains:search,mode:'insensitive'}},{sku:{contains:search,mode:'insensitive'}},{description:{contains:search,mode:'insensitive'}},{categoryRef:{name:{contains:search,mode:'insensitive'}}}]});
  res.json(await prisma.product.findMany({where:tenantWhereAnd(req,...filters),include:productInclude,orderBy:{name:'asc'}}));
}));
api.post('/products/images',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const businessId=req.user?.businessId;
  if(!businessId)throw new ApiError(403,'Business tidak valid');
  const boundary=multipartBoundary(req);
  if(!boundary)throw new ApiError(400,'Gunakan multipart/form-data.');
  const raw=await readRawRequest(req,maxProductImageUploadBytes);
  const file=parseMultipartImage(raw,boundary);
  if(!file||!file.buffer.length)throw new ApiError(400,'File foto produk wajib diupload.');
  if(!file.mime.toLowerCase().startsWith('image/'))throw new ApiError(400,'File harus berupa gambar.');
  const image=await compressProductImage(file.buffer);
  const dir=path.join(storageRoot,'products',businessId);
  await fs.mkdir(dir,{recursive:true});
  const filename=`prd_${crypto.randomUUID()}.webp`;
  await fs.writeFile(path.join(dir,filename),image.buffer);
  res.status(201).json({imageUrl:`/storage/products/${businessId}/${filename}`,size:image.size,width:image.width,height:image.height});
}));
const productImportHeaders=['SKU','Product Name','Description','Category','Image URL','Status','Base Price','Base HPP','Variant Groups','Outlet','Available','Outlet Status','Outlet Price','Outlet HPP','GoFood Price','GrabFood Price','ShopeeFood Price'];
function csvCell(v:any){const s=String(v??'');return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function toCsv(rows:any[][]){return rows.map(r=>r.map(csvCell).join(',')).join('\n');}
function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(q){if(c==='"'&&n==='"'){cell+='"';i++;}else if(c==='"')q=false;else cell+=c;}else{if(c==='"')q=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(c!=='\r')cell+=c;}}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;}
function parseExcelBase64(content:string){const clean=content.includes(',')?content.split(',').pop()!:content;const buffer=Buffer.from(clean,'base64');let workbook:XLSX.WorkBook;try{workbook=XLSX.read(buffer,{type:'buffer',cellDates:false});}catch{throw new ApiError(400,'File Excel tidak bisa dibaca. Gunakan format .xls, .xlsx, atau CSV template.');}const firstSheet=workbook.SheetNames[0];if(!firstSheet)throw new ApiError(400,'File Excel kosong');const sheet=workbook.Sheets[firstSheet];if(!sheet)throw new ApiError(400,'Sheet Excel tidak ditemukan');const rows=XLSX.utils.sheet_to_json<any[]>(sheet,{header:1,defval:'',raw:false,blankrows:false});return rows.map(row=>row.map(cell=>String(cell??'').trim())).filter(row=>row.some(cell=>cell));}
function parseProductImportRows(filename:string|undefined,content:string,encoding?:'text'|'base64'){const lower=String(filename||'').toLowerCase();if(encoding==='base64'||lower.endsWith('.xls')||lower.endsWith('.xlsx'))return parseExcelBase64(content);return parseCsv(content);}
function normHeader(s:string){return s.trim().toLowerCase().replace(/[^a-z0-9]+/g,'');}
function parseMoneyInput(v:any){const raw=String(v??'').trim();if(!raw)return 0;let s=raw.replace(/\s/g,'');if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');else if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');else if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);if(!Number.isFinite(n)||n<0)throw new Error(`Invalid price: ${raw}`);return n;}
function parseStatusInput(v:any){const s=String(v??'ACTIVE').trim().toUpperCase();if(['ACTIVE','TRUE','YES','Y','1'].includes(s))return 'ACTIVE' as const;if(['INACTIVE','FALSE','NO','N','0'].includes(s))return 'INACTIVE' as const;throw new Error(`Invalid status: ${v}`);}
function parseBoolInput(v:any){const s=String(v??'TRUE').trim().toUpperCase();if(['TRUE','YES','Y','1','ACTIVE'].includes(s))return true;if(['FALSE','NO','N','0','INACTIVE'].includes(s))return false;throw new Error(`Invalid boolean: ${v}`);}
function pick(row:Record<string,string>,names:string[]){for(const n of names){const v=row[normHeader(n)];if(v!==undefined)return v;}return '';}
function skuBaseFromName(name:string){const base=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24);return base||'PRODUCT';}
function generateImportSku(name:string,rowNumber:number,used:Set<string>){const base=skuBaseFromName(name);let sku=`${base}-${String(rowNumber).padStart(3,'0')}`,i=2;while(used.has(sku.toLowerCase()))sku=`${base}-${String(rowNumber).padStart(3,'0')}-${i++}`;used.add(sku.toLowerCase());return sku;}
async function validateProductImportRows(req:any,text:string,mode='UPSERT',filename?:string,encoding?:'text'|'base64'){
  const parsed=parseProductImportRows(filename,text,encoding); if(parsed.length<2)throw new ApiError(400,'File import kosong');
  const headers=parsed[0]!.map(normHeader), rows=parsed.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
  let [categories,outlets,groups,existing]=await Promise.all([
    prisma.category.findMany({where:tenantWhere(req)}),
    prisma.outlet.findMany({where:tenantWhere(req)}),
    prisma.variantGroup.findMany({where:tenantWhere(req)}),
    prisma.product.findMany({where:tenantWhere(req),select:{id:true,sku:true,name:true}})
  ]);
  const existingCategoryNames=new Set(categories.map(c=>c.name.trim().toLowerCase()));
  const categoryNames=[...new Map(rows.map(r=>(pick(r,['Category','Kategori']).trim()||'Lainnya')).filter(Boolean).map(name=>[name.toLowerCase(),name])).values()];
  const missingCategoryNames=categoryNames.filter(name=>!existingCategoryNames.has(name.toLowerCase()));
  if(missingCategoryNames.length){
    await prisma.category.createMany({data:missingCategoryNames.map(name=>({name,status:'ACTIVE',businessId:req.user!.businessId})),skipDuplicates:true});
    categories=await prisma.category.findMany({where:tenantWhere(req)});
  }
  const catByName=new Map(categories.map(c=>[c.name.trim().toLowerCase(),c]));
  const outletByName=new Map(outlets.flatMap(o=>[[o.name.trim().toLowerCase(),o],[o.code.trim().toLowerCase(),o]]));
  const groupByName=new Map(groups.map(g=>[g.name.trim().toLowerCase(),g]));
  const existingBySku=new Map(existing.filter(p=>p.sku).map(p=>[p.sku!.trim().toLowerCase(),p]));
  const usedAutoSkus=new Set(existingBySku.keys());
  const autoSkuByProductName=new Map<string,string>();
  const seen=new Set<string>(), grouped=new Map<string,any>();
  const preview=rows.map((r,idx)=>{
    const errors:string[]=[];
    const rawSku=pick(r,['SKU','Product Code','Product SKU']).trim();
    const name=pick(r,['Product Name','Name','Produk']).trim();
    const category=pick(r,['Category','Kategori']).trim()||'Lainnya';
    const outletName=pick(r,['Outlet','Outlet Name']).trim();
    if(!name)errors.push('Product Name wajib diisi');
    let sku=rawSku;
    if(!sku&&name){
      const nameKey=name.toLowerCase();
      sku=autoSkuByProductName.get(nameKey)||generateImportSku(name,idx+2,usedAutoSkus);
      autoSkuByProductName.set(nameKey,sku);
    }
    const categoryRow=category?catByName.get(category.toLowerCase()):undefined;
    if(category&&!categoryRow)errors.push(`Category not found: ${category}`);
    const outlet=outletName?outletByName.get(outletName.toLowerCase()):undefined;
    if(outletName&&!outlet)errors.push(`Outlet not found: ${outletName}`);
    let status:'ACTIVE'|'INACTIVE'='ACTIVE', outletStatus:'ACTIVE'|'INACTIVE'='ACTIVE', available=true, basePrice=0, baseHpp=0, outletPrice:null|number=null, outletHpp:null|number=null, gofoodPrice:null|number=null, grabfoodPrice:null|number=null, shopeefoodPrice:null|number=null;
    try{status=parseStatusInput(pick(r,['Status'])||'ACTIVE');}catch(e){errors.push((e as Error).message);}
    try{outletStatus=parseStatusInput(pick(r,['Outlet Status'])||'ACTIVE');}catch(e){errors.push((e as Error).message);}
    try{available=parseBoolInput(pick(r,['Available'])||'TRUE');}catch(e){errors.push((e as Error).message);}
    try{basePrice=parseMoneyInput(pick(r,['Base Price','Base Selling Price']));}catch(e){errors.push((e as Error).message);}
    try{baseHpp=parseMoneyInput(pick(r,['Base HPP','Base Cost']));}catch(e){errors.push((e as Error).message);}
    try{const v=pick(r,['Outlet Price']);outletPrice=v.trim()?parseMoneyInput(v):null;}catch(e){errors.push((e as Error).message);}
    try{const v=pick(r,['Outlet HPP']);outletHpp=v.trim()?parseMoneyInput(v):null;}catch(e){errors.push((e as Error).message);}
    try{const v=pick(r,['GoFood Price','GOFOOD Price','Go Food Price']);gofoodPrice=v.trim()?parseMoneyInput(v):null;}catch(e){errors.push((e as Error).message);}
    try{const v=pick(r,['GrabFood Price','GRABFOOD Price','Grab Food Price']);grabfoodPrice=v.trim()?parseMoneyInput(v):null;}catch(e){errors.push((e as Error).message);}
    try{const v=pick(r,['ShopeeFood Price','SHOPEEFOOD Price','Shopee Food Price']);shopeefoodPrice=v.trim()?parseMoneyInput(v):null;}catch(e){errors.push((e as Error).message);}
    const variantGroupNames=(pick(r,['Variant Groups','Variant Group'])||'').split('|').map(x=>x.trim()).filter(Boolean);
    const variantGroupIds:string[]=[];
    for(const g of variantGroupNames){const found=groupByName.get(g.toLowerCase());if(!found)errors.push(`Variant group not found: ${g}`);else variantGroupIds.push(found.id);}
    if(sku){
      const key=sku.toLowerCase();
      const seenKey=`${key}|${outletName.toLowerCase()}`;
      if(seen.has(seenKey))errors.push('Duplicate SKU + Outlet inside file');
      seen.add(seenKey);
      const exists=existingBySku.get(key);
      if(mode==='INSERT_ONLY'&&exists)errors.push('Duplicate SKU database');
      if(mode==='UPDATE_ONLY'&&!exists)errors.push('SKU tidak ditemukan untuk update');
      if(!grouped.has(key))grouped.set(key,{sku,name,description:pick(r,['Description','Deskripsi']),categoryId:categoryRow?.id,category:categoryRow?.name,imageUrl:pick(r,['Image URL','Image']),status,basePrice,baseHpp,variantGroupIds,outletPricing:[],channelPricing:[]});
      const product=grouped.get(key);
      if(outlet){
        product.outletPricing.push({outletId:outlet.id,isAvailable:available,status:outletStatus,outletPrice,outletHpp});
        const channelRows=[['GOFOOD',gofoodPrice],['GRABFOOD',grabfoodPrice],['SHOPEEFOOD',shopeefoodPrice]] as const;
        for(const [channel,price] of channelRows)product.channelPricing.push({outletId:outlet.id,channel,price,status:price==null?'INACTIVE':'ACTIVE'});
      }
    }
    return {row:idx+2,sku,product:name,status:errors.length?'ERROR':'OK',message:errors.join('; ')};
  });
  return {preview,products:[...grouped.values()],summary:{totalRows:rows.length,success:preview.filter(x=>x.status==='OK').length,error:preview.filter(x=>x.status==='ERROR').length}};
}
api.get('/products/import-template',allow('OWNER','SUPERVISOR'),asyncRoute(async(_req,res)=>{res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="foru-product-import-template.csv"');res.send(toCsv([productImportHeaders,['AMB001','American Breakfast','Menu breakfast','American Breakfast','','ACTIVE','18000','9000','Size|Sugar','FORU HUIS','TRUE','ACTIVE','20000','10000','23000','24000','23500']]));}));
api.get('/products/export',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const ids=String(req.query.ids||'').split(',').map(x=>x.trim()).filter(Boolean);const products=await prisma.product.findMany({where:tenantWhereAnd(req,ids.length?{id:{in:ids}}:{}),include:productInclude,orderBy:{name:'asc'}});const rows:any[][]=[productImportHeaders];for(const p of products){const groups=p.variantGroups.map(x=>x.group.name).join('|');const base:any[]=[p.sku||'',p.name,p.description||'',p.categoryRef?.name||p.category,p.imageUrl||'',p.status,Number(p.basePrice),Number(p.baseHpp),groups];if(p.outlets.length){for(const po of p.outlets){const prices=new Map((p.channelPrices||[]).filter(cp=>cp.outletId===po.outletId).map(cp=>[cp.channel,cp.price]));rows.push([...base,po.outlet.name,po.isAvailable?'TRUE':'FALSE',po.status,po.outletPrice??'',po.outletHpp??'',prices.get('GOFOOD')??'',prices.get('GRABFOOD')??'',prices.get('SHOPEEFOOD')??'']);}}else rows.push([...base,'','','','','','','','']);}res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="foru-products-export.csv"');res.send(toCsv(rows));}));
api.post('/products/import',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const d=z.object({filename:z.string().optional(),mode:z.enum(['INSERT_ONLY','UPDATE_ONLY','UPSERT']).default('UPSERT'),preview:z.coerce.boolean().default(true),content:z.string().min(1),encoding:z.enum(['text','base64']).default('text')}).parse(req.body);
  const validated=await validateProductImportRows(req,d.content,d.mode,d.filename,d.encoding);
  if(d.preview)return res.json(validated);
  let imported=0,updated=0,failed=0;
  const results=[] as any[];
  for(const p of validated.products){
    const rowErrors=validated.preview.filter(x=>x.sku===p.sku&&x.status==='ERROR');
    if(rowErrors.length){
      failed++;
      results.push({sku:p.sku,status:'ERROR',message:rowErrors.map(x=>x.message).join('; ')});
      continue;
    }
    try{
      await prisma.$transaction(async tx=>{
        const existing=p.sku?await tx.product.findFirst({where:tenantWhereAnd(req,{sku:p.sku})}):null;
        if(existing){
          if(d.mode==='INSERT_ONLY')throw new Error('Duplicate SKU database');
          if(p.variantGroupIds){
            await tx.productVariantGroup.deleteMany({where:{productId:existing.id}});
            await tx.productVariantGroup.createMany({data:p.variantGroupIds.map((variantGroupId:string,i:number)=>({productId:existing.id,variantGroupId,sortOrder:i})),skipDuplicates:true});
          }
          for(const x of p.outletPricing)await tx.productOutlet.upsert({where:{productId_outletId:{productId:existing.id,outletId:x.outletId}},update:{isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice,outletHpp:x.outletHpp},create:{productId:existing.id,outletId:x.outletId,isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice,outletHpp:x.outletHpp}});
          for(const x of p.channelPricing||[]){
            if(x.price==null||x.status==='INACTIVE')await tx.productChannelPrice.deleteMany({where:{productId:existing.id,outletId:x.outletId,channel:x.channel}});
            else await tx.productChannelPrice.upsert({where:{productId_outletId_channel:{productId:existing.id,outletId:x.outletId,channel:x.channel}},update:{price:x.price,status:x.status},create:{productId:existing.id,outletId:x.outletId,channel:x.channel,price:x.price,status:x.status}});
          }
          const updatedProduct=await tx.product.update({where:{id:existing.id},data:{name:p.name,category:p.category,categoryId:p.categoryId,description:p.description||null,imageUrl:p.imageUrl||null,basePrice:p.basePrice,baseHpp:p.baseHpp,status:p.status}});
          const baseVariant=await tx.productVariant.findFirst({where:{productId:existing.id,variantName:'Base'}});
          if(baseVariant)await tx.productVariant.update({where:{id:baseVariant.id},data:{sellingPrice:p.basePrice,hpp:p.baseHpp}});
          else await tx.productVariant.create({data:{productId:existing.id,variantName:'Base',sellingPrice:p.basePrice,hpp:p.baseHpp}});
          updated++;
          return updatedProduct;
        }
        if(d.mode==='UPDATE_ONLY')throw new Error('SKU tidak ditemukan untuk update');
        const channelRows=(p.channelPricing||[]).filter((x:any)=>x.price!=null&&x.status==='ACTIVE');
        await tx.product.create({data:{businessId:req.user!.businessId,sku:p.sku,name:p.name,category:p.category,categoryId:p.categoryId,description:p.description||null,imageUrl:p.imageUrl||null,basePrice:p.basePrice,baseHpp:p.baseHpp,status:p.status,variants:{create:{variantName:'Base',sellingPrice:p.basePrice,hpp:p.baseHpp}},variantGroups:{create:p.variantGroupIds.map((variantGroupId:string,i:number)=>({variantGroupId,sortOrder:i}))},outlets:{create:p.outletPricing.map((x:any)=>({outletId:x.outletId,isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice,outletHpp:x.outletHpp}))},channelPrices:{create:channelRows.map((x:any)=>({outletId:x.outletId,channel:x.channel,price:x.price,status:x.status}))}}});
        imported++;
      });
      results.push({sku:p.sku,status:'OK'});
    }catch(e){
      failed++;
      results.push({sku:p.sku,status:'ERROR',message:(e as Error).message});
    }
  }
  await prisma.auditLog.create({data:{businessId:req.user!.businessId,entityType:'PRODUCT_IMPORT',entityId:`import-${Date.now()}`,action:'PRODUCT_IMPORT',oldValue:Prisma.JsonNull,newValue:{filename:d.filename,imported,updated,failed,total:validated.products.length},changedBy:req.user!.id}});
  res.json({summary:{imported,updated,failed,total:validated.products.length},results});
}));
api.get('/pos/products',asyncRoute(async(req,res)=>{ const outletId=String(req.query.outlet_id||''); await assertTenantOutlet(req,outletId); const channel=String(req.query.channel||req.query.orderType||'DINE_IN').toUpperCase(); const onlineChannel=onlineChannels.includes(channel as any)?channel as typeof onlineChannels[number]:undefined; const products=await prisma.product.findMany({where:tenantWhereAnd(req,{status:'ACTIVE',OR:[{categoryId:null},{categoryRef:{status:'ACTIVE'}}],outlets:{some:{outletId,isActive:true,status:'ACTIVE'}}}),include:{categoryRef:true,outlets:{where:{outletId,isActive:true}},channelPrices:onlineChannel?{where:{outletId,channel:onlineChannel,status:'ACTIVE'}}:false,variants:{where:{status:'ACTIVE'}},addons:{where:{status:'ACTIVE'}},variantGroups:{orderBy:{sortOrder:'asc'},include:{group:{include:{options:{where:{status:'ACTIVE'},orderBy:{sortOrder:'asc'},include:{outlets:{where:{outletId}}}}}}}}},orderBy:[{categoryRef:{sortOrder:'asc'}},{name:'asc'}]});res.json(products.map(p=>{const po=p.outlets[0];const dineInPrice=po?.outletPrice??p.basePrice;const cp=(p as any).channelPrices?.[0];const activePrice=cp?.price??dineInPrice;return {...p,isAvailable:!!po&&po.isAvailable&&po.isActive&&po.status==='ACTIVE',basePrice:activePrice,baseHpp:po?.outletHpp??p.baseHpp,masterBasePrice:p.basePrice,masterBaseHpp:p.baseHpp,dineInPrice,channelPrice:cp?.price??null,priceChannel:onlineChannel||'DINE_IN',priceSource:cp?'CHANNEL':(po?.outletPrice!=null?'OUTLET':'BASE'),variantGroups:p.variantGroups.map(vg=>({...vg,group:{...vg.group,options:vg.group.options.filter(o=>!o.outlets[0]||o.outlets[0].status==='ACTIVE').map(o=>({...o,additionalPrice:o.outlets[0]?.additionalPrice??o.additionalPrice,hpp:o.outlets[0]?.hpp??o.hpp,masterAdditionalPrice:o.additionalPrice,masterHpp:o.hpp}))}}))};})); }));

api.get('/menu-availability',allow('OWNER','SUPERVISOR','CASHIER'),asyncRoute(async(req,res)=>{
  const outletId=String(req.query.outletId||'');
  await assertTenantOutlet(req,outletId);
  const rows=await prisma.productOutlet.findMany({where:{outletId,isActive:true,status:'ACTIVE',product:{businessId:req.user!.businessId,status:'ACTIVE'}},include:{product:{include:{categoryRef:true}}},orderBy:{product:{name:'asc'}}});
  res.json(rows.map(row=>({productId:row.productId,name:row.product.name,sku:row.product.sku,category:row.product.categoryRef?.name||row.product.category||'Tanpa Kategori',imageUrl:row.product.imageUrl,isAvailable:row.isAvailable})));
}));
api.patch('/menu-availability',allow('OWNER','SUPERVISOR','CASHIER'),asyncRoute(async(req,res)=>{
  const d=z.object({outletId:z.string(),productId:z.string(),isAvailable:z.boolean()}).parse(req.body);
  await assertTenantOutlet(req,d.outletId);
  await assertTenantProduct(req,d.productId);
  const existing=await prisma.productOutlet.findFirst({where:{outletId:d.outletId,productId:d.productId,status:'ACTIVE',outlet:{businessId:req.user!.businessId},product:{businessId:req.user!.businessId}}});
  if(!existing)throw new ApiError(404,'Produk tidak terdaftar aktif di outlet ini');
  const updated=await prisma.$transaction(async tx=>{
    const row=await tx.productOutlet.update({where:{productId_outletId:{productId:d.productId,outletId:d.outletId}},data:{isAvailable:d.isAvailable,isActive:true}});
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'PRODUCT_OUTLET',entityId:`${d.productId}:${d.outletId}`,action:'MENU_AVAILABILITY_UPDATED',oldValue:{isAvailable:existing.isAvailable},newValue:{isAvailable:d.isAvailable,outletId:d.outletId,productId:d.productId},changedBy:req.user!.id}});
    return row;
  });
  res.json({productId:updated.productId,outletId:updated.outletId,isAvailable:updated.isAvailable});
}));
api.post('/products',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const d=productInput.parse(req.body);
  const category=await categoryName(req,d.categoryId,d.category);
  const basePrice=d.basePrice??d.variants?.[0]?.sellingPrice??0,baseHpp=d.baseHpp??d.variants?.[0]?.hpp??0;
  for(const variantGroupId of d.variantGroupIds)await assertTenantVariantGroup(req,variantGroupId);
  let outletRows=(d.outletPricing??d.outletIds.map(outletId=>({outletId,isAvailable:true,isRecommended:false,status:'ACTIVE' as const,outletPrice:null,outletHpp:null}))).map(x=>({...x,isRecommended:x.isRecommended??false,outletPrice:x.outletPrice??null,outletHpp:x.outletHpp??null}));
  for(const row of outletRows)await assertTenantOutlet(req,row.outletId);
  if(!outletRows.length){
    const outlets=await prisma.outlet.findMany({where:tenantWhereAnd(req,{status:'ACTIVE'}),select:{id:true}});
    outletRows=outlets.map(o=>({outletId:o.id,isAvailable:true,isRecommended:false,status:'ACTIVE' as const,outletPrice:null,outletHpp:null}));
  }
  const channelRows=(d.channelPricing||[]).filter(x=>x.price!=null&&x.status==='ACTIVE');
  for(const row of channelRows)await assertTenantOutlet(req,row.outletId);
  res.status(201).json(await prisma.product.create({data:{businessId:req.user!.businessId,sku:d.sku?.trim()||null,name:d.name,category,categoryId:d.categoryId,description:d.description,imageUrl:d.imageUrl||null,basePrice,baseHpp,status:d.status,variants:{create:d.variants?.length?d.variants:[{variantName:'Base',sellingPrice:basePrice,hpp:baseHpp}]},variantGroups:{create:d.variantGroupIds.map((variantGroupId,i)=>({variantGroupId,sortOrder:i}))},outlets:{create:outletRows.map(x=>({outletId:x.outletId,isAvailable:x.isAvailable,isRecommended:x.isRecommended,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice,outletHpp:x.outletHpp}))},channelPrices:{create:channelRows.map(x=>({outletId:x.outletId,channel:x.channel,price:x.price!,status:x.status}))}},include:productInclude}));
}));
api.put('/products/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const d=productInput.partial().parse(req.body);
  const id=String(req.params.id);
  const category=d.categoryId||d.category?await categoryName(req,d.categoryId,d.category):undefined;
  if(d.variantGroupIds)for(const variantGroupId of d.variantGroupIds)await assertTenantVariantGroup(req,variantGroupId);
  if(d.outletIds)for(const outletId of d.outletIds)await assertTenantOutlet(req,outletId);
  if(d.outletPricing)for(const row of d.outletPricing)await assertTenantOutlet(req,row.outletId);
  if(d.channelPricing)for(const row of d.channelPricing)await assertTenantOutlet(req,row.outletId);
  res.json(await prisma.$transaction(async tx=>{
    const current=await tx.product.findFirst({where:tenantWhereAnd(req,{id}),include:{outlets:true}});
    if(!current)throw new ApiError(404,'Produk tidak ditemukan');
    const oldBasePrice=Number(current.basePrice),oldBaseHpp=Number(current.baseHpp);
    if(d.variantGroupIds){await tx.productVariantGroup.deleteMany({where:{productId:id}});await tx.productVariantGroup.createMany({data:d.variantGroupIds.map((variantGroupId,i)=>({productId:id,variantGroupId,sortOrder:i})),skipDuplicates:true});}
    if(d.outletPricing){
      for(const x of d.outletPricing){
        const existing=current.outlets.find(o=>o.outletId===x.outletId);
        const rawPrice=x.outletPrice??null,rawHpp=x.outletHpp??null;
        const outletPrice=rawPrice!==null&&d.basePrice!==undefined&&Number(rawPrice)===oldBasePrice?d.basePrice:rawPrice;
        const outletHpp=rawHpp!==null&&d.baseHpp!==undefined&&Number(rawHpp)===oldBaseHpp?d.baseHpp:rawHpp;
        await tx.productOutlet.upsert({where:{productId_outletId:{productId:id,outletId:x.outletId}},update:{isAvailable:x.isAvailable,isRecommended:x.isRecommended,isActive:x.isAvailable,status:x.status,outletPrice,outletHpp},create:{productId:id,outletId:x.outletId,isAvailable:x.isAvailable,isRecommended:x.isRecommended,isActive:x.isAvailable,status:x.status,outletPrice,outletHpp}});
      }
    }else if(d.outletIds){await tx.productOutlet.deleteMany({where:{productId:id}});await tx.productOutlet.createMany({data:d.outletIds.map(outletId=>({productId:id,outletId,isAvailable:true,isActive:true,status:'ACTIVE'})),skipDuplicates:true});}
    if(d.channelPricing){
      for(const x of d.channelPricing){
        if(x.price==null||x.status==='INACTIVE') await tx.productChannelPrice.deleteMany({where:{productId:id,outletId:x.outletId,channel:x.channel}});
        else await tx.productChannelPrice.upsert({where:{productId_outletId_channel:{productId:id,outletId:x.outletId,channel:x.channel}},update:{price:x.price,status:x.status},create:{productId:id,outletId:x.outletId,channel:x.channel,price:x.price,status:x.status}});
      }
    }
    const updated=await tx.product.update({where:{id},data:{sku:d.sku===undefined?undefined:(d.sku?.trim()||null),name:d.name,category,categoryId:d.categoryId,description:d.description,imageUrl:d.imageUrl===undefined?undefined:(d.imageUrl||null),basePrice:d.basePrice,baseHpp:d.baseHpp,status:d.status},include:productInclude});
    if(d.basePrice!==undefined||d.baseHpp!==undefined){
      const baseVariant=updated.variants.find(v=>v.variantName==='Base');
      if(baseVariant)await tx.productVariant.update({where:{id:baseVariant.id},data:{sellingPrice:d.basePrice??baseVariant.sellingPrice,hpp:d.baseHpp??baseVariant.hpp}});
    }
    return tx.product.findUniqueOrThrow({where:{id},include:productInclude});
  }));
}));
api.delete('/products/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const id=String(req.params.id);await assertTenantProduct(req,id);res.json(await prisma.product.update({where:{id},data:{status:'INACTIVE'}}));}));
api.delete('/products/:id/permanent',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  await assertTenantProduct(req,id);
  const [saleItems,addonSaleItems,inventoryMovements]=await Promise.all([
    prisma.saleItem.count({where:{productId:id}}),
    prisma.saleItemAddon.count({where:{addon:{productId:id}}}),
    prisma.inventoryMovement.count({where:{productId:id}})
  ]);
  if(saleItems||addonSaleItems||inventoryMovements)throw new ApiError(409,'Produk sudah memiliki histori transaksi atau inventory. Nonaktifkan produk, tidak bisa hapus permanen.');
  await prisma.$transaction(async tx=>{
    await tx.bundleItem.deleteMany({where:{variant:{productId:id}}});
    await tx.productChannelPrice.deleteMany({where:{productId:id}});
    await tx.productRecipe.deleteMany({where:{productId:id}});
    await tx.productVariantGroup.deleteMany({where:{productId:id}});
    await tx.couponProduct.deleteMany({where:{productId:id}});
    await tx.productOutlet.deleteMany({where:{productId:id}});
    await tx.productAddon.deleteMany({where:{productId:id}});
    await tx.productVariant.deleteMany({where:{productId:id}});
    await tx.product.delete({where:{id}});
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'PRODUCT',entityId:id,action:'PRODUCT_PERMANENT_DELETED',oldValue:Prisma.JsonNull,newValue:Prisma.JsonNull,changedBy:req.user!.id}});
  });
  res.json({message:'Produk berhasil dihapus permanen.'});
}));
api.get('/products/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const productId=String(req.params.id);await assertTenantProduct(req,productId);const [outlets,rows]=await Promise.all([prisma.outlet.findMany({where:tenantWhere(req),orderBy:{name:'asc'}}),prisma.productOutlet.findMany({where:{productId,outlet:tenantWhere(req)},include:{outlet:true}})]);res.json(outlets.map(outlet=>rows.find(r=>r.outletId===outlet.id)||{productId,outletId:outlet.id,outlet,isAvailable:false,isRecommended:false,isActive:false,outletPrice:null,outletHpp:null,status:'INACTIVE'}));}));
api.put('/products/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const productId=String(req.params.id);await assertTenantProduct(req,productId);const rows=z.object({outlets:z.array(outletPricingInput)}).parse(req.body).outlets;for(const x of rows)await assertTenantOutlet(req,x.outletId);res.json(await prisma.$transaction(async tx=>{for(const x of rows)await tx.productOutlet.upsert({where:{productId_outletId:{productId,outletId:x.outletId}},update:{isAvailable:x.isAvailable,isRecommended:x.isRecommended,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice??null,outletHpp:x.outletHpp??null},create:{productId,outletId:x.outletId,isAvailable:x.isAvailable,isRecommended:x.isRecommended,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice??null,outletHpp:x.outletHpp??null}});return tx.productOutlet.findMany({where:{productId,outlet:tenantWhere(req)},include:{outlet:true},orderBy:{outlet:{name:'asc'}}});}));}));
api.get('/products/:id/recipe',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const productId=String(req.params.id);await assertProduct(req,productId);res.json(await prisma.productRecipe.findMany({where:{productId},include:recipeInclude,orderBy:{createdAt:'asc'}}));}));
api.post('/products/:id/recipe',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const productId=String(req.params.id);
  await assertProduct(req,productId);
  const rows=recipeRows(req.body);
  if(!rows.length)throw new ApiError(400,'Recipe minimal memiliki 1 bahan baku');
  await validateRecipeRows(req,rows);
  const created=await prisma.$transaction(async tx=>{
    const result=[];
    for(const row of rows){
      result.push(await tx.productRecipe.upsert({
        where:{productId_inventoryItemId:{productId,inventoryItemId:row.inventoryItemId}},
        update:{usageQty:row.usageQty,usageUnitId:row.usageUnitId,wastePercent:row.wastePercent,isActive:row.isActive},
        create:{productId,inventoryItemId:row.inventoryItemId,usageQty:row.usageQty,usageUnitId:row.usageUnitId,wastePercent:row.wastePercent,isActive:row.isActive},
        include:recipeInclude
      }));
    }
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'PRODUCT',entityId:productId,action:'PRODUCT_RECIPE_UPDATED',oldValue:Prisma.JsonNull,newValue:{items:rows},changedBy:req.user!.id}});
    return result;
  });
  res.status(201).json(created);
}));
api.put('/products/:id/recipe',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const productId=String(req.params.id);
  await assertProduct(req,productId);
  const rows=recipeRows(req.body);
  await validateRecipeRows(req,rows);
  const recipes=await prisma.$transaction(async tx=>{
    const oldValue=await tx.productRecipe.findMany({where:{productId}});
    await tx.productRecipe.deleteMany({where:{productId}});
    await tx.productRecipe.createMany({data:rows.map(row=>({productId,inventoryItemId:row.inventoryItemId,usageQty:row.usageQty,usageUnitId:row.usageUnitId,wastePercent:row.wastePercent,isActive:row.isActive}))});
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'PRODUCT',entityId:productId,action:'PRODUCT_RECIPE_REPLACED',oldValue,newValue:{items:rows},changedBy:req.user!.id}});
    return tx.productRecipe.findMany({where:{productId},include:recipeInclude,orderBy:{createdAt:'asc'}});
  });
  res.json(recipes);
}));
api.delete('/products/:id/recipe/:recipeId',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const productId=String(req.params.id);
  const recipeId=String(req.params.recipeId);
  await assertProduct(req,productId);
  const existing=await prisma.productRecipe.findFirst({where:{id:recipeId,productId}});
  if(!existing)throw new ApiError(404,'Recipe tidak ditemukan');
  const updated=await prisma.$transaction(async tx=>{
    const row=await tx.productRecipe.update({where:{id:recipeId},data:{isActive:false},include:recipeInclude});
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'PRODUCT',entityId:productId,action:'PRODUCT_RECIPE_DISABLED',oldValue:existing,newValue:row,changedBy:req.user!.id}});
    return row;
  });
  res.json(updated);
}));
api.get('/products/:id/inventory-availability',allow('OWNER','SUPERVISOR','CASHIER'),asyncRoute(async(req,res)=>{
  const productId=String(req.params.id);
  await assertProduct(req,productId);
  const outletId=String(req.query.outletId||req.query.outlet_id||'');
  if(!outletId)throw new ApiError(400,'outletId wajib dipilih');
  await assertTenantOutlet(req,outletId);
  const outlet=await prisma.outlet.findFirst({where:tenantWhereAnd(req,{id:outletId}),include:{defaultInventoryWarehouse:true}});
  if(!outlet)throw new ApiError(404,'Outlet tidak ditemukan');
  res.json(await productAvailabilityForOutlet(productId,outlet));
}));
api.post('/products/:id/variant-groups',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const productId=String(req.params.id);
  const d=z.object({variantGroupId:z.string(),sortOrder:z.coerce.number().int().default(0)}).parse(req.body);
  await assertTenantProduct(req,productId);
  await assertTenantVariantGroup(req,d.variantGroupId);
  res.status(201).json(await prisma.productVariantGroup.upsert({where:{productId_variantGroupId:{productId,variantGroupId:d.variantGroupId}},update:{sortOrder:d.sortOrder},create:{productId,...d}}));
}));
api.delete('/products/:id/variant-groups/:groupId',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const productId=String(req.params.id);
  const variantGroupId=String(req.params.groupId);
  await assertTenantProduct(req,productId);
  await assertTenantVariantGroup(req,variantGroupId);
  const row=await prisma.productVariantGroup.findUnique({where:{productId_variantGroupId:{productId,variantGroupId}}});
  if(!row)throw new ApiError(404,'Variant group produk tidak ditemukan');
  res.json(await prisma.productVariantGroup.delete({where:{productId_variantGroupId:{productId,variantGroupId}}}));
}));
api.post('/products/:id/variants',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const productId=String(req.params.id);
  await assertTenantProduct(req,productId);
  res.status(201).json(await prisma.productVariant.create({data:{productId,...z.object({variantName:z.string(),sellingPrice:z.coerce.number(),hpp:z.coerce.number()}).parse(req.body)}}));
}));
api.put('/variants/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  await assertTenantProductVariant(req,id);
  res.json(await prisma.productVariant.update({where:{id},data:z.object({variantName:z.string().optional(),sellingPrice:z.coerce.number().optional(),hpp:z.coerce.number().optional(),status:z.enum(['ACTIVE','INACTIVE']).optional()}).parse(req.body)}));
}));
api.delete('/variants/:id',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  await assertTenantProductVariant(req,id);
  res.json(await prisma.productVariant.update({where:{id},data:{status:'INACTIVE'}}));
}));
const variantOptionOutletInput=z.object({outletId:z.string(),additionalPrice:z.coerce.number().nonnegative().nullable().optional(),hpp:z.coerce.number().nonnegative().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
api.get('/variant-options/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const variantOptionId=String(req.params.id);await assertTenantVariantOption(req,variantOptionId);const [outlets,rows]=await Promise.all([prisma.outlet.findMany({where:tenantWhere(req),orderBy:{name:'asc'}}),prisma.variantOptionOutlet.findMany({where:{variantOptionId,outlet:tenantWhere(req)},include:{outlet:true}})]);res.json(outlets.map(outlet=>rows.find(r=>r.outletId===outlet.id)||{variantOptionId,outletId:outlet.id,outlet,additionalPrice:null,hpp:null,status:'ACTIVE'}));}));
api.put('/variant-options/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const variantOptionId=String(req.params.id);await assertTenantVariantOption(req,variantOptionId);const rows=z.object({outlets:z.array(variantOptionOutletInput)}).parse(req.body).outlets;for(const x of rows)await assertTenantOutlet(req,x.outletId);res.json(await prisma.$transaction(async tx=>{for(const x of rows)await tx.variantOptionOutlet.upsert({where:{variantOptionId_outletId:{variantOptionId,outletId:x.outletId}},update:{additionalPrice:x.additionalPrice??null,hpp:x.hpp??null,status:x.status},create:{variantOptionId,outletId:x.outletId,additionalPrice:x.additionalPrice??null,hpp:x.hpp??null,status:x.status}});return tx.variantOptionOutlet.findMany({where:{variantOptionId,outlet:tenantWhere(req)},include:{outlet:true}});}));}));

const shiftOpenBody=z.object({openingCash:z.coerce.number().nonnegative()});
const shiftCloseBody=z.object({closingCashActual:z.coerce.number().nonnegative()});
const activeShiftInclude={outlet:true,cashier:{select:{id:true,name:true}},closedBy:{select:{id:true,name:true}},expenses:{where:{status:'ACTIVE' as const},include:{categoryRef:true},orderBy:{createdAt:'desc' as const}}};
const closeShiftInclude={sales:true,expenses:{where:{status:'ACTIVE' as const},include:{categoryRef:true},orderBy:{createdAt:'asc' as const}}};
function shiftResponse(s:any){return s?{...s,shiftId:s.id,shift_id:s.id,shiftNumber:s.shiftNumber||s.id.slice(-6).toUpperCase(),shift_number:s.shiftNumber||s.id.slice(-6).toUpperCase(),openedBy:s.cashier?.name,opened_by:s.cashier?.name,openedByUserId:s.cashierId,opened_by_user_id:s.cashierId,opening_cash:s.openingCash,opened_at:s.openedAt}:null;}
function shiftNumberOf(s:any){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.openedAt)).replaceAll('-','');return `SH-${date}-${String(s.id).slice(-4).toUpperCase()}`;}
function paymentBreakdown(sales:any[]){const keys=['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER','OTHER'];const out:any=Object.fromEntries(keys.map(k=>[k,0]));for(const s of sales){const k=s.paymentMethod&&out[s.paymentMethod]!=null?s.paymentMethod:'OTHER';out[k]=money(out[k]+Number(s.grandTotal));}return out;}
function expenseSummary(expenses:any[]){const out:any={CASH_DRAWER:0,NON_CASH:0,OWNER_TRANSFER:0,totalExpense:0};for(const e of expenses){const amount=Number(e.amount);if(out[e.paymentSource]!=null)out[e.paymentSource]=money(out[e.paymentSource]+amount);out.totalExpense=money(out.totalExpense+amount);}return out;}
async function buildShiftCloseReport(id:string){
  const s:any=await prisma.cashSession.findUnique({where:{id},include:{outlet:true,cashier:{select:{id:true,name:true}},closedBy:{select:{id:true,name:true}},sales:{include:{items:{include:{addons:true}}}},expenses:{where:{status:'ACTIVE'},include:{categoryRef:true},orderBy:{createdAt:'asc'}},printerLogs:{where:{printType:'SHIFT_CLOSE_REPORT'},include:{user:{select:{name:true}},printer:true},orderBy:{printedAt:'desc'}}}});
  if(!s)throw new ApiError(404,'Laporan shift tidak ditemukan');
  const paid=s.sales.filter((x:any)=>x.status==='PAID');
  const cashSales=paid.filter((x:any)=>x.paymentMethod==='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);
  const cashRefund=0;
  const cashDrawerExpenses=s.expenses.filter((e:any)=>e.paymentSource==='CASH_DRAWER').reduce((n:number,e:any)=>n+Number(e.amount),0);
  const grossSales=paid.reduce((n:number,x:any)=>n+Number(x.subtotalBeforeDiscount||x.subtotal||0),0);
  const productDiscount=paid.reduce((n:number,x:any)=>n+Number(x.productDiscountTotal||0),0);
  const transactionDiscount=paid.reduce((n:number,x:any)=>n+Number(x.transactionDiscountAmount||0),0);
  const couponDiscount=paid.reduce((n:number,x:any)=>n+Number(x.couponDiscountAmount||0),0);
  const netSales=paid.reduce((n:number,x:any)=>n+Number(x.grandTotal||0),0);
  const totalHpp=paid.reduce((n:number,x:any)=>n+Number(x.totalHpp||0),0);
  const itemMap=new Map<string,any>();
  for(const sale of paid)for(const item of sale.items){const key=`${item.productName}__${item.variantName||'Base'}__${Number(item.finalUnitPrice||item.sellingPrice||0)}`;const old=itemMap.get(key)||{productName:item.productName,variantName:item.variantName||'Base',qty:0,grossSales:0};old.qty+=Number(item.qty);old.grossSales=money(old.grossSales+Number(item.qty)*Number(item.finalUnitPrice||item.sellingPrice||0));itemMap.set(key,old);}
  const orderSummary={totalOrder:s.sales.length,paidOrder:paid.length,pendingOrder:s.sales.filter((x:any)=>x.status==='PENDING_PAYMENT').length,cancelledOrder:s.sales.filter((x:any)=>x.status==='CANCELLED').length,voidOrder:s.sales.filter((x:any)=>x.status==='VOID').length};
  const expectedCash=money(Number(s.openingCash)+cashSales-cashDrawerExpenses-cashRefund);
  const actualCash=s.closingCashActual==null?null:money(Number(s.closingCashActual));
  const variance=actualCash==null?null:money(actualCash-expectedCash);
  return {id:s.id,shiftId:s.id,shiftNumber:shiftNumberOf(s),status:s.status,outlet:s.outlet,openedBy:s.cashier,closedBy:s.closedBy,openedAt:s.openedAt,closedAt:s.closedAt,openingCash:money(Number(s.openingCash)),cashSummary:{openingCash:money(Number(s.openingCash)),cashSales:money(cashSales),cashDrawerExpenses:money(cashDrawerExpenses),cashRefund,expectedCash,actualCash,variance},omsetSummary:{grossSales:money(grossSales),productDiscount:money(productDiscount),transactionDiscount:money(transactionDiscount),couponDiscount:money(couponDiscount),discount:money(productDiscount+transactionDiscount+couponDiscount),netSales:money(netSales),totalOmset:money(netSales),totalHpp:money(totalHpp),grossProfit:money(netSales-totalHpp)},paymentBreakdown:paymentBreakdown(paid),expenseSummary:expenseSummary(s.expenses),itemSold:[...itemMap.values()].sort((a,b)=>b.qty-a.qty),orderSummary,expenseDetails:s.expenses,printerLogs:s.printerLogs,expectedCash,closingCashActual:actualCash,variance,cashSales:money(cashSales),cashDrawerExpenses:money(cashDrawerExpenses),cashRefund};
}
async function findOutletShift(req:any,outletId:string,include:any=activeShiftInclude){
  await assertTenantOutlet(req,outletId);
  return prisma.cashSession.findFirst({where:{outletId,status:'OPEN'},include});
}
async function openOutletShift(req:any,outletId:string,openingCash:number){
  await assertTenantOutlet(req,outletId);
  const active=await prisma.cashSession.findFirst({where:{outletId,status:'OPEN'}});
  if(active)throw new ApiError(409,'Shift outlet masih aktif. Tidak perlu membuka shift baru.');
  return prisma.cashSession.create({data:{businessId:req.user!.businessId,outletId,cashierId:req.user!.id,openingCash},include:activeShiftInclude});
}
async function closeOutletShift(req:any,outletId:string,closingCashActual:number){
  const session:any=await findOutletShift(req,outletId,closeShiftInclude);
  if(!session)throw new ApiError(404,'Shift aktif outlet tidak ditemukan');
  const cashSales=session.sales.filter((s:any)=>s.status==='PAID'&&s.paymentMethod==='CASH').reduce((n:number,s:any)=>n+Number(s.grandTotal),0);
  const cashRefund=0;
  const cashDrawerExpenses=session.expenses.filter((e:any)=>e.paymentSource==='CASH_DRAWER').reduce((n:number,e:any)=>n+Number(e.amount),0);
  const expected=money(Number(session.openingCash)+cashSales-cashRefund-cashDrawerExpenses);
const updated=await prisma.cashSession.update({where:{id:session.id},data:{status:'CLOSED',closedAt:new Date(),closedByUserId:req.user!.id,expectedCash:expected,closingCashActual,variance:money(closingCashActual-expected)},include:{outlet:true,cashier:{select:{id:true,name:true}},closedBy:{select:{id:true,name:true}},expenses:{where:{status:'ACTIVE'},include:{categoryRef:true},orderBy:{createdAt:'asc'}}}});
  return buildShiftCloseReport(updated.id);
}
api.get('/outlets/:id/active-shift',asyncRoute(async(req,res)=>res.json(shiftResponse(await findOutletShift(req,String(req.params.id))))));
api.post('/outlets/:id/open-shift',asyncRoute(async(req,res)=>{const d=shiftOpenBody.parse(req.body);res.status(201).json(shiftResponse(await openOutletShift(req,String(req.params.id),d.openingCash)));}));
api.post('/outlets/:id/close-shift',asyncRoute(async(req,res)=>{const d=shiftCloseBody.parse(req.body);res.json(await closeOutletShift(req,String(req.params.id),d.closingCashActual));}));
api.post('/cash-sessions/open',asyncRoute(async(req,res)=>{ const d=z.object({outletId:z.string(),openingCash:z.coerce.number().nonnegative()}).parse(req.body);res.status(201).json(shiftResponse(await openOutletShift(req,d.outletId,d.openingCash))); }));
api.get('/cash-sessions/active',asyncRoute(async(req,res)=>{const outletId=String(req.query.outletId||req.query.outlet_id||'');if(outletId)return res.json(shiftResponse(await findOutletShift(req,outletId)));const where:any=tenantWhereAnd(req,{status:'OPEN'});if(req.user!.role!=='OWNER')where.outletId={in:req.user!.outletIds};res.json(shiftResponse(await prisma.cashSession.findFirst({where,include:activeShiftInclude,orderBy:{openedAt:'desc'}})));}));
api.get('/cash-sessions/reports',asyncRoute(async(req,res)=>{const consolidated=String(req.query.consolidated||'')==='1';if(consolidated&&req.user!.role!=='OWNER')throw new ApiError(403,'Hanya OWNER yang dapat melihat laporan konsolidasi.');const where:any=tenantWhereAnd(req,{status:'CLOSED'});if(req.query.from||req.query.to){where.closedAt={};if(req.query.from)where.closedAt.gte=new Date(String(req.query.from)+'T00:00:00.000Z');if(req.query.to)where.closedAt.lte=new Date(String(req.query.to)+'T23:59:59.999Z');}if(!consolidated)where.outletId=await requiredOutletId(req);if(req.query.cashierId)where.closedByUserId=String(req.query.cashierId);const rows=await prisma.cashSession.findMany({where,include:{outlet:true,cashier:{select:{id:true,name:true}},closedBy:{select:{id:true,name:true}},sales:true,expenses:{where:{status:'ACTIVE'}}},orderBy:{closedAt:'desc'},take:200});res.json(rows.map((s:any)=>{const paid=s.sales.filter((x:any)=>x.status==='PAID');const cash=paid.filter((x:any)=>x.paymentMethod==='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const nonCash=paid.filter((x:any)=>x.paymentMethod!=='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const expense=s.expenses.reduce((n:number,x:any)=>n+Number(x.amount),0);return {id:s.id,shiftNumber:shiftNumberOf(s),outlet:s.outlet,openedBy:s.cashier,closedBy:s.closedBy,openedAt:s.openedAt,closedAt:s.closedAt,totalOmset:money(paid.reduce((n:number,x:any)=>n+Number(x.grandTotal),0)),totalCash:money(cash),totalNonCash:money(nonCash),totalExpense:money(expense),expectedCash:money(Number(s.expectedCash||0)),actualCash:s.closingCashActual==null?null:money(Number(s.closingCashActual)),variance:s.variance==null?null:money(Number(s.variance))};}));}));
api.get('/cash-sessions/reports/consolidated',allow('OWNER'),asyncRoute(async(req,res)=>{const where:any=tenantWhereAnd(req,{status:'CLOSED'});if(req.query.from||req.query.to){where.closedAt={};if(req.query.from)where.closedAt.gte=new Date(String(req.query.from)+'T00:00:00.000Z');if(req.query.to)where.closedAt.lte=new Date(String(req.query.to)+'T23:59:59.999Z');}if(req.query.cashierId)where.closedByUserId=String(req.query.cashierId);const rows=await prisma.cashSession.findMany({where,include:{outlet:true,cashier:{select:{id:true,name:true}},closedBy:{select:{id:true,name:true}},sales:true,expenses:{where:{status:'ACTIVE'}}},orderBy:{closedAt:'desc'},take:200});res.json(rows.map((s:any)=>{const paid=s.sales.filter((x:any)=>x.status==='PAID');const cash=paid.filter((x:any)=>x.paymentMethod==='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const nonCash=paid.filter((x:any)=>x.paymentMethod!=='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const expense=s.expenses.reduce((n:number,x:any)=>n+Number(x.amount),0);return {id:s.id,shiftNumber:shiftNumberOf(s),outlet:s.outlet,openedBy:s.cashier,closedBy:s.closedBy,openedAt:s.openedAt,closedAt:s.closedAt,totalOmset:money(paid.reduce((n:number,x:any)=>n+Number(x.grandTotal),0)),totalCash:money(cash),totalNonCash:money(nonCash),totalExpense:money(expense),expectedCash:money(Number(s.expectedCash||0)),actualCash:s.closingCashActual==null?null:money(Number(s.closingCashActual)),variance:s.variance==null?null:money(Number(s.variance))};}));}));
api.get('/cash-sessions/:id/close-report',asyncRoute(async(req,res)=>{const report=await buildShiftCloseReport(String(req.params.id));await assertTenantOutlet(req,report.outlet.id);res.json(report);}));
api.post('/cash-sessions/:id/print-close-report',asyncRoute(async(req,res)=>{const report=await buildShiftCloseReport(String(req.params.id));await assertTenantOutlet(req,report.outlet.id);const d=z.object({status:z.enum(['SUCCESS','FAILED']).default('SUCCESS'),errorMessage:z.string().nullable().optional(),printerId:z.string().nullable().optional()}).parse(req.body||{});const log=await prisma.printerLog.create({data:{businessId:req.user!.businessId,outletId:report.outlet.id,cashSessionId:report.id,printerId:d.printerId||undefined,printType:'SHIFT_CLOSE_REPORT',status:d.status,errorMessage:d.errorMessage||undefined,printedBy:req.user!.id},include:{printer:true,user:{select:{name:true}}}});res.status(201).json(log);}));
async function requireActiveShift(req:any,outletId:string,cashSessionId?:string){
  await assertTenantOutlet(req,outletId);
  const active=await prisma.cashSession.findFirst({where:{outletId,status:'OPEN'}});
  if(!active)throw new ApiError(400,'Shift belum dibuka. Silakan buka kasir terlebih dahulu.');
  if(cashSessionId&&cashSessionId!==active.id&&!cashSessionId.startsWith('local_'))throw new ApiError(400,'Shift aktif tidak sesuai dengan transaksi.');
  return active;
}
api.post('/cash-sessions/:id/close',asyncRoute(async(req,res)=>{const session=await prisma.cashSession.findFirst({where:{id:String(req.params.id),status:'OPEN'},select:{outletId:true}});if(!session)throw new ApiError(404,'Shift aktif tidak ditemukan');const d=shiftCloseBody.parse(req.body);res.json(await closeOutletShift(req,session.outletId,d.closingCashActual));}));

const expenseCategoryBody=z.object({name:z.string().min(2),description:z.string().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),sortOrder:z.coerce.number().int().default(0)});
api.get('/expense-categories',asyncRoute(async(req,res)=>res.json(await prisma.expenseCategory.findMany({where:tenantWhere(req),orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/expense-categories',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.status(201).json(await prisma.expenseCategory.create({data:{...expenseCategoryBody.parse(req.body),businessId:req.user!.businessId}}))));
api.put('/expense-categories/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const id=String(req.params.id);const existing=await prisma.expenseCategory.findFirst({where:tenantWhereAnd(req,{id})});if(!existing)throw new ApiError(404,'Kategori pengeluaran tidak ditemukan');res.json(await prisma.expenseCategory.update({where:{id},data:expenseCategoryBody.partial().parse(req.body)}));}));
api.delete('/expense-categories/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const id=String(req.params.id);const existing=await prisma.expenseCategory.findFirst({where:tenantWhereAnd(req,{id})});if(!existing)throw new ApiError(404,'Kategori pengeluaran tidak ditemukan');res.json(await prisma.expenseCategory.update({where:{id},data:{status:'INACTIVE'}}));}));

const expenseBody=z.object({categoryId:z.string().optional(),description:z.string().min(2),amount:z.coerce.number().positive(),paymentSource:z.enum(['CASH_DRAWER','NON_CASH','OWNER_TRANSFER']).default('CASH_DRAWER'),note:z.string().nullable().optional(),receiptImageUrl:z.string().nullable().optional()});
const expenseInclude={outlet:true,cashier:{select:{name:true}},cashSession:true,categoryRef:true};
api.get('/expenses',asyncRoute(async(req,res)=>{const where:any=tenantWhereAnd(req,{status:req.query.status?String(req.query.status):'ACTIVE',outletId:await requiredOutletId(req)});if(req.query.cash_session_id)where.cashSessionId=String(req.query.cash_session_id);if(req.query.cashier_id)where.cashierId=String(req.query.cashier_id);if(req.query.category_id)where.categoryId=String(req.query.category_id);if(req.query.payment_source)where.paymentSource=String(req.query.payment_source);if(req.query.date)where.createdAt=dayRange(String(req.query.date));res.json(await prisma.expense.findMany({where,include:expenseInclude,orderBy:{createdAt:'desc'}}));}));
api.post('/expenses',asyncRoute(async(req,res)=>{const d=expenseBody.parse(req.body);const outletId=typeof req.body?.outletId==='string'?req.body.outletId:undefined;const where:any=tenantWhereAnd(req,{status:'OPEN'});if(outletId){await assertTenantOutlet(req,outletId);where.outletId=outletId;}else if(req.user!.role!=='OWNER')where.outletId={in:req.user!.outletIds};const active=await prisma.cashSession.findFirst({where,include:{outlet:true},orderBy:{openedAt:'desc'}});if(!active)throw new ApiError(400,'Shift belum dibuka. Silakan buka kasir terlebih dahulu.');await assertTenantOutlet(req,active.outletId);const cat=d.categoryId?await prisma.expenseCategory.findFirst({where:tenantWhereAnd(req,{id:d.categoryId})}):null;if(d.categoryId&&!cat)throw new ApiError(400,'Kategori pengeluaran tidak ditemukan');res.status(201).json(await prisma.expense.create({data:{businessId:req.user!.businessId,outletId:active.outletId,cashSessionId:active.id,cashierId:req.user!.id,categoryId:cat?.id,categoryName:cat?.name||'Lain-lain',description:d.description,amount:d.amount,paymentSource:d.paymentSource,note:d.note,receiptImageUrl:d.receiptImageUrl},include:expenseInclude}));}));
api.put('/expenses/:id',asyncRoute(async(req,res)=>{const d=expenseBody.partial().parse(req.body);const existing=await prisma.expense.findFirst({where:tenantWhereAnd(req,{id:String(req.params.id)}),include:{cashSession:true}});if(!existing)throw new ApiError(404,'Pengeluaran tidak ditemukan');await assertTenantOutlet(req,existing.outletId);const isOwner=req.user!.role==='OWNER'||req.user!.role==='SUPERVISOR';if(!isOwner&&(existing.cashierId!==req.user!.id||existing.cashSession.status==='CLOSED'))throw new ApiError(403,'Pengeluaran tidak bisa diedit setelah shift ditutup');const cat=d.categoryId?await prisma.expenseCategory.findFirst({where:tenantWhereAnd(req,{id:d.categoryId})}):null;if(d.categoryId&&!cat)throw new ApiError(400,'Kategori pengeluaran tidak ditemukan');const updated=await prisma.expense.update({where:{id:existing.id},data:{categoryId:d.categoryId??existing.categoryId,categoryName:cat?.name??existing.categoryName,description:d.description,amount:d.amount,paymentSource:d.paymentSource,note:d.note,receiptImageUrl:d.receiptImageUrl},include:expenseInclude});await prisma.auditLog.create({data:{businessId:req.user!.businessId,entityType:'EXPENSE',entityId:existing.id,action:'EXPENSE_UPDATED',oldValue:existing as any,newValue:updated as any,changedBy:req.user!.id}});res.json(updated);}));
api.delete('/expenses/:id',asyncRoute(async(req,res)=>{const existing=await prisma.expense.findFirst({where:tenantWhereAnd(req,{id:String(req.params.id)}),include:{cashSession:true}});if(!existing)throw new ApiError(404,'Pengeluaran tidak ditemukan');await assertTenantOutlet(req,existing.outletId);const isOwner=req.user!.role==='OWNER'||req.user!.role==='SUPERVISOR';if(!isOwner&&(existing.cashierId!==req.user!.id||existing.cashSession.status==='CLOSED'))throw new ApiError(403,'Pengeluaran tidak bisa dihapus setelah shift ditutup');const updated=await prisma.expense.update({where:{id:existing.id},data:{status:'CANCELLED'},include:expenseInclude});await prisma.auditLog.create({data:{businessId:req.user!.businessId,entityType:'EXPENSE',entityId:existing.id,action:'EXPENSE_CANCELLED',oldValue:existing as any,newValue:updated as any,changedBy:req.user!.id}});res.json(updated);}));

const inventoryAccess=requirePermission('inventory.view');
const invView=requirePermission('inventory.view');
const invStockIn=requirePermission('inventory.stock_in');
const invStockOut=requirePermission('inventory.stock_out');
const invAdjustment=requirePermission('inventory.adjustment');
const invOpname=requirePermission('inventory.opname');
const invTransfer=requirePermission('inventory.transfer');
const requireInventoryReport=requirePermission('inventory.report');
const invReport:ReturnType<typeof requirePermission>=(req,res,next)=>req.path.endsWith('/dashboard')&&hasPermission(req,'inventory.dashboard')?next():requireInventoryReport(req,res,next);
const invWarehouse=requirePermission('inventory.warehouse');
const invItemManagement=requirePermission('inventory.item_management');
const inventoryUnitConversionInclude:any={fromUnit:true,toUnit:true};
const inventoryItemInclude:any={category:true,unit:true,unitConversions:{include:inventoryUnitConversionInclude,orderBy:{createdAt:'asc'}},stocks:{include:{warehouse:true},orderBy:{warehouseId:'asc'}}};
function inventoryItemIncludeFor(req:any,warehouseId?:string):any{return {category:true,unit:true,unitConversions:{include:inventoryUnitConversionInclude,orderBy:{createdAt:'asc'}},stocks:{where:{warehouse:warehouseScope(req),...(warehouseId?{warehouseId}:{})},include:{warehouse:true},orderBy:{warehouseId:'asc'}}};}
const inventoryItemBody=z.object({code:z.string().min(1),sku:z.string().trim().nullable().optional().transform(v=>v||null),barcode:z.string().trim().nullable().optional().transform(v=>v||null),name:z.string().min(2),categoryId:z.string(),unitId:z.string(),minimumStock:z.coerce.number().nonnegative().default(0),currentStock:z.coerce.number().nonnegative().default(0),averageCost:z.coerce.number().nonnegative().default(0),supplier:z.string().nullable().optional(),notes:z.string().nullable().optional(),photoUrl:z.string().nullable().optional(),stockAlertEnabled:z.coerce.boolean().default(false),stockAlertType:z.enum(['OUT_OF_STOCK','LOW_STOCK','CUSTOM_THRESHOLD']).default('LOW_STOCK'),stockAlertThreshold:z.coerce.number().nonnegative().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const inventoryUnitConversionInput=z.object({fromUnitId:z.string(),toUnitId:z.string().optional(),multiplier:z.coerce.number().positive()});
const inventoryUnitConversionBody=z.object({conversions:z.array(inventoryUnitConversionInput).default([])});
const inventoryAssignWarehouseBody=z.object({warehouseIds:z.array(z.string()).min(1),averageCostMode:z.enum(['SOURCE','ITEM','ZERO','MANUAL']).default('SOURCE'),sourceWarehouseId:z.string().optional(),averageCost:z.coerce.number().nonnegative().optional()});
const warehouseBody=z.object({code:z.string().min(1),name:z.string().min(2),type:z.enum(['CENTRAL','PRODUCTION','OUTLET','VIRTUAL']).default('CENTRAL'),outletId:z.string().nullable().optional(),address:z.string().nullable().optional(),picName:z.string().nullable().optional(),phone:z.string().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const inventoryLookupBody=z.object({name:z.string().min(1),sortOrder:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
function inventoryDateRange(query:any){if(query.from&&query.to){const start=new Date(`${query.from}T00:00:00+07:00`),end=new Date(`${query.to}T00:00:00+07:00`);end.setDate(end.getDate()+1);return {gte:start,lt:end};}const period=String(query.period||'today'),now=new Date(),start=new Date(now);if(period==='week'){const day=(start.getDay()+6)%7;start.setDate(start.getDate()-day);start.setHours(0,0,0,0);}else if(period==='month'){start.setDate(1);start.setHours(0,0,0,0);}else start.setHours(0,0,0,0);return {gte:start,lte:now};}
async function getDefaultWarehouse(tx:any=prisma,businessId?:string){let wh=await tx.inventoryWarehouse.findFirst({where:{status:'ACTIVE',...(businessId?{businessId}:{})},orderBy:{createdAt:'asc'}});if(!wh)wh=await tx.inventoryWarehouse.create({data:{businessId,code:'WH-DEFAULT',name:'Gudang Utama',type:'CENTRAL',status:'ACTIVE'}});return wh;}
async function warehouseIdOrDefault(id?:string|null,tx:any=prisma,businessId?:string){if(id){const wh=await tx.inventoryWarehouse.findUnique({where:{id}});if(!wh||wh.status!=='ACTIVE')throw new ApiError(404,'Warehouse tidak ditemukan');return wh.id;}return (await getDefaultWarehouse(tx,businessId)).id;}
function warehouseScope(req:any){
  if(req.user!.role==='OWNER')return tenantScope(req);
  if(req.user!.assignedWarehouseId)return {id:req.user!.assignedWarehouseId};
  return tenantAnd(req,{outletId:{in:req.user!.outletIds}});
}
async function assertWarehouseAccess(req:any,warehouseId:string,tx:any=prisma){const wh=await tx.inventoryWarehouse.findUnique({where:{id:warehouseId}});if(!wh||wh.status!=='ACTIVE')throw new ApiError(404,'Warehouse tidak ditemukan');if(wh.businessId&&wh.businessId!==req.user!.businessId)throw new ApiError(403,'Warehouse tidak diizinkan');if(req.user!.role!=='OWNER'){if(req.user!.assignedWarehouseId&&warehouseId!==req.user!.assignedWarehouseId)throw new ApiError(403,'Warehouse tidak diizinkan');if(!req.user!.assignedWarehouseId&&wh.outletId&&!req.user!.outletIds.includes(wh.outletId))throw new ApiError(403,'Warehouse tidak diizinkan');}return wh;}
async function warehouseIdForRequest(req:any,id?:string|null,tx:any=prisma){if(id){await assertWarehouseAccess(req,id,tx);return id;}if(req.user!.role==='OWNER')return warehouseIdOrDefault(null,tx,req.user!.businessId);if(req.user!.assignedWarehouseId){await assertWarehouseAccess(req,req.user!.assignedWarehouseId,tx);return req.user!.assignedWarehouseId;}const wh=await tx.inventoryWarehouse.findFirst({where:tenantWhereAnd(req,{status:'ACTIVE',outletId:{in:req.user!.outletIds}}),orderBy:{name:'asc'}});if(!wh)throw new ApiError(403,'Warehouse tidak diizinkan');return wh.id;}
async function auditInventory(tx:any,req:any,action:string,warehouseId:string,newValue:any){const wh=await tx.inventoryWarehouse.findUnique({where:{id:warehouseId},include:{outlet:true}});await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'INVENTORY',entityId:warehouseId,action,oldValue:Prisma.JsonNull,newValue:{...newValue,user:req.user!.id,role:req.user!.role,warehouse:wh?.name,outletId:wh?.outletId,outlet:wh?.outlet?.name},changedBy:req.user!.id}});}
function invNo(prefix:string){return `${prefix}-${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')}-${Date.now().toString().slice(-6)}`;}
async function ensureInventoryStock(tx:any,warehouseId:string,itemId:string){return tx.inventoryStock.upsert({where:{warehouseId_inventoryItemId:{warehouseId,inventoryItemId:itemId}},create:{warehouseId,inventoryItemId:itemId,currentQty:0,reservedQty:0,availableQty:0,averageCost:0},update:{}});}
async function refreshLegacyItemStock(tx:any,itemId:string){const stocks=await tx.inventoryStock.findMany({where:{inventoryItemId:itemId}});const current=stocks.reduce((n:any,s:any)=>n+Number(s.currentQty),0);const value=stocks.reduce((n:any,s:any)=>n+Number(s.currentQty)*Number(s.averageCost),0);await tx.inventoryItem.update({where:{id:itemId},data:{currentStock:current,averageCost:current>0?money(value/current):0,stockAlertState:current>0?'NORMAL':undefined}});}
async function changeInventoryStock(tx:any,args:{businessId:string,warehouseId:string,itemId:string,qty:number,type:any,userId:string,unitCost?:number,reference?:string,referenceId?:string,referenceType?:string,remarks?:string,productId?:string|null,orderItemId?:string|null}){const item=await tx.inventoryItem.findUnique({where:{id:args.itemId}});if(!item||item.status!=='ACTIVE'||item.businessId!==args.businessId)throw new ApiError(404,'Bahan baku tidak ditemukan');const stock=await ensureInventoryStock(tx,args.warehouseId,args.itemId);const before=Number(stock.currentQty);const isIn=['STOCK_IN','TRANSFER_IN','ADJUSTMENT_IN','OPNAME','SALE_VOID_RETURN','SALE_REFUND_RETURN'].includes(args.type);const after=args.type==='OPNAME'?args.qty:(isIn?before+args.qty:before-args.qty);if(after<0)throw new ApiError(400,'Stok tidak mencukupi.');const unitCost=(args.unitCost??Number(stock.averageCost))||Number(item.averageCost)||0;const averageCost=args.type==='STOCK_IN'&&after>0?money(((before*Number(stock.averageCost))+(args.qty*unitCost))/after):Number(stock.averageCost);await tx.inventoryStock.update({where:{id:stock.id},data:{currentQty:after,availableQty:after-Number(stock.reservedQty),averageCost,lastMovementAt:new Date()}});const movement=await tx.inventoryMovement.create({data:{businessId:args.businessId,movementNumber:invNo('INV'),warehouseId:args.warehouseId,inventoryItemId:args.itemId,movementType:args.type,qty:args.type==='OPNAME'?Math.abs(after-before):args.qty,beforeQty:before,afterQty:after,unitCost,totalCost:money(Math.abs(after-before)*unitCost),referenceType:args.referenceType,reference:args.reference,referenceId:args.referenceId,productId:args.productId||undefined,orderItemId:args.orderItemId||undefined,remarks:args.remarks,createdBy:args.userId},include:{item:{include:inventoryItemInclude},warehouse:true,user:{select:{name:true}}}});await refreshLegacyItemStock(tx,args.itemId);return movement;}
function inventoryAlertThreshold(item:any){const type=item.stockAlertType||'LOW_STOCK';if(type==='OUT_OF_STOCK')return 0;if(type==='CUSTOM_THRESHOLD')return Number(item.stockAlertThreshold??0);return Number(item.minimumStock);}
function inventoryAlertBreached(item:any,current?:number){return Number(current??item.currentStock)<=inventoryAlertThreshold(item);}
function inventoryAlertTitle(item:any,current?:number){return item.stockAlertType==='OUT_OF_STOCK'||Number(current??item.currentStock)<=0?'Stok bahan kosong':'Stok bahan menipis';}
function inventoryAlertMessage(item:any,outletName?:string,current?:number){const unit=item.unit?.name||'';const where=outletName?` di outlet ${outletName}`:'';if(item.stockAlertType==='OUT_OF_STOCK'||Number(current??item.currentStock)<=0)return `${item.name} sudah habis${where}.`;return `${item.name} tersisa ${Number(current??item.currentStock)} ${unit}. Minimum/threshold ${inventoryAlertThreshold(item)} ${unit}.`.replace(/\s+\./,'.');}
api.get('/warehouses',invView,asyncRoute(async(req,res)=>{const clauses:any[]=[warehouseScope(req)];if(req.query.status)clauses.push({status:String(req.query.status)});if(req.query.q){const q=String(req.query.q);clauses.push({OR:[{name:{contains:q,mode:'insensitive'}},{code:{contains:q,mode:'insensitive'}}]});}res.json(await prisma.inventoryWarehouse.findMany({where:{AND:clauses},include:{outlet:true},orderBy:{name:'asc'}}));}));
api.post('/warehouses',invWarehouse,asyncRoute(async(req,res)=>{const d=warehouseBody.parse(req.body);if(d.outletId)await assertTenantOutlet(req,d.outletId);if(req.user!.role!=='OWNER'&&!d.outletId)throw new ApiError(403,'Warehouse harus terhubung ke outlet yang diassign.');if(await prisma.inventoryWarehouse.findFirst({where:tenantWhereAnd(req,{code:d.code})}))throw new ApiError(409,'Kode warehouse sudah digunakan');res.status(201).json(await prisma.inventoryWarehouse.create({data:{...d,businessId:req.user!.businessId},include:{outlet:true}}));}));
api.put('/warehouses/:id',invWarehouse,asyncRoute(async(req,res)=>{await assertWarehouseAccess(req,String(req.params.id));const d=warehouseBody.partial().parse(req.body);if(d.outletId)await assertTenantOutlet(req,d.outletId);res.json(await prisma.inventoryWarehouse.update({where:{id:String(req.params.id)},data:d,include:{outlet:true}}));}));
api.delete('/warehouses/:id',invWarehouse,asyncRoute(async(req,res)=>{await assertWarehouseAccess(req,String(req.params.id));res.json(await prisma.inventoryWarehouse.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}));}));
api.get('/inventory/warehouses',invView,asyncRoute(async(req,res)=>{
  const where:any={...warehouseScope(req)};
  if(req.query.status)where.status=String(req.query.status);
  res.json(await prisma.inventoryWarehouse.findMany({where,include:{outlet:true},orderBy:{name:'asc'}}));
}));
api.get('/inventory/categories',invView,asyncRoute(async(req,res)=>res.json(await prisma.inventoryCategory.findMany({where:tenantWhere(req),orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/inventory/categories',invItemManagement,asyncRoute(async(req,res)=>{const d=inventoryLookupBody.parse(req.body);if(await prisma.inventoryCategory.findFirst({where:tenantWhereAnd(req,{name:d.name})}))throw new ApiError(409,'Kategori inventory sudah ada.');res.status(201).json(await prisma.inventoryCategory.create({data:{...d,businessId:req.user!.businessId}}));}));
api.get('/inventory/units',invView,asyncRoute(async(req,res)=>res.json(await prisma.inventoryUnit.findMany({where:tenantWhere(req),orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/inventory/units',invItemManagement,asyncRoute(async(req,res)=>{const d=inventoryLookupBody.parse(req.body);if(await prisma.inventoryUnit.findFirst({where:tenantWhereAnd(req,{name:d.name})}))throw new ApiError(409,'Satuan inventory sudah ada.');res.status(201).json(await prisma.inventoryUnit.create({data:{...d,businessId:req.user!.businessId}}));}));
api.get('/inventory/items',invView,asyncRoute(async(req,res)=>{const where:any={};let warehouseId:string|undefined;if(req.query.q){const q=String(req.query.q);where.OR=[{name:{contains:q,mode:'insensitive'}},{code:{contains:q,mode:'insensitive'}},{sku:{contains:q,mode:'insensitive'}},{barcode:{contains:q,mode:'insensitive'}}];}if(req.query.category_id)where.categoryId=String(req.query.category_id);if(req.query.status)where.status=String(req.query.status);if(req.query.warehouseId){warehouseId=String(req.query.warehouseId);await assertWarehouseAccess(req,warehouseId);}res.json(await prisma.inventoryItem.findMany({where:tenantWhereAnd(req,where,warehouseId?{stocks:{some:{warehouseId}}}:{}),include:inventoryItemIncludeFor(req,warehouseId),orderBy:{name:'asc'}}));}));
api.get('/inventory/search',invView,asyncRoute(async(req,res)=>{const q=String(req.query.q||req.query.sku||req.query.barcode||'').trim();if(!q)throw new ApiError(400,'Query wajib diisi.');const warehouseId=req.query.warehouseId?String(req.query.warehouseId):undefined;if(warehouseId)await assertWarehouseAccess(req,warehouseId);res.json(await prisma.inventoryItem.findMany({where:tenantWhereAnd(req,{OR:[{sku:{equals:q,mode:'insensitive'}},{barcode:{equals:q,mode:'insensitive'}},{code:{equals:q,mode:'insensitive'}},{sku:{contains:q,mode:'insensitive'}},{barcode:{contains:q,mode:'insensitive'}},{code:{contains:q,mode:'insensitive'}},{name:{contains:q,mode:'insensitive'}}]},warehouseId?{stocks:{some:{warehouseId}}}:{}),include:inventoryItemIncludeFor(req,warehouseId),orderBy:[{sku:'asc'},{name:'asc'}],take:20}));}));
api.get('/inventory/items/by-sku/:sku',invView,asyncRoute(async(req,res)=>{const sku=String(req.params.sku).trim();const warehouseId=req.query.warehouseId?String(req.query.warehouseId):undefined;if(warehouseId)await assertWarehouseAccess(req,warehouseId);const item=await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{OR:[{sku:{equals:sku,mode:'insensitive'}},{barcode:{equals:sku,mode:'insensitive'}}]},warehouseId?{stocks:{some:{warehouseId}}}:{}),include:inventoryItemIncludeFor(req,warehouseId)});if(!item)throw new ApiError(404,'Barang belum terdaftar.');res.json(item);}));
api.post('/inventory/items',invItemManagement,asyncRoute(async(req,res)=>{const d=inventoryItemBody.parse(req.body);if(await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{code:d.code})}))throw new ApiError(409,'Kode bahan baku sudah digunakan');if(d.sku&&await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{sku:{equals:d.sku,mode:'insensitive'}})}))throw new ApiError(409,'SKU sudah digunakan.');if(d.barcode&&await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{barcode:{equals:d.barcode,mode:'insensitive'}})}))throw new ApiError(409,'Barcode sudah digunakan.');const warehouseId=await warehouseIdForRequest(req,String(req.body.warehouseId||''));res.status(201).json(await prisma.$transaction(async tx=>{const item=await tx.inventoryItem.create({data:{...d,businessId:req.user!.businessId},include:inventoryItemInclude});if(Number(d.currentStock)>0){await ensureInventoryStock(tx,warehouseId,item.id);await changeInventoryStock(tx,{businessId:req.user!.businessId,warehouseId,itemId:item.id,qty:Number(d.currentStock),type:'STOCK_IN',userId:req.user!.id,unitCost:Number(d.averageCost),reference:'Initial Stock',referenceType:'INITIAL'});}await auditInventory(tx,req,'INVENTORY_ITEM_CREATED',warehouseId,{itemId:item.id,itemName:item.name,currentStock:d.currentStock});return tx.inventoryItem.findUnique({where:{id:item.id},include:inventoryItemInclude});}));}));
api.put('/inventory/items/:id',invItemManagement,asyncRoute(async(req,res)=>{const d=inventoryItemBody.partial().parse(req.body);const id=String(req.params.id);const existing=await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{id})});if(!existing)throw new ApiError(404,'Bahan baku tidak ditemukan');if(d.code&&d.code!==existing.code&&await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{code:d.code,NOT:{id}})}))throw new ApiError(409,'Kode bahan baku sudah digunakan');if(d.sku&&d.sku!==existing.sku&&await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{sku:{equals:d.sku,mode:'insensitive'},NOT:{id}})}))throw new ApiError(409,'SKU sudah digunakan.');if(d.barcode&&d.barcode!==existing.barcode&&await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{barcode:{equals:d.barcode,mode:'insensitive'},NOT:{id}})}))throw new ApiError(409,'Barcode sudah digunakan.');res.json(await prisma.$transaction(async tx=>{const item=await tx.inventoryItem.update({where:{id},data:d,include:inventoryItemInclude});if(d.averageCost!==undefined&&Number(d.averageCost)!==Number(existing.averageCost)){await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'INVENTORY_ITEM',entityId:id,action:'INVENTORY_ITEM_COST_UPDATED',oldValue:{averageCost:Number(existing.averageCost)},newValue:{itemId:id,itemName:item.name,averageCost:d.averageCost,user:req.user!.id,role:req.user!.role},changedBy:req.user!.id}});}return item;}));}));
api.post('/inventory/items/:id/assign-warehouses',invItemManagement,asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const d=inventoryAssignWarehouseBody.parse(req.body);
  const item=await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{id}),include:{stocks:true}});
  if(!item||item.status==='INACTIVE')throw new ApiError(404,'Bahan baku tidak ditemukan');
  const warehouseIds=[...new Set(d.warehouseIds)];
  for(const warehouseId of warehouseIds)await assertWarehouseAccess(req,warehouseId);
  if(d.sourceWarehouseId)await assertWarehouseAccess(req,d.sourceWarehouseId);
  res.status(201).json(await prisma.$transaction(async tx=>{
    let averageCost=0;
    if(d.averageCostMode==='MANUAL')averageCost=Number(d.averageCost||0);
    else if(d.averageCostMode==='ITEM')averageCost=Number(item.averageCost||0);
    else if(d.averageCostMode==='SOURCE'){
      const sourceStock=d.sourceWarehouseId?await tx.inventoryStock.findUnique({where:{warehouseId_inventoryItemId:{warehouseId:d.sourceWarehouseId,inventoryItemId:id}}}):null;
      averageCost=Number(sourceStock?.averageCost ?? item.averageCost ?? 0);
    }
    const assigned:any[]=[];
    const skipped:any[]=[];
    for(const warehouseId of warehouseIds){
      const existing=await tx.inventoryStock.findUnique({where:{warehouseId_inventoryItemId:{warehouseId,inventoryItemId:id}},include:{warehouse:true}});
      if(existing){skipped.push({warehouseId,reason:'ALREADY_ASSIGNED'});continue;}
      const stock=await tx.inventoryStock.create({data:{warehouseId,inventoryItemId:id,currentQty:0,reservedQty:0,availableQty:0,averageCost:money(averageCost)},include:{warehouse:true}});
      assigned.push(stock);
    }
    await refreshLegacyItemStock(tx,id);
    await auditInventory(tx,req,'INVENTORY_ITEM_ASSIGNED_TO_WAREHOUSE',warehouseIds[0]!,{itemId:id,itemName:item.name,assignedWarehouseIds:assigned.map(s=>s.warehouseId),skipped,averageCostMode:d.averageCostMode,averageCost:money(averageCost)});
    return {itemId:id,itemName:item.name,assigned,skipped};
  }));
}));
api.put('/inventory/items/:id/unit-conversions',invItemManagement,asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const item=await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{id})});
  if(!item)throw new ApiError(404,'Bahan baku tidak ditemukan');
  const d=inventoryUnitConversionBody.parse(req.body);
  const rows=d.conversions.map(row=>({inventoryItemId:id,fromUnitId:row.fromUnitId,toUnitId:row.toUnitId||item.unitId,multiplier:row.multiplier}));
  const duplicate=new Set(rows.map(r=>`${r.fromUnitId}:${r.toUnitId}`));
  if(duplicate.size!==rows.length)throw new ApiError(400,'Konversi satuan tidak boleh duplikat.');
  const unitIds=[...new Set(rows.flatMap(r=>[r.fromUnitId,r.toUnitId]))];
  const units=await prisma.inventoryUnit.findMany({where:tenantWhereAnd(req,{id:{in:unitIds},status:'ACTIVE'})});
  if(units.length!==unitIds.length)throw new ApiError(400,'Satuan konversi tidak ditemukan atau inactive.');
  res.json(await prisma.$transaction(async tx=>{
    await tx.inventoryUnitConversion.deleteMany({where:{inventoryItemId:id}});
    if(rows.length)await tx.inventoryUnitConversion.createMany({data:rows});
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'INVENTORY_ITEM',entityId:id,action:'INVENTORY_UNIT_CONVERSION_UPDATED',oldValue:Prisma.JsonNull,newValue:{itemId:id,conversions:rows},changedBy:req.user!.id}});
    return tx.inventoryItem.findUnique({where:{id},include:inventoryItemInclude});
  }));
}));
api.delete('/inventory/items/:id',invItemManagement,asyncRoute(async(req,res)=>{const id=String(req.params.id);const item=await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{id})});if(!item)throw new ApiError(404,'Bahan baku tidak ditemukan');res.json(await prisma.inventoryItem.update({where:{id},data:{status:'INACTIVE'},include:inventoryItemInclude}));}));
api.get('/inventory/stocks',invView,asyncRoute(async(req,res)=>{const where:any={warehouse:warehouseScope(req)};if(req.query.warehouseId){await assertWarehouseAccess(req,String(req.query.warehouseId));where.warehouseId=String(req.query.warehouseId);}if(req.query.itemId)where.inventoryItemId=String(req.query.itemId);res.json(await prisma.inventoryStock.findMany({where,include:{warehouse:true,item:{include:inventoryItemInclude}},orderBy:{updatedAt:'desc'}}));}));
api.get('/inventory/dashboard',invReport,asyncRoute(async(req,res)=>{const warehouseId=req.query.warehouseId?String(req.query.warehouseId):undefined;if(warehouseId)await assertWarehouseAccess(req,warehouseId);const range=inventoryDateRange(req.query);const stockWhere:any={warehouse:warehouseScope(req),item:tenantWhereAnd(req,{status:'ACTIVE'})};const movementWhere:any=tenantWhereAnd(req,{createdAt:range,warehouse:warehouseScope(req)});if(warehouseId){stockWhere.warehouseId=warehouseId;movementWhere.AND.push({warehouseId});}const [stocks,items,movements]=await Promise.all([prisma.inventoryStock.findMany({where:stockWhere,include:{item:true}}),prisma.inventoryItem.findMany({where:tenantWhereAnd(req,{status:'ACTIVE'})}),prisma.inventoryMovement.findMany({where:movementWhere,include:{item:true,warehouse:true},orderBy:{createdAt:'desc'},take:20})]);const totalStockValue=money(stocks.reduce((n,s)=>n+Number(s.currentQty)*Number(s.averageCost),0));const lowStock=stocks.filter(s=>Number(s.currentQty)>0&&Number(s.currentQty)<=Number(s.item.minimumStock)).length;const outOfStock=stocks.filter(s=>Number(s.currentQty)<=0).length;const by=(types:string[])=>movements.filter(m=>types.includes(String(m.movementType))).reduce((n,m)=>n+Number(m.qty),0);res.json({totalItems:warehouseId?new Set(stocks.map(s=>s.inventoryItemId)).size:items.length,totalStockValue,lowStock,outOfStock,chart:{stockIn:by(['STOCK_IN','TRANSFER_IN','ADJUSTMENT_IN']),stockOut:by(['STOCK_OUT','TRANSFER_OUT','ADJUSTMENT_OUT']),adjustment:by(['ADJUSTMENT','ADJUSTMENT_IN','ADJUSTMENT_OUT','OPNAME'])},recentMovements:movements});}));
api.get('/inventory/summary',invReport,asyncRoute(async(req,res)=>{req.query.period=req.query.period||'today';const warehouseId=req.query.warehouseId?`?warehouseId=${req.query.warehouseId}&period=${req.query.period}`:`?period=${req.query.period}`;res.redirect(307,`/api/inventory/dashboard${warehouseId}`);}));
api.get('/inventory/movements',invReport,asyncRoute(async(req,res)=>{const where:any={warehouse:warehouseScope(req)};if(req.query.warehouseId){await assertWarehouseAccess(req,String(req.query.warehouseId));where.warehouseId=String(req.query.warehouseId);}if(req.query.item_id)where.inventoryItemId=String(req.query.item_id);if(req.query.type)where.movementType=String(req.query.type);res.json(await prisma.inventoryMovement.findMany({where,include:{item:{include:inventoryItemInclude},warehouse:true,user:{select:{name:true}}},orderBy:{createdAt:'desc'},take:300}));}));
api.get('/inventory/history',invReport,asyncRoute(async(req,res)=>{const where:any={warehouse:warehouseScope(req)};if(req.query.warehouseId){await assertWarehouseAccess(req,String(req.query.warehouseId));where.warehouseId=String(req.query.warehouseId);}if(req.query.item_id)where.inventoryItemId=String(req.query.item_id);if(req.query.type)where.movementType=String(req.query.type);res.json(await prisma.inventoryMovement.findMany({where,include:{item:{include:inventoryItemInclude},warehouse:true,user:{select:{name:true}}},orderBy:{createdAt:'desc'},take:300}));}));
api.get('/inventory/alerts',invView,asyncRoute(async(req,res)=>res.json(await prisma.inventoryAlertLog.findMany({where:{item:tenantWhere(req)},include:{item:{include:inventoryItemInclude}},orderBy:{sentAt:'desc'},take:200}))));
api.get('/inventory/alerts/check',invView,asyncRoute(async(req,res)=>{const warehouseId=req.query.warehouseId?String(req.query.warehouseId):undefined;if(warehouseId)await assertWarehouseAccess(req,warehouseId);let outletName='';if(req.query.outletId){await assertTenantOutlet(req,String(req.query.outletId));const outlet=await prisma.outlet.findFirst({where:tenantWhereAnd(req,{id:String(req.query.outletId)}),select:{name:true}});outletName=outlet?.name||'';}const where:any={warehouse:warehouseScope(req),item:tenantWhereAnd(req,{status:'ACTIVE',stockAlertEnabled:true})};if(warehouseId)where.warehouseId=warehouseId;const stocks=await prisma.inventoryStock.findMany({where,include:{item:{include:{category:true,unit:true}}}});const cutoff=new Date(Date.now()-6*60*60*1000);const alerts=[];for(const stock of stocks){const item=stock.item,current=Number(stock.currentQty);if(!inventoryAlertBreached(item,current)){if(item.stockAlertState!=='NORMAL')await prisma.inventoryItem.update({where:{id:item.id},data:{stockAlertState:'NORMAL'}});continue;}if(item.stockAlertState==='ALERTED'&&item.lastStockAlertAt&&item.lastStockAlertAt>cutoff)continue;alerts.push({inventoryItemId:item.id,itemName:item.name,unit:item.unit?.name,alertType:item.stockAlertType,currentStock:current,threshold:inventoryAlertThreshold(item),title:inventoryAlertTitle(item,current),message:inventoryAlertMessage(item,outletName,current)});}res.json(alerts);}));
api.post('/inventory/alert-logs',invView,asyncRoute(async(req,res)=>{const d=z.object({inventoryItemId:z.string(),alertType:z.enum(['OUT_OF_STOCK','LOW_STOCK','CUSTOM_THRESHOLD']),currentStock:z.coerce.number(),threshold:z.coerce.number().nullable().optional(),title:z.string().min(1),message:z.string().min(1),status:z.enum(['SENT','FAILED']).default('SENT'),errorMessage:z.string().nullable().optional()}).parse(req.body);const item=await prisma.inventoryItem.findFirst({where:tenantWhereAnd(req,{id:d.inventoryItemId})});if(!item)throw new ApiError(404,'Bahan baku tidak ditemukan');const log=await prisma.inventoryAlertLog.create({data:{inventoryItemId:d.inventoryItemId,alertType:d.alertType,currentStock:d.currentStock,threshold:d.threshold??null,title:d.title,message:d.message,status:d.status,errorMessage:d.errorMessage??null},include:{item:{include:inventoryItemInclude}}});await prisma.inventoryItem.update({where:{id:d.inventoryItemId},data:{lastStockAlertAt:new Date(),stockAlertState:'ALERTED'}});res.status(201).json(log);}));
api.put('/inventory/stocks/:id/average-cost',invItemManagement,asyncRoute(async(req,res)=>{
  const d=z.object({averageCost:z.coerce.number().nonnegative()}).parse(req.body);
  const id=String(req.params.id);
  const existing=await prisma.inventoryStock.findUnique({where:{id},include:{item:true,warehouse:true}});
  if(!existing)throw new ApiError(404,'Stock warehouse tidak ditemukan');
  await assertWarehouseAccess(req,existing.warehouseId);
  res.json(await prisma.$transaction(async tx=>{
    const updated=await tx.inventoryStock.update({where:{id},data:{averageCost:money(d.averageCost)},include:{item:true,warehouse:true}});
    await refreshLegacyItemStock(tx,existing.inventoryItemId);
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'INVENTORY_STOCK',entityId:id,action:'INVENTORY_STOCK_AVG_COST_UPDATED',oldValue:{averageCost:Number(existing.averageCost),warehouseId:existing.warehouseId,itemId:existing.inventoryItemId},newValue:{averageCost:d.averageCost,warehouseId:existing.warehouseId,itemId:existing.inventoryItemId,itemName:existing.item.name,warehouseName:existing.warehouse.name},changedBy:req.user!.id}});
    return updated;
  }));
}));
api.post('/inventory/stock-in',invStockIn,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),date:z.string().optional(),supplier:z.string().optional(),reference:z.string().optional(),remarks:z.string().optional(),items:z.array(z.object({itemId:z.string(),qty:z.coerce.number().positive(),unitCost:z.coerce.number().nonnegative().optional(),totalCost:z.coerce.number().nonnegative().optional()})).min(1)}).parse(req.body);const warehouseId=await warehouseIdForRequest(req,d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>{const results=[];for(const row of d.items){const unitCost=row.totalCost!==undefined?row.totalCost/row.qty:(row.unitCost??0);results.push(await changeInventoryStock(tx,{businessId:req.user!.businessId,warehouseId,itemId:row.itemId,qty:row.qty,type:'STOCK_IN',userId:req.user!.id,unitCost,reference:d.reference||d.supplier,referenceType:'STOCK_IN',remarks:d.remarks}));}await auditInventory(tx,req,'INVENTORY_STOCK_IN',warehouseId,{items:d.items,reference:d.reference,supplier:d.supplier});return results;}));}));
api.post('/inventory/stock-out',invStockOut,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),date:z.string().optional(),destination:z.string().optional(),remarks:z.string().optional(),items:z.array(z.object({itemId:z.string(),qty:z.coerce.number().positive()})).min(1)}).parse(req.body);const warehouseId=await warehouseIdForRequest(req,d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>{const results=[];for(const row of d.items)results.push(await changeInventoryStock(tx,{businessId:req.user!.businessId,warehouseId,itemId:row.itemId,qty:row.qty,type:'STOCK_OUT',userId:req.user!.id,reference:d.destination,referenceType:'STOCK_OUT',remarks:d.remarks}));await auditInventory(tx,req,'INVENTORY_STOCK_OUT',warehouseId,{items:d.items,destination:d.destination});return results;}));}));
api.post('/inventory/adjustments',invAdjustment,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),itemId:z.string(),qty:z.coerce.number().positive(),adjustmentType:z.enum(['INCREASE','DECREASE']),reason:z.string().min(1),remarks:z.string().optional()}).parse(req.body);const warehouseId=await warehouseIdForRequest(req,d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>{const result=await changeInventoryStock(tx,{businessId:req.user!.businessId,warehouseId,itemId:d.itemId,qty:d.qty,type:d.adjustmentType==='INCREASE'?'ADJUSTMENT_IN':'ADJUSTMENT_OUT',userId:req.user!.id,reference:d.reason,referenceType:'ADJUSTMENT',remarks:d.remarks});await auditInventory(tx,req,'INVENTORY_ADJUSTMENT',warehouseId,d);return result;}))}));
api.post('/inventory/opname',invOpname,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),items:z.array(z.object({itemId:z.string(),actualStock:z.coerce.number().nonnegative(),remarks:z.string().optional()})).min(1)}).parse(req.body);const warehouseId=await warehouseIdForRequest(req,d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>{const results=[];for(const row of d.items)results.push(await changeInventoryStock(tx,{businessId:req.user!.businessId,warehouseId,itemId:row.itemId,qty:row.actualStock,type:'OPNAME',userId:req.user!.id,reference:'Stock Opname',referenceType:'OPNAME',remarks:row.remarks}));await auditInventory(tx,req,'INVENTORY_OPNAME',warehouseId,{items:d.items});return results;}));}));
api.get('/inventory/transfers',invTransfer,asyncRoute(async(req,res)=>{const clauses:any[]=[tenantScope(req)];if(req.query.status)clauses.push({status:String(req.query.status)});if(req.user!.role!=='OWNER')clauses.push({OR:req.user!.assignedWarehouseId?[{fromWarehouseId:req.user!.assignedWarehouseId},{toWarehouseId:req.user!.assignedWarehouseId}]:[{fromWarehouse:{outletId:{in:req.user!.outletIds}}},{toWarehouse:{outletId:{in:req.user!.outletIds}}}]});if(req.query.warehouseId){await assertWarehouseAccess(req,String(req.query.warehouseId));clauses.push({OR:[{fromWarehouseId:String(req.query.warehouseId)},{toWarehouseId:String(req.query.warehouseId)}]});}res.json(await prisma.stockTransfer.findMany({where:{AND:clauses},include:{fromWarehouse:true,toWarehouse:true,creator:{select:{name:true}},completer:{select:{name:true}},items:{include:{item:true}}},orderBy:{createdAt:'desc'},take:200}));}));
api.post('/inventory/transfers',invTransfer,asyncRoute(async(req,res)=>{const d=z.object({fromWarehouseId:z.string(),toWarehouseId:z.string(),notes:z.string().optional(),autoComplete:z.coerce.boolean().default(false),items:z.array(z.object({itemId:z.string(),qty:z.coerce.number().positive(),unitCost:z.coerce.number().nonnegative().optional()})).min(1)}).parse(req.body);if(d.fromWarehouseId===d.toWarehouseId)throw new ApiError(400,'Warehouse asal dan tujuan harus berbeda');await assertWarehouseAccess(req,d.fromWarehouseId);await assertWarehouseAccess(req,d.toWarehouseId);const created=await prisma.$transaction(async tx=>{const row=await tx.stockTransfer.create({data:{businessId:req.user!.businessId,transferNumber:invNo('TRF'),fromWarehouseId:d.fromWarehouseId,toWarehouseId:d.toWarehouseId,notes:d.notes,status:'SUBMITTED',createdBy:req.user!.id,items:{create:d.items.map(i=>({inventoryItemId:i.itemId,qty:i.qty,unitCost:i.unitCost}))}},include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}}});await auditInventory(tx,req,'INVENTORY_TRANSFER_CREATED',d.fromWarehouseId,{transferId:row.id,toWarehouseId:d.toWarehouseId,items:d.items});return row;});if(!d.autoComplete)return res.status(201).json(created);req.params.id=created.id;return res.status(201).json(await completeStockTransfer(created.id,req.user!.id,req));}));
async function completeStockTransfer(id:string,userId:string,req?:any){return prisma.$transaction(async tx=>{const transfer=await tx.stockTransfer.findUnique({where:{id},include:{items:true}});if(!transfer)throw new ApiError(404,'Transfer tidak ditemukan');if(req){await assertWarehouseAccess(req,transfer.fromWarehouseId,tx);await assertWarehouseAccess(req,transfer.toWarehouseId,tx);}if(transfer.status==='COMPLETED')return transfer;if(transfer.status==='CANCELLED')throw new ApiError(400,'Transfer sudah dibatalkan');const businessId=req?.user?.businessId||transfer.businessId;if(!businessId)throw new ApiError(403,'Business tidak valid');for(const row of transfer.items){await changeInventoryStock(tx,{businessId,warehouseId:transfer.fromWarehouseId,itemId:row.inventoryItemId,qty:Number(row.qty),type:'TRANSFER_OUT',userId,unitCost:Number(row.unitCost||0),reference:transfer.transferNumber,referenceId:transfer.id,referenceType:'TRANSFER'});await changeInventoryStock(tx,{businessId,warehouseId:transfer.toWarehouseId,itemId:row.inventoryItemId,qty:Number(row.qty),type:'TRANSFER_IN',userId,unitCost:Number(row.unitCost||0),reference:transfer.transferNumber,referenceId:transfer.id,referenceType:'TRANSFER'});}await auditInventory(tx,req||{user:{id:userId,role:'SYSTEM',businessId}},'INVENTORY_TRANSFER_COMPLETED',transfer.fromWarehouseId,{transferId:id,toWarehouseId:transfer.toWarehouseId});return tx.stockTransfer.update({where:{id},data:{status:'COMPLETED',completedBy:userId,completedAt:new Date()},include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}}});});}
api.post('/inventory/transfers/:id/complete',invTransfer,asyncRoute(async(req,res)=>res.json(await completeStockTransfer(String(req.params.id),req.user!.id,req))));
api.post('/inventory/transfers/:id/cancel',invTransfer,asyncRoute(async(req,res)=>{const existing=await prisma.stockTransfer.findUnique({where:{id:String(req.params.id)}});if(!existing)throw new ApiError(404,'Transfer tidak ditemukan');await assertWarehouseAccess(req,existing.fromWarehouseId);await assertWarehouseAccess(req,existing.toWarehouseId);res.json(await prisma.stockTransfer.update({where:{id:String(req.params.id)},data:{status:'CANCELLED'},include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}}}));}));
api.get('/inventory/reports/transfers',invReport,asyncRoute(async(req,res)=>{const clauses:any[]=[tenantScope(req)];if(req.user!.role!=='OWNER')clauses.push({OR:req.user!.assignedWarehouseId?[{fromWarehouseId:req.user!.assignedWarehouseId},{toWarehouseId:req.user!.assignedWarehouseId}]:[{fromWarehouse:{outletId:{in:req.user!.outletIds}}},{toWarehouse:{outletId:{in:req.user!.outletIds}}}]});if(req.query.from&&req.query.to)clauses.push({createdAt:inventoryDateRange(req.query)});res.json(await prisma.stockTransfer.findMany({where:{AND:clauses},include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}},orderBy:{createdAt:'desc'},take:300}));}));

const couponBody=z.object({couponCode:z.string().min(3).transform(v=>v.toUpperCase()),couponName:z.string().min(2),discountType:z.enum(['NOMINAL','PERCENTAGE']),discountValue:z.coerce.number().positive(),maxDiscountAmount:z.coerce.number().positive().nullable().optional(),minimumTransactionAmount:z.coerce.number().nonnegative().default(0),startDate:z.coerce.date(),endDate:z.coerce.date(),usageLimit:z.coerce.number().int().positive().nullable().optional(),usagePerCustomer:z.coerce.number().int().positive().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),outletIds:z.array(z.string()).default([]),productIds:z.array(z.string()).default([]),categories:z.array(z.string()).default([])}).refine(d=>d.endDate>d.startDate,{message:'Tanggal selesai harus setelah tanggal mulai'}).refine(d=>d.discountType!=='PERCENTAGE'||d.discountValue<=100,{message:'Persentase maksimal 100'});
api.get('/coupons',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.coupon.findMany({where:tenantWhere(req),include:{outlets:{include:{outlet:true}},products:{include:{product:true}},categories:true},orderBy:{createdAt:'desc'}}))));
api.post('/coupons',allow('OWNER'),asyncRoute(async(req,res)=>{const d=couponBody.parse(req.body);const {outletIds,productIds,categories,...data}=d;for(const outletId of outletIds)await assertTenantOutlet(req,outletId);for(const productId of productIds)await assertTenantProduct(req,productId);res.status(201).json(await prisma.coupon.create({data:{...data,businessId:req.user!.businessId,outlets:{create:outletIds.map(outletId=>({outletId}))},products:{create:productIds.map(productId=>({productId}))},categories:{create:categories.map(category=>({category}))}},include:{outlets:true,products:true,categories:true}}));}));
api.put('/coupons/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const d=couponBody.parse(req.body);const {outletIds,productIds,categories,...data}=d;const id=String(req.params.id);await assertTenantCoupon(req,id);for(const outletId of outletIds)await assertTenantOutlet(req,outletId);for(const productId of productIds)await assertTenantProduct(req,productId);res.json(await prisma.$transaction(async tx=>{await tx.couponOutlet.deleteMany({where:{couponId:id}});await tx.couponProduct.deleteMany({where:{couponId:id}});await tx.couponCategory.deleteMany({where:{couponId:id}});return tx.coupon.update({where:{id},data:{...data,outlets:{create:outletIds.map(outletId=>({outletId}))},products:{create:productIds.map(productId=>({productId}))},categories:{create:categories.map(category=>({category}))}},include:{outlets:true,products:true,categories:true}});}));}));
api.delete('/coupons/:id',allow('OWNER'),asyncRoute(async(req,res)=>{await assertTenantCoupon(req,String(req.params.id));res.json(await prisma.coupon.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}));}));
api.post('/coupons/validate',asyncRoute(async(req,res)=>{const d=z.object({couponCode:z.string(),outletId:z.string(),orderType:orderChannelSchema.optional(),items:z.array(z.any())}).parse(req.body);await assertTenantOutlet(req,d.outletId);const lines=await priceCart(d.items,d.outletId,d.orderType,req.user!.businessId);const result=await validateCoupon(d.couponCode,d.outletId,lines,undefined,req.user!.businessId);res.json({valid:true,coupon:{code:result.coupon.couponCode,name:result.coupon.couponName},discountAmount:result.discountAmount,eligibleAmount:result.eligibleAmount});}));

const saleInput=z.object({outletId:z.string(),cashSessionId:z.string().optional(),customerName:z.string().trim().optional(),customerPhone:z.string().trim().max(30).optional(),tableNumber:z.string().trim().max(30).optional(),orderNote:z.string().trim().max(255).optional(),orderType:orderChannelSchema.optional(),items:z.array(z.object({productId:z.string(),variantId:z.string().optional(),selectedVariantOptionIds:z.array(z.string()).optional(),qty:z.number().int().positive(),addonIds:z.array(z.string()).optional(),itemNote:z.string().trim().max(255).optional(),discount:z.object({type:z.enum(['NOMINAL','PERCENTAGE']),value:z.number().nonnegative()}).optional()})).min(1),transactionDiscount:z.object({type:z.enum(['NOMINAL','PERCENTAGE']),value:z.number().nonnegative()}).optional(),couponCode:z.string().optional(),paymentMethod:z.enum(['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER']).optional(),cashReceived:z.number().nonnegative().optional(),idempotencyKey:z.string().min(8).optional()});
function openBillCustomerName(d:z.infer<typeof saleInput>){
  const customerName=d.customerName?.trim()||'';
  if(!customerName||customerName.toLowerCase()==='walk in')throw new ApiError(400,'Nama customer wajib diisi untuk Open Bill.');
  return customerName;
}
async function nextNumber(prefix:string,outletId:string,field:'orderNumber'|'transactionNumber'){
  const outlet=await prisma.outlet.findUniqueOrThrow({where:{id:outletId}});
  const range=dayRange();
  const count=await prisma.sale.count({where:{outletId,createdAt:range,[field]:{not:null}}});
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
  return `${prefix}-${outlet.code}-${date}-${String(count+1).padStart(4,'0')}`;
}
function saleItemCreate(l:any){return {outletId:l.outletId,productId:l.productId,productVariantId:l.variantId,productName:l.productName,variantName:l.variantName,itemNote:l.itemNote,qty:l.qty,sellingPrice:l.unitPrice,hpp:l.hpp,subtotal:l.gross,totalHpp:money(l.hpp*l.qty),grossProfit:money(l.net-l.hpp*l.qty),priceBeforeDiscount:l.unitPrice,discountType:l.discountType,discountValue:l.discountValue,discountAmount:l.discountAmount,subtotalAfterDiscount:l.net,selectedVariantsJson:l.selectedVariants,basePrice:l.basePrice,outletPrice:l.outletPrice,channel:l.channel,dineInPriceSnapshot:l.dineInPriceSnapshot,channelPriceSnapshot:l.channelPriceSnapshot,priceSource:l.priceSource,baseMarginPercent:l.baseMarginPercent,actualMarginPercent:l.actualMarginPercent,variantPriceTotal:l.variantPriceTotal,finalUnitPrice:l.unitPrice,baseHpp:l.baseHpp,outletHpp:l.outletHpp,variantHppTotal:l.variantHppTotal,finalUnitHpp:l.hpp,addons:{create:l.addons.map((a:any)=>({addonId:a.id,addonName:a.name,price:a.price,hpp:a.hpp}))}};}
async function buildOrderTotals(req:any,d:z.infer<typeof saleInput>){
  const lines=await priceCart(d.items,d.outletId,d.orderType,req.user!.businessId);
  const gross=money(lines.reduce((s,l)=>s+l.gross,0)),productDiscount=money(lines.reduce((s,l)=>s+l.discountAmount,0)),afterProduct=money(gross-productDiscount),transactionDiscount=discountAmount(afterProduct,d.transactionDiscount),afterTransaction=money(afterProduct-transactionDiscount);
  const couponResult=d.couponCode?await validateCoupon(d.couponCode,d.outletId,lines,undefined,req.user!.businessId):null;
  const couponDiscount=Math.min(afterTransaction,couponResult?.discountAmount||0),grand=money(afterTransaction-couponDiscount),totalHpp=money(lines.reduce((s,l)=>s+l.hpp*l.qty,0));
  return {lines,gross,productDiscount,transactionDiscount,couponResult,couponDiscount,grand,totalHpp};
}
async function deductInventoryForPaidSale(tx:any,sale:any,userId:string){
  const outlet=await tx.outlet.findUnique({where:{id:sale.outletId},include:{defaultInventoryWarehouse:true}});
  if(!outlet)throw new ApiError(404,'Outlet tidak ditemukan');
  const productIds=[...new Set((sale.items||[]).map((item:any)=>item.productId))];
  if(!productIds.length)return;
  const warehouse=outlet.defaultInventoryWarehouse;
  const recipes=await tx.productRecipe.findMany({where:{productId:{in:productIds},isActive:true},include:{item:{include:{unit:true}},usageUnit:true}});
  const recipesByProduct=new Map<string,any[]>();
  for(const recipe of recipes)recipesByProduct.set(recipe.productId,[...(recipesByProduct.get(recipe.productId)||[]),recipe]);
  if(!warehouse&&recipes.length&&outlet.blockSaleWhenIngredientOutOfStock)throw new ApiError(400,'Warehouse inventory outlet belum diset.');
  if(!warehouse)return;
  for(const item of sale.items||[]){
    const productRecipes=recipesByProduct.get(item.productId)||[];
    if(!productRecipes.length){
      if(!outlet.allowSaleWithoutRecipe)throw new ApiError(400,`Recipe produk ${item.productName} belum diset.`);
      continue;
    }
    for(const recipe of productRecipes){
      const ratio=await inventoryUnitRatio(tx,recipe.inventoryItemId,recipe.usageUnitId,recipe.item.unitId,recipe.usageUnit.name,recipe.item.unit.name);
      if(ratio==null)throw new ApiError(400,`Konversi satuan recipe ${recipe.usageUnit.name} ke ${recipe.item.unit.name} untuk ${recipe.item.name} belum diset.`);
      const qty=money(recipeRequiredQty(recipe,Number(item.qty))*ratio);
      const stock=await tx.inventoryStock.findUnique({where:{warehouseId_inventoryItemId:{warehouseId:warehouse.id,inventoryItemId:recipe.inventoryItemId}}});
      if(Number(stock?.currentQty||0)<qty){
        if(outlet.blockSaleWhenIngredientOutOfStock)throw new ApiError(400,'Stok tidak mencukupi.');
        continue;
      }
      await changeInventoryStock(tx,{businessId:sale.businessId,warehouseId:warehouse.id,itemId:recipe.inventoryItemId,qty,type:'SALE_DEDUCTION',userId,unitCost:Number(recipe.item.averageCost||0),reference:sale.transactionNumber||sale.orderNumber,referenceId:sale.id,referenceType:'SALE',remarks:`Auto deduct ${item.productName}. Recipe ${recipeRequiredQty(recipe,Number(item.qty))} ${recipe.usageUnit.name} = ${qty} ${recipe.item.unit.name}`,productId:item.productId,orderItemId:item.id});
    }
  }
}
async function returnInventoryForVoidedSale(tx:any,sale:any,userId:string){
  const movements=await tx.inventoryMovement.findMany({where:{referenceId:sale.id,movementType:'SALE_DEDUCTION'}});
  for(const movement of movements){
    if(!movement.warehouseId)continue;
    await changeInventoryStock(tx,{businessId:sale.businessId,warehouseId:movement.warehouseId,itemId:movement.inventoryItemId,qty:Number(movement.qty),type:'SALE_VOID_RETURN',userId,unitCost:Number(movement.unitCost||0),reference:sale.transactionNumber||sale.orderNumber,referenceId:sale.id,referenceType:'SALE_VOID',remarks:'Return stock from void sale',productId:movement.productId,orderItemId:movement.orderItemId});
  }
}
async function createOrder(req:any,d:z.infer<typeof saleInput>,paid:boolean){
  const activeShift=await requireActiveShift(req,d.outletId,d.cashSessionId);
  d={...d,cashSessionId:activeShift.id};
  if(d.idempotencyKey){const key=await prisma.idempotencyKey.findUnique({where:{key:d.idempotencyKey}});if(key){const existing=await prisma.sale.findUnique({where:{id:key.entityId},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});if(existing)return existing;}}
  const customerName=paid?(d.customerName?.trim()||'Walk In'):openBillCustomerName(d);
  const totals=await buildOrderTotals(req,d);
  if(paid&&!d.paymentMethod) throw new ApiError(400,'Payment method wajib diisi');
  if(paid&&d.paymentMethod==='CASH'&&(d.cashReceived??0)<totals.grand) throw new ApiError(400,'Uang diterima kurang');
  const orderNumber=await nextNumber('ORD',d.outletId,'orderNumber');
  const transactionNumber=paid?await nextNumber('FORU',d.outletId,'transactionNumber'):null;
  return prisma.$transaction(async tx=>{
    const created=await tx.sale.create({data:{businessId:req.user!.businessId,orderNumber,transactionNumber,outletId:d.outletId,cashierId:req.user!.id,cashSessionId:d.cashSessionId,customerName,customerPhone:d.customerPhone?.trim()||null,tableNumber:d.tableNumber?.trim()||null,orderNote:d.orderNote?.trim()||null,orderType:d.orderType||'DINE_IN',orderSource:'POS',subtotal:totals.gross,discountAmount:money(totals.productDiscount+totals.transactionDiscount+totals.couponDiscount),totalAmount:totals.grand,subtotalBeforeDiscount:totals.gross,productDiscountTotal:totals.productDiscount,transactionDiscountAmount:totals.transactionDiscount,couponCode:totals.couponResult?.coupon.couponCode,couponDiscountAmount:totals.couponDiscount,grandTotal:totals.grand,totalHpp:totals.totalHpp,grossProfit:paid?money(totals.grand-totals.totalHpp):0,paymentMethod:paid?d.paymentMethod:undefined,cashReceived:paid?d.cashReceived:undefined,changeAmount:paid&&d.paymentMethod==='CASH'?money((d.cashReceived||0)-totals.grand):undefined,status:paid?'PAID':'PENDING_PAYMENT',paidAt:paid?new Date():undefined,items:{create:totals.lines.map(saleItemCreate)}},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});
    if(paid)await deductInventoryForPaidSale(tx,created,req.user!.id);
    if(paid&&totals.couponResult){await tx.coupon.update({where:{id:totals.couponResult.coupon.id},data:{usedCount:{increment:1}}});await tx.couponUsage.create({data:{couponId:totals.couponResult.coupon.id,saleId:created.id,outletId:d.outletId,cashierId:req.user!.id}});}
    if(d.idempotencyKey)await tx.idempotencyKey.create({data:{key:d.idempotencyKey,entityType:paid?'SALE':'ORDER',entityId:created.id}});
    return created;
  });
}
api.post('/orders',asyncRoute(async(req,res)=>res.status(201).json(await createOrder(req,saleInput.parse(req.body),false))));
api.post('/sales',asyncRoute(async(req,res)=>res.status(201).json(await createOrder(req,saleInput.parse(req.body),true))));
function queryDateRange(query:any){const from=String(query.from||query.date||'');const to=String(query.to||query.date||'');if(from&&to){const start=new Date(`${from}T00:00:00+07:00`),end=new Date(`${to}T00:00:00+07:00`);end.setDate(end.getDate()+1);return {gte:start,lt:end};}return query.date?dayRange(String(query.date)):undefined;}
async function requiredOutletId(req:any){const outletId=String(req.query.outletId||req.query.outlet_id||'');if(!outletId)throw new ApiError(400,'outletId wajib dipilih untuk laporan operasional.');await assertTenantOutlet(req,outletId);return outletId;}
async function ordersBaseWhere(req:any){const where:any=tenantWhereAnd(req,{outletId:await requiredOutletId(req)});const range=queryDateRange(req.query);if(range)where.createdAt=range;return where;}
type ReportLine={saleId:string;productId:string;productName:string;categoryId:string|null;categoryName:string;variantName:string;qty:number;gross:number;productDiscount:number;orderDiscount:number;discount:number;net:number;cogs:number;unitHpp:number;paymentMethod:string|null};
function saleItemCategory(item:any){return {categoryId:item.product?.categoryId||null,categoryName:item.product?.categoryRef?.name||item.product?.category||'Tanpa Kategori'};}
function roundReportLine(line:ReportLine){return {...line,gross:money(line.gross),productDiscount:money(line.productDiscount),orderDiscount:money(line.orderDiscount),discount:money(line.discount),net:money(line.net),cogs:money(line.cogs),unitHpp:money(line.unitHpp)};}
async function reportLines(req:any){
  const outletId=await requiredOutletId(req);
  const saleWhere:any=tenantWhereAnd(req,{outletId,status:'PAID'});
  const range=queryDateRange(req.query)||dayRange();
  saleWhere.createdAt=range;
  if(req.query.paymentMethod)saleWhere.paymentMethod=String(req.query.paymentMethod);
  const itemWhere:any={};
  if(req.query.productId)itemWhere.productId=String(req.query.productId);
  if(req.query.categoryId)itemWhere.product={is:{categoryId:String(req.query.categoryId)}};
  const sales=await prisma.sale.findMany({where:{...saleWhere,items:{some:itemWhere}},include:{items:{include:{product:{include:{categoryRef:true}}}}},orderBy:{createdAt:'desc'}});
  const lines:ReportLine[]=[];
  for(const sale of sales as any[]){
    const allItems=sale.items||[];
    const matching=allItems.filter((item:any)=>(!req.query.productId||item.productId===String(req.query.productId))&&(!req.query.categoryId||item.product?.categoryId===String(req.query.categoryId)));
    const saleLevelDiscount=Number(sale.transactionDiscountAmount||0)+Number(sale.couponDiscountAmount||0);
    const saleSubtotalAfterProduct=allItems.reduce((n:number,item:any)=>n+Number(item.subtotalAfterDiscount||0),0);
    for(const item of matching){
      const gross=Number(item.subtotal||Number(item.priceBeforeDiscount||item.sellingPrice||0)*Number(item.qty||0));
      const productDiscount=Number(item.discountAmount||0);
      const afterProduct=Number(item.subtotalAfterDiscount||gross-productDiscount);
      const orderDiscount=saleSubtotalAfterProduct>0?money(saleLevelDiscount*afterProduct/saleSubtotalAfterProduct):0;
      const cogs=Number(item.totalHpp||Number(item.finalUnitHpp||item.hpp||0)*Number(item.qty||0));
      const cat=saleItemCategory(item);
      lines.push(roundReportLine({saleId:sale.id,productId:item.productId,productName:item.productName,categoryId:cat.categoryId,categoryName:cat.categoryName,variantName:item.variantName||'Base',qty:Number(item.qty||0),gross,productDiscount,orderDiscount,discount:productDiscount+orderDiscount,net:afterProduct-orderDiscount,cogs,unitHpp:Number(item.finalUnitHpp||item.hpp||0),paymentMethod:sale.paymentMethod||null}));
    }
  }
  return lines;
}
function groupReport(lines:ReportLine[],key:(line:ReportLine)=>string,base:(line:ReportLine)=>any){
  const map=new Map<string,any>();
  for(const line of lines){
    const k=key(line),row=map.get(k)||{...base(line),qtySold:0,grossSales:0,discount:0,netSales:0,cogs:0,grossProfit:0,orderIds:new Set<string>(),unitHppTotal:0};
    row.qtySold+=line.qty; row.grossSales+=line.gross; row.discount+=line.discount; row.netSales+=line.net; row.cogs+=line.cogs; row.grossProfit+=line.net-line.cogs; row.unitHppTotal+=line.unitHpp*line.qty; row.orderIds.add(line.saleId); map.set(k,row);
  }
  return [...map.values()].map(row=>{const orderCount=row.orderIds.size;delete row.orderIds;const grossMarginPercent=row.netSales?money(row.grossProfit/row.netSales*100):0;const unitHpp=row.qtySold?money(row.unitHppTotal/row.qtySold):0;delete row.unitHppTotal;return {...row,orderCount,unitHpp,qtySold:Number(row.qtySold),grossSales:money(row.grossSales),discount:money(row.discount),netSales:money(row.netSales),cogs:money(row.cogs),grossProfit:money(row.grossProfit),grossMarginPercent};}).sort((a,b)=>b.qtySold-a.qtySold);
}
api.get('/reports/sales',allow('OWNER'),asyncRoute(async(req,res)=>{
  const lines=await reportLines(req);
  const saleIds=new Set(lines.map(x=>x.saleId));
  const grossSales=money(lines.reduce((n,x)=>n+x.gross,0)),discount=money(lines.reduce((n,x)=>n+x.discount,0)),netSales=money(lines.reduce((n,x)=>n+x.net,0));
  const byCategory=groupReport(lines,x=>x.categoryId||x.categoryName,x=>({categoryId:x.categoryId,category:x.categoryName}));
  const byProduct=groupReport(lines,x=>`${x.productId}:${x.variantName}`,x=>({productId:x.productId,productName:x.productName,categoryId:x.categoryId,category:x.categoryName,variant:x.variantName}));
  const topSellingProduct=byProduct[0]?{productId:byProduct[0].productId,productName:byProduct[0].productName,qty:byProduct[0].qtySold,netSales:byProduct[0].netSales}:null;
  const topCategory=byCategory[0]?{categoryId:byCategory[0].categoryId,category:byCategory[0].category,qty:byCategory[0].qtySold,netSales:byCategory[0].netSales}:null;
  res.json({summary:{totalOrder:saleIds.size,totalItemSold:lines.reduce((n,x)=>n+x.qty,0),grossSales,discount,netSales,averageOrderValue:saleIds.size?money(netSales/saleIds.size):0,topSellingProduct,topCategory},byCategory,byProduct});
}));
api.get('/reports/cogs',allow('OWNER'),asyncRoute(async(req,res)=>{
  const lines=await reportLines(req);
  const netSales=money(lines.reduce((n,x)=>n+x.net,0)),totalCogs=money(lines.reduce((n,x)=>n+x.cogs,0)),grossProfit=money(netSales-totalCogs);
  const byCategory=groupReport(lines,x=>x.categoryId||x.categoryName,x=>({categoryId:x.categoryId,category:x.categoryName}));
  const byProduct=groupReport(lines,x=>`${x.productId}:${x.variantName}`,x=>({productId:x.productId,productName:x.productName,categoryId:x.categoryId,category:x.categoryName,variant:x.variantName}));
  res.json({summary:{netSales,totalCogs,grossProfit,grossMarginPercent:netSales?money(grossProfit/netSales*100):0,totalItemSold:lines.reduce((n,x)=>n+x.qty,0)},byCategory,byProduct});
}));
api.get('/orders',asyncRoute(async(req,res)=>{const where:any=await ordersBaseWhere(req);if(req.query.status)where.status=String(req.query.status);if(req.query.customer_name)where.customerName={contains:String(req.query.customer_name),mode:'insensitive'};const open=String(req.query.status||'')==='OPEN_ORDER';res.json(await prisma.sale.findMany({where,include:{outlet:true,cashier:{select:{name:true}},items:{select:{id:true,productName:true,qty:true}}},orderBy:open?[{scheduledAt:{sort:'asc',nulls:'last'}},{createdAt:'asc'}]:{createdAt:'desc'},take:200}));}));
api.get('/orders/summary',asyncRoute(async(req,res)=>{
  const baseWhere=await ordersBaseWhere(req);
  const statusScope=['OPEN_ORDER','PENDING_PAYMENT','PAID','CANCELLED','VOID'];
  const [totalOrders,paidOrders,pendingOrders,cancelledOrders,paidAgg,itemAgg,topProducts]=await Promise.all([
    prisma.sale.count({where:{...baseWhere,status:{in:statusScope as any}}}),
    prisma.sale.count({where:{...baseWhere,status:'PAID'}}),
    prisma.sale.count({where:{...baseWhere,status:'PENDING_PAYMENT'}}),
    prisma.sale.count({where:{...baseWhere,status:'CANCELLED'}}),
    prisma.sale.aggregate({where:{...baseWhere,status:'PAID'},_sum:{grandTotal:true}}),
    prisma.saleItem.aggregate({where:{sale:{...baseWhere,status:'PAID'}},_sum:{qty:true}}),
    prisma.saleItem.groupBy({by:['productId','productName'],where:{sale:{...baseWhere,status:'PAID'}},_sum:{qty:true,subtotalAfterDiscount:true},orderBy:{_sum:{qty:'desc'}},take:1})
  ]);
  const top=topProducts[0];
  res.json({totalOrders,paidOrders,pendingOrders,cancelledOrders,totalItemsSold:Number(itemAgg._sum.qty||0),totalNominal:money(Number(paidAgg._sum.grandTotal||0)),topSellingProduct:top?{productId:top.productId,productName:top.productName,qty:Number(top._sum.qty||0),nominal:money(Number(top._sum.subtotalAfterDiscount||0))}:null});
}));
api.get('/orders/preorder-recap',asyncRoute(async(req,res)=>{
  const q=z.object({
    from:z.string().datetime(),
    to:z.string().datetime(),
    outletId:z.string().optional(),
    status:z.enum(['OPEN_ORDER','ACCEPTED','PENDING_PAYMENT','PAID','REJECTED','CANCELLED','COMPLETED','VOID']).optional()
  }).parse(req.query);
  const from=new Date(q.from),to=new Date(q.to);
  if(to<=from)throw new ApiError(400,'Periode Pre-Order tidak valid');
  if(to.getTime()-from.getTime()>93*86_400_000)throw new ApiError(400,'Periode maksimal 93 hari');
  const where:any=tenantWhereAnd(req,{isPreOrder:true,scheduledAt:{gte:from,lt:to}});
  if(q.outletId){await assertTenantOutlet(req,q.outletId);where.AND.push({outletId:q.outletId});}
  else if(req.user!.role!=='OWNER')where.AND.push({outletId:{in:req.user!.outletIds}});
  if(q.status)where.AND.push({status:q.status});
  else where.AND.push({status:{notIn:['CANCELLED','REJECTED','VOID']}});
  const orders=await prisma.sale.findMany({
    where,
    select:{id:true,orderNumber:true,customerName:true,customerPhone:true,orderType:true,status:true,scheduledAt:true,grandTotal:true,outlet:{select:{id:true,name:true,code:true,timezone:true}},items:{select:{id:true,productId:true,productName:true,variantName:true,selectedVariantsJson:true,itemNote:true,qty:true,addons:{select:{id:true,addonName:true}},product:{select:{categoryId:true,category:true,categoryRef:{select:{id:true,name:true,sortOrder:true}}}}}}},
    orderBy:[{scheduledAt:'asc'},{orderNumber:'asc'}],take:2000
  });
  res.json(orders.map(order=>({...order,grandTotal:Number(order.grandTotal),items:order.items.map(item=>({...item,category:{id:item.product.categoryRef?.id||item.product.categoryId,name:item.product.categoryRef?.name||item.product.category||'Tanpa Kategori',sortOrder:item.product.categoryRef?.sortOrder??9999},product:undefined}))})));
}));
api.get('/orders/open',asyncRoute(async(req,res)=>{const outletId=await requiredOutletId(req);res.json(await prisma.sale.findMany({where:tenantWhereAnd(req,{outletId,status:'OPEN_ORDER'}),include:{outlet:true,cashier:{select:{name:true}},items:{include:{addons:true}}},orderBy:[{scheduledAt:{sort:'asc',nulls:'last'}},{createdAt:'asc'}],take:100}));}));
api.post('/orders/:id/reject',asyncRoute(async(req,res)=>{const reason=z.object({reason:z.string().trim().min(3).max(250)}).parse(req.body).reason;const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');await assertTenantOutlet(req,sale.outletId);if(sale.status!=='OPEN_ORDER')throw new ApiError(400,'Hanya open order yang bisa ditolak');res.json(await prisma.$transaction(async tx=>{const updated=await tx.sale.update({where:{id:sale.id},data:{status:'REJECTED',rejectedAt:new Date(),rejectedByUserId:req.user!.id,rejectionReason:reason}});await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'ORDER',entityId:sale.id,action:'ORDER_REJECTED',oldValue:{status:sale.status},newValue:{status:'REJECTED',reason},changedBy:req.user!.id}});return updated;}));}));
api.get('/orders/:id',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)},include:{outlet:true,cashier:{select:{name:true}},items:{include:{addons:true}},printerLogs:{include:{printer:true,user:{select:{name:true}},},orderBy:{printedAt:'desc'}}}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(sale);}));
async function updatePendingOrder(req:any,id:string,d:z.infer<typeof saleInput>){
  const existing=await prisma.sale.findUnique({where:{id},include:{items:{include:{addons:true}}}});
  if(!existing) throw new ApiError(404,'Order tidak ditemukan');
  await assertTenantOutlet(req,existing.outletId);
  if(existing.status!=='PENDING_PAYMENT'&&existing.status!=='OPEN_ORDER') throw new ApiError(400,'Order sudah tidak bisa diedit karena status berubah.');
  if(d.outletId!==existing.outletId) throw new ApiError(400,'Outlet order tidak bisa diubah');
  const activeShift=await requireActiveShift(req,existing.outletId,d.cashSessionId);
  d={...d,cashSessionId:activeShift.id};
  const customerName=openBillCustomerName(d);
  const totals=await buildOrderTotals(req,d);
  return prisma.$transaction(async tx=>{
    await tx.saleItem.deleteMany({where:{saleId:id}});
    const updated=await tx.sale.update({where:{id},data:{customerName,customerPhone:d.customerPhone?.trim()||existing.customerPhone||null,tableNumber:d.tableNumber?.trim()||existing.tableNumber||null,orderNote:d.orderNote?.trim()||existing.orderNote||null,orderType:d.orderType||existing.orderType||'DINE_IN',status:'PENDING_PAYMENT',acceptedAt:existing.status==='OPEN_ORDER'?new Date():existing.acceptedAt,acceptedByUserId:existing.status==='OPEN_ORDER'?req.user!.id:existing.acceptedByUserId,cashierId:req.user!.id,cashSessionId:d.cashSessionId,subtotal:totals.gross,discountAmount:money(totals.productDiscount+totals.transactionDiscount+totals.couponDiscount),totalAmount:totals.grand,subtotalBeforeDiscount:totals.gross,productDiscountTotal:totals.productDiscount,transactionDiscountAmount:totals.transactionDiscount,couponCode:totals.couponResult?.coupon.couponCode,couponDiscountAmount:totals.couponDiscount,grandTotal:totals.grand,totalHpp:totals.totalHpp,grossProfit:0,paymentMethod:null,cashReceived:null,changeAmount:null,items:{create:totals.lines.map(saleItemCreate)}},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});
    await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'ORDER',entityId:id,action:'ORDER_UPDATED',oldValue:{customerName:existing.customerName,grandTotal:existing.grandTotal,items:existing.items},newValue:{customerName,grandTotal:updated.grandTotal,items:updated.items},changedBy:req.user!.id}});
    return updated;
  });
}
api.put('/orders/:id',asyncRoute(async(req,res)=>res.json(await updatePendingOrder(req,String(req.params.id),saleInput.parse(req.body)))));
api.post('/orders/:id/pay',asyncRoute(async(req,res)=>{const body=z.object({paymentMethod:z.enum(['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER']),cashReceived:z.number().nonnegative().optional(),cashSessionId:z.string().optional(),order:z.any().optional()}).parse(req.body);let sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');await assertTenantOutlet(req,sale.outletId);if(sale.status!=='PENDING_PAYMENT'&&sale.status!=='OPEN_ORDER')throw new ApiError(400,'Hanya pending order yang bisa dibayar');const oldStatus=sale.status;const activeShift=await requireActiveShift(req,sale.outletId,body.cashSessionId);if(body.order){sale=await updatePendingOrder(req,sale.id,saleInput.parse({...body.order,outletId:sale.outletId,cashSessionId:activeShift.id}));}const grand=Number(sale.grandTotal);if(body.paymentMethod==='CASH'&&(body.cashReceived??0)<grand)throw new ApiError(400,'Uang diterima kurang');const transactionNumber=await nextNumber('FORU',sale.outletId,'transactionNumber');res.json(await prisma.$transaction(async tx=>{const updated=await tx.sale.update({where:{id:sale!.id},data:{transactionNumber,status:'PAID',paidAt:new Date(),cashSessionId:activeShift.id,paymentMethod:body.paymentMethod,cashReceived:body.cashReceived,changeAmount:body.paymentMethod==='CASH'?money((body.cashReceived||0)-grand):0,grossProfit:money(grand-Number(sale!.totalHpp))},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});await deductInventoryForPaidSale(tx,updated,req.user!.id);if(updated.couponCode){const coupon=await tx.coupon.findFirst({where:tenantWhereAnd(req,{couponCode:updated.couponCode})});if(coupon){await tx.coupon.update({where:{id:coupon.id},data:{usedCount:{increment:1}}});await tx.couponUsage.create({data:{couponId:coupon.id,saleId:updated.id,outletId:updated.outletId,cashierId:req.user!.id}});}}await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'ORDER',entityId:updated.id,action:'ORDER_PAID',oldValue:{status:oldStatus},newValue:{status:'PAID',transactionNumber},changedBy:req.user!.id}});return updated;}));}));
api.post('/orders/:id/cancel',asyncRoute(async(req,res)=>{const reason=z.object({reason:z.string().min(3).optional()}).parse(req.body).reason;const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');await assertTenantOutlet(req,sale.outletId);if(sale.status!=='PENDING_PAYMENT'&&sale.status!=='DRAFT'&&sale.status!=='OPEN_ORDER')throw new ApiError(400,'Hanya pending order yang bisa dibatalkan');res.json(await prisma.$transaction(async tx=>{const updated=await tx.sale.update({where:{id:sale.id},data:{status:'CANCELLED',cancelledAt:new Date(),cancelReason:reason||'Cancelled by cashier'}});await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'ORDER',entityId:sale.id,action:'ORDER_CANCELLED',oldValue:{status:sale.status},newValue:{status:'CANCELLED',reason:updated.cancelReason},changedBy:req.user!.id}});return updated;}));}));
api.get('/sales',asyncRoute(async(req,res)=>{const where:any=tenantWhereAnd(req,{status:{in:['PAID','VOID']},outletId:await requiredOutletId(req)});if(req.query.date)where.createdAt=dayRange(String(req.query.date));if(req.query.payment_method)where.paymentMethod=req.query.payment_method;res.json(await prisma.sale.findMany({where,include:{outlet:true,cashier:{select:{name:true}}},orderBy:{createdAt:'desc'},take:200}));}));
api.get('/sales/:id',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)},include:{outlet:true,cashier:{select:{name:true}},items:{include:{addons:true}},printerLogs:{include:{printer:true,user:{select:{name:true}},},orderBy:{printedAt:'desc'}}}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(sale);}));
api.put('/sales/:id/customer',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const customerName=z.object({customerName:z.string().trim().optional()}).parse(req.body).customerName?.trim()||'Walk In';const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(await prisma.$transaction(async tx=>{const updated=await tx.sale.update({where:{id:sale.id},data:{customerName}});await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:'SALE',entityId:sale.id,action:'UPDATE_CUSTOMER_NAME',oldValue:{customerName:sale.customerName},newValue:{customerName},changedBy:req.user!.id}});return updated;}));}));
api.post('/sales/:id/void',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const reason=z.object({reason:z.string().min(5)}).parse(req.body).reason;const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)},include:{couponUsage:true}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');await assertTenantOutlet(req,sale.outletId);if(sale.status!=='PAID')throw new ApiError(400,'Hanya transaksi paid yang bisa void');res.json(await prisma.$transaction(async tx=>{if(sale.couponUsage){await tx.coupon.update({where:{id:sale.couponUsage.couponId},data:{usedCount:{decrement:1}}});await tx.couponUsage.delete({where:{saleId:sale.id}});}await returnInventoryForVoidedSale(tx,sale,req.user!.id);return tx.sale.update({where:{id:sale.id},data:{status:'VOID',voidReason:reason,voidedAt:new Date()}});}));}));

async function logPrintAttempt(saleId:string,userId:string,type:'CUSTOMER_RECEIPT'|'KITCHEN_TICKET'|'CUSTOMER_ITEM_LIST',forcedPrinterId?:string){
  const sale=await prisma.sale.findUnique({where:{id:saleId},include:{outlet:true}});
  if(!sale) throw new ApiError(404,'Transaksi tidak ditemukan');
  const printer=forcedPrinterId?await prisma.printer.findFirst({where:{id:forcedPrinterId,outletId:sale.outletId,status:'ACTIVE'}}):await prisma.printer.findFirst({where:{outletId:sale.outletId,status:'ACTIVE',...(type==='KITCHEN_TICKET'?{isKitchenPrinter:true}:{isCustomerReceipt:true})},orderBy:{createdAt:'asc'}});
  const status=printer?'SUCCESS':'FAILED';
  const errorMessage=printer?null:'Printer aktif belum disetting, gunakan browser print fallback';
  return prisma.printerLog.create({data:{businessId:sale.businessId,outletId:sale.outletId,saleId:sale.id,printerId:printer?.id,printType:type,status,errorMessage,printedBy:userId},include:{printer:true}});
}
api.post('/print/customer-receipt/:saleId',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.saleId)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'CUSTOMER_RECEIPT'));}));
api.post('/print/kitchen-ticket/:saleId',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.saleId)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'KITCHEN_TICKET'));}));
api.post('/print/reprint/:saleId',asyncRoute(async(req,res)=>{const d=z.object({printType:z.enum(['CUSTOMER_RECEIPT','KITCHEN_TICKET'])}).parse(req.body);const sale=await prisma.sale.findUnique({where:{id:String(req.params.saleId)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,d.printType));}));
api.post('/orders/:id/print/customer-item-list',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'CUSTOMER_ITEM_LIST'));}));
api.post('/orders/:id/print/kitchen-ticket',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');await assertTenantOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'KITCHEN_TICKET'));}));

const syncRow=z.object({local_id:z.string(),action:z.enum(['CREATE','UPDATE','DELETE','PAY','CANCEL','VOID','CLOSE_SHIFT','PRINT']),idempotency_key:z.string().min(8),payload_hash:z.string().optional(),payload:z.any()});
const syncPushBody=z.object({orders:z.array(syncRow).default([]),sales:z.array(syncRow).default([]),expenses:z.array(syncRow).default([]),cash_sessions:z.array(syncRow).default([]),printer_logs:z.array(syncRow).default([]),audit_logs:z.array(syncRow).default([]),variant_options:z.array(syncRow).default([])});
async function existingByKey(key:string){const found=await prisma.idempotencyKey.findUnique({where:{key}});return found?{local_id:null,server_id:found.entityId,sync_status:'SYNCED' as const,duplicate:true}:null;}
async function rememberKey(tx:any,key:string,entityType:string,entityId:string,payloadHash?:string){await tx.idempotencyKey.create({data:{key,entityType,entityId,payloadHash}});}
async function syncMasterData(req:any, incremental=false){
  const outletWhere=req.user!.role==='OWNER'?tenantWhere(req):tenantWhereAnd(req,{id:{in:req.user!.outletIds}});
  const outletIds=req.user!.role==='OWNER'?undefined:req.user!.outletIds;
  const since=req.query.last_sync_at?new Date(String(req.query.last_sync_at)):null;
  const changed=(where:any={})=>incremental&&since&&!Number.isNaN(since.getTime())?{...where,updatedAt:{gt:since}}:where;
  const [outlets,categories,products,variantGroups,coupons,printers,user]=await Promise.all([
    prisma.outlet.findMany({where:changed(outletWhere),orderBy:{name:'asc'}}),
    prisma.category.findMany({where:changed(tenantWhereAnd(req,{status:'ACTIVE'})),orderBy:[{sortOrder:'asc'},{name:'asc'}]}),
    prisma.product.findMany({where:changed(tenantWhereAnd(req,{status:'ACTIVE',...(outletIds?{outlets:{some:{outletId:{in:outletIds},isAvailable:true,status:'ACTIVE'}}}:{})})),include:productInclude,orderBy:{name:'asc'}}),
    prisma.variantGroup.findMany({where:changed(tenantWhereAnd(req,{status:'ACTIVE'})),include:{options:{where:{status:'ACTIVE'},orderBy:{sortOrder:'asc'},include:{outlets:true}}},orderBy:{name:'asc'}}),
    prisma.coupon.findMany({where:changed(tenantWhereAnd(req,{status:'ACTIVE'})),include:{outlets:true,products:true,categories:true}}),
    prisma.printer.findMany({where:changed(req.user!.role==='OWNER'?tenantWhere(req):tenantWhereAnd(req,{outletId:{in:req.user!.outletIds}})),orderBy:{createdAt:'desc'}}),
    prisma.user.findUnique({where:{id:req.user!.id},select:{id:true,name:true,username:true,role:true,outlets:true}})
  ]);
  return {outlets,categories,products,variantGroups,coupons,printers,user,incremental,serverTime:new Date().toISOString()};
}
api.get('/sync/master-data',asyncRoute(async(req,res)=>res.json(await syncMasterData(req))));
api.get('/sync/bootstrap',asyncRoute(async(req,res)=>res.json(await syncMasterData(req))));
api.get('/sync/pull',asyncRoute(async(req,res)=>res.json(await syncMasterData(req,true))));
api.get('/sync/status',asyncRoute(async(req,res)=>{res.json({online:true,serverTime:new Date().toISOString()});}));
api.post('/sync/status',asyncRoute(async(req,res)=>{const d=z.object({action:z.enum(['MANUAL_SYNC','AUTO_SYNC','SYNC_FAILED']),startedAt:z.string().optional(),finishedAt:z.string().optional(),duration:z.number().optional(),recordsUploaded:z.number().optional(),recordsDownloaded:z.number().optional(),failedRecords:z.number().optional(),device:z.string().optional(),error:z.string().optional()}).parse(req.body);await prisma.auditLog.create({data:{businessId:req.user!.businessId,entityType:'SYNC',entityId:req.user!.id,action:d.action,oldValue:Prisma.JsonNull,newValue:d as any,changedBy:req.user!.id}});res.json({ok:true});}));
api.post('/sync/push',asyncRoute(async(req,res)=>{
  const startedAt=new Date();
  const d=syncPushBody.parse(req.body);
  const results:any[]=[];
  let uploaded=0,failed=0;
  async function pushResult(row:z.infer<typeof syncRow>,entityType:string,fn:()=>Promise<any>){
    try{const duplicate=await existingByKey(row.idempotency_key);if(duplicate){results.push({...duplicate,local_id:row.local_id});return;}const created=await fn();uploaded++;results.push({local_id:row.local_id,server_id:created.id,order_number:created.orderNumber,transaction_number:created.transactionNumber,sync_status:'SYNCED'});}
    catch(error){failed++;results.push({local_id:row.local_id,entity_type:entityType,sync_status:'FAILED',error:(error as Error).message});}
  }
  for(const row of d.orders)await pushResult(row,'ORDER',()=>createOrder(req,saleInput.parse({...row.payload,idempotencyKey:row.idempotency_key}),false));
  for(const row of d.sales)await pushResult(row,'SALE',()=>createOrder(req,saleInput.parse({...row.payload,idempotencyKey:row.idempotency_key}),true));
  for(const row of d.expenses)await pushResult(row,'EXPENSE',async()=>{const body=expenseBody.parse(row.payload);const requestedOutletId=row.payload.outletId;const active=await prisma.cashSession.findFirst({where:{status:'OPEN',...(requestedOutletId?{outletId:requestedOutletId}:req.user!.role==='OWNER'?{}:{outletId:{in:req.user!.outletIds}})},orderBy:{openedAt:'desc'}});const outletId=requestedOutletId||active?.outletId;if(!outletId)throw new ApiError(400,'Outlet pengeluaran offline tidak ditemukan');await assertTenantOutlet(req,outletId);const cat=body.categoryId?await prisma.expenseCategory.findFirst({where:tenantWhereAnd(req,{id:body.categoryId})}):null;return prisma.$transaction(async tx=>{const expense=await tx.expense.create({data:{businessId:req.user!.businessId,outletId,cashSessionId:row.payload.cashSessionId||active?.id,cashierId:req.user!.id,categoryId:cat?.id,categoryName:cat?.name||row.payload.categoryName||'Lain-lain',description:body.description,amount:body.amount,paymentSource:body.paymentSource,note:body.note,receiptImageUrl:body.receiptImageUrl}});await rememberKey(tx,row.idempotency_key,'EXPENSE',expense.id,row.payload_hash);return expense;});});
  for(const row of d.cash_sessions)await pushResult(row,'CASH_SESSION',async()=>{const payload=z.object({outletId:z.string(),openingCash:z.coerce.number().nonnegative(),closingCashActual:z.coerce.number().nonnegative().optional(),expectedCash:z.coerce.number().optional(),variance:z.coerce.number().optional(),status:z.enum(['OPEN','CLOSED']).optional()}).parse(row.payload);await assertTenantOutlet(req,payload.outletId);return prisma.$transaction(async tx=>{const session=await tx.cashSession.create({data:{businessId:req.user!.businessId,outletId:payload.outletId,cashierId:req.user!.id,openingCash:payload.openingCash,closingCashActual:payload.closingCashActual,expectedCash:payload.expectedCash,variance:payload.variance,status:payload.status||'OPEN',closedAt:payload.status==='CLOSED'?new Date():undefined}});await rememberKey(tx,row.idempotency_key,'CASH_SESSION',session.id,row.payload_hash);return session;});});
  for(const row of d.variant_options)await pushResult(row,'VARIANT_OPTION',async()=>{const payload=z.object({local_id:z.string(),server_id:z.string().nullable().optional(),variant_group_local_id:z.string(),variant_group_server_id:z.string().nullable().optional(),name:z.string().min(1),additional_price:z.coerce.number().nonnegative().default(0),hpp:z.coerce.number().nonnegative().default(0),sort_order:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE','DELETED']).default('ACTIVE'),deleted_at:z.string().nullable().optional()}).parse(row.payload);const groupId=payload.variant_group_server_id||payload.variant_group_local_id;if(!groupId||String(groupId).startsWith('local_'))throw new ApiError(409,'Variant group belum tersinkron. Sync group terlebih dahulu.');return prisma.$transaction(async tx=>{let option;if(row.action==='CREATE'){option=await tx.variantOption.create({data:{variantGroupId:groupId,name:payload.name,additionalPrice:payload.additional_price,hpp:payload.hpp,sortOrder:payload.sort_order,status:payload.status==='DELETED'?'INACTIVE':payload.status}});}else{const optionId=payload.server_id||payload.local_id;if(!optionId||String(optionId).startsWith('local_'))throw new ApiError(409,'Variant option server_id belum ada.');option=row.action==='DELETE'?await tx.variantOption.update({where:{id:optionId},data:{status:'INACTIVE'}}):await tx.variantOption.update({where:{id:optionId},data:{name:payload.name,additionalPrice:payload.additional_price,hpp:payload.hpp,sortOrder:payload.sort_order,status:payload.status==='DELETED'?'INACTIVE':payload.status}});}await rememberKey(tx,row.idempotency_key,'VARIANT_OPTION',option.id,row.payload_hash);return option;});});
  for(const row of d.printer_logs)await pushResult(row,'PRINTER_LOG',async()=>{const sale=await prisma.sale.findFirst({where:tenantWhereAnd(req,{id:String(row.payload.saleId)})});if(!sale)throw new ApiError(400,'Sale printer log tidak ditemukan');await assertTenantOutlet(req,sale.outletId);return prisma.$transaction(async tx=>{const log=await tx.printerLog.create({data:{businessId:req.user!.businessId,outletId:sale.outletId,saleId:sale.id,printerId:row.payload.printerId,printType:row.payload.printType,status:row.payload.status||'SUCCESS',errorMessage:row.payload.errorMessage,printedBy:req.user!.id}});await rememberKey(tx,row.idempotency_key,'PRINTER_LOG',log.id,row.payload_hash);return log;});});
  for(const row of d.audit_logs)await pushResult(row,'AUDIT_LOG',async()=>prisma.$transaction(async tx=>{const log=await tx.auditLog.create({data:{businessId:req.user!.businessId,entityType:row.payload.entityType||'OFFLINE',entityId:row.payload.entityId||row.local_id,action:row.payload.action||row.action,oldValue:row.payload.oldValue,newValue:row.payload.newValue,changedBy:req.user!.id}});await rememberKey(tx,row.idempotency_key,'AUDIT_LOG',log.id,row.payload_hash);return log;}));
  await prisma.auditLog.create({data:{businessId:req.user!.businessId,entityType:'SYNC',entityId:req.user!.id,action:failed?'SYNC_FAILED':'MANUAL_SYNC',oldValue:Prisma.JsonNull,newValue:{started_at:startedAt,finished_at:new Date(),duration:Date.now()-startedAt.getTime(),records_uploaded:uploaded,records_downloaded:0,failed_records:failed,device:req.headers['user-agent']},changedBy:req.user!.id}});
  res.json({ok:failed===0,uploaded,failed,results});
}));

async function report(req:any,consolidated=false){if(consolidated&&req.user.role!=='OWNER')throw new ApiError(403,'Hanya OWNER yang dapat melihat laporan konsolidasi.');const range=req.query.date?dayRange(String(req.query.date)):dayRange();const baseWhere:any=tenantWhereAnd(req,{createdAt:range});if(!consolidated)baseWhere.outletId=await requiredOutletId(req);const sales=await prisma.sale.findMany({where:{...baseWhere,status:'PAID'},include:{items:true,outlet:true}});const expenses=await prisma.expense.findMany({where:{...baseWhere,status:'ACTIVE'},include:{categoryRef:true,outlet:true}});const pending=await prisma.sale.aggregate({where:{...baseWhere,status:'PENDING_PAYMENT'},_count:true,_sum:{grandTotal:true}});const sum=(key:string)=>money(sales.reduce((n,s)=>n+Number((s as any)[key]),0));const gross=sum('subtotalBeforeDiscount'),productDiscount=sum('productDiscountTotal'),transactionDiscount=sum('transactionDiscountAmount'),couponDiscount=sum('couponDiscountAmount'),net=sum('grandTotal'),hpp=sum('totalHpp');const cashSales=money(sales.filter(s=>s.paymentMethod==='CASH').reduce((n,s)=>n+Number(s.grandTotal),0));const cashDrawerExpense=money(expenses.filter(e=>e.paymentSource==='CASH_DRAWER').reduce((n,e)=>n+Number(e.amount),0));const nonCashExpense=money(expenses.filter(e=>e.paymentSource==='NON_CASH').reduce((n,e)=>n+Number(e.amount),0));const ownerTransferExpense=money(expenses.filter(e=>e.paymentSource==='OWNER_TRANSFER').reduce((n,e)=>n+Number(e.amount),0));const expenseByCategory=[...expenses.reduce((m,e)=>{const k=e.categoryName||e.categoryRef?.name||'Lain-lain';m.set(k,(m.get(k)||0)+Number(e.amount));return m;},new Map<string,number>()).entries()].map(([category,amount])=>({category,amount:money(amount)}));return {grossSales:gross,productDiscount,transactionDiscount,couponDiscount,netSales:net,paidSalesAmount:net,pendingOrdersCount:pending._count,pendingOrdersAmount:money(Number(pending._sum.grandTotal||0)),totalHpp:hpp,grossProfit:money(net-hpp),grossMargin:net?money((net-hpp)/net*100):0,totalTransactions:sales.length,averageTicket:sales.length?money(net/sales.length):0,payments:Object.fromEntries(['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER'].map(p=>[p,money(sales.filter(s=>s.paymentMethod===p).reduce((n,s)=>n+Number(s.grandTotal),0))])),cashDrawerExpense,nonCashExpense,ownerTransferExpense,totalExpense:money(expenses.reduce((n,e)=>n+Number(e.amount),0)),expenseByCategory,netCashMovement:money(cashSales-cashDrawerExpense),sales};}
function dashboardPayload(r:any){const outlets=new Map<string,any>();for(const s of r.sales||[]){const x=outlets.get(s.outletId)||{outlet:s.outlet?.name||'Outlet',netSales:0,transactions:0,grossProfit:0};x.netSales+=Number(s.grandTotal);x.transactions++;x.grossProfit+=Number(s.grossProfit);outlets.set(s.outletId,x);}return {...r,sales:undefined,outlets:[...outlets.values()].map(x=>({...x,netSales:money(x.netSales),grossProfit:money(x.grossProfit),averageTicket:x.transactions?money(x.netSales/x.transactions):0}))};}
api.get('/reports/daily',allow('OWNER'),asyncRoute(async(req,res)=>{const r=await report(req);res.json({...r,sales:undefined});}));
api.get('/reports/dashboard',allow('OWNER'),asyncRoute(async(req,res)=>res.json(dashboardPayload(await report(req,String(req.query.consolidated||'')==='1')))));
api.get('/dashboard',requirePermission('dashboard.view'),asyncRoute(async(req,res)=>res.json(dashboardPayload(await report(req)))));
api.get('/dashboard/consolidated',allow('OWNER'),asyncRoute(async(req,res)=>res.json(dashboardPayload(await report(req,true)))));
api.get('/reports/products',allow('OWNER'),asyncRoute(async(req,res)=>{const r=await report(req);const map=new Map<string,any>();for(const s of r.sales)for(const i of s.items){const x=map.get(i.productId)||{productName:i.productName,qty:0,revenue:0,hpp:0};x.qty+=i.qty;x.revenue+=Number(i.subtotalAfterDiscount);x.hpp+=Number(i.totalHpp);map.set(i.productId,x);}res.json([...map.values()].map(x=>({...x,grossProfit:money(x.revenue-x.hpp)})).sort((a,b)=>b.qty-a.qty));}));
api.get('/reports/outlets',allow('OWNER'),asyncRoute(async(req,res)=>{const r=await report(req);const map=new Map<string,any>();for(const s of r.sales){const x=map.get(s.outletId)||{outlet:s.outlet.name,grossSales:0,netSales:0,discount:0,grossProfit:0,transactions:0};x.grossSales+=Number(s.subtotalBeforeDiscount);x.netSales+=Number(s.grandTotal);x.discount+=Number(s.discountAmount);x.grossProfit+=Number(s.grossProfit);x.transactions++;map.set(s.outletId,x);}res.json([...map.values()]);}));

app.use((err:any,_req:any,res:any,_next:any)=>{if(err instanceof z.ZodError)return res.status(400).json({message:err.issues[0]?.message||'Data tidak valid',issues:err.issues});if(err instanceof ApiError)return res.status(err.status).json({message:err.message});if(err instanceof Prisma.PrismaClientKnownRequestError&&err.code==='P2002')return res.status(409).json({message:'Data unik sudah digunakan'});console.error(err);res.status(500).json({message:'Terjadi kesalahan pada server'});});
const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`FORU POS API running on http://localhost:${port}`));

