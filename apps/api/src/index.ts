import 'dotenv/config';
import express from 'express';
import cors, { type CorsOptions } from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { allow, ApiError, assertOutlet, asyncRoute, auth, dayRange, money, prisma } from './lib.js';
import { discountAmount, priceCart, validateCoupon } from './discount.js';

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

app.use(cors(corsOptions));

app.use(express.json({
  limit: "5mb",
}));

app.use(express.urlencoded({
  extended: true,
  limit: "5mb",
}));
const api=express.Router(); app.use('/api',api);
api.get('/health',(_q,r)=>r.json({ok:true}));

api.post('/auth/login',asyncRoute(async(req,res)=>{
  const {username,password}=z.object({username:z.string(),password:z.string()}).parse(req.body);
  const user=await prisma.user.findUnique({where:{username},include:{outlets:true}});
  if(!user||user.status!=='ACTIVE'||!await bcrypt.compare(password,user.passwordHash)) throw new ApiError(401,'Username atau password salah');
  const outletIds=user.role==='OWNER'
    ? (await prisma.outlet.findMany({where:{status:'ACTIVE'},select:{id:true}})).map(x=>x.id)
    : user.outlets.filter(x=>x.status==='ACTIVE').map(x=>x.outletId);
  const payload={id:user.id,role:user.role,outletIds};
  await prisma.user.update({where:{id:user.id},data:{lastLogin:new Date()}});
  res.json({token:jwt.sign(payload,process.env.JWT_SECRET||'dev-secret',{expiresIn:'12h'}),user:{id:user.id,name:user.name,role:user.role,outletIds:payload.outletIds}});
}));
api.get('/auth/me',auth,asyncRoute(async(req,res)=>res.json(await prisma.user.findUnique({where:{id:req.user!.id},select:{id:true,name:true,username:true,role:true,status:true,lastLogin:true,outlets:{where:{status:'ACTIVE'},select:{outlet:true}}}}))));

api.use(auth);
const userSelect={id:true,name:true,username:true,role:true,status:true,lastLogin:true,createdAt:true,updatedAt:true,outlets:{where:{status:'ACTIVE' as const},include:{outlet:true},orderBy:{outlet:{name:'asc' as const}}}};
const userBase=z.object({
  name:z.string().min(2),
  username:z.string().min(3),
  password:z.string().min(8).optional(),
  confirmPassword:z.string().optional(),
  pin:z.string().regex(/^\d+$/,'PIN hanya boleh angka').optional().or(z.literal('')),
  role:z.enum(['OWNER','SUPERVISOR','CASHIER']),
  status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),
  outletIds:z.array(z.string()).default([])
});
const userBody=userBase.refine(d=>!d.password||d.password===d.confirmPassword,{message:'Password dan confirm password harus sama'})
  .refine(d=>d.role==='OWNER'||d.outletIds.length>0,{message:'Supervisor dan kasir minimal harus punya 1 outlet'});
const createUserBody=userBody.refine(d=>!!d.password,{message:'Password wajib diisi'});
const updateUserBody=userBase.partial().refine(d=>!d.password||d.password===d.confirmPassword,{message:'Password dan confirm password harus sama'});
async function assertNotLastOwner(userId:string,next?:{role?:string,status?:string}){
  const user=await prisma.user.findUnique({where:{id:userId}});
  if(!user)throw new ApiError(404,'User tidak ditemukan');
  const willRemainOwner=(next?.role??user.role)==='OWNER'&&(next?.status??user.status)==='ACTIVE';
  if(willRemainOwner)return user;
  if(user.role==='OWNER'&&user.status==='ACTIVE'){
    const owners=await prisma.user.count({where:{role:'OWNER',status:'ACTIVE',id:{not:userId}}});
    if(owners<1)throw new ApiError(400,'Tidak boleh menonaktifkan atau menghapus OWNER terakhir.');
  }
  return user;
}
async function syncUserOutlets(tx:any,userId:string,role:string,outletIds:string[]){
  if(role==='OWNER'){await tx.userOutlet.deleteMany({where:{userId}});return;}
  await tx.userOutlet.deleteMany({where:{userId,outletId:{notIn:outletIds}}});
  for(const outletId of outletIds)await tx.userOutlet.upsert({where:{userId_outletId:{userId,outletId}},update:{status:'ACTIVE'},create:{userId,outletId,status:'ACTIVE'}});
}
api.get('/users',allow('OWNER'),asyncRoute(async(req,res)=>{
  const where:any={};
  if(req.query.role)where.role=String(req.query.role);
  if(req.query.status)where.status=String(req.query.status);
  if(req.query.q){const q=String(req.query.q);where.OR=[{name:{contains:q,mode:'insensitive'}},{username:{contains:q,mode:'insensitive'}}];}
  if(req.query.outlet_id)where.outlets={some:{outletId:String(req.query.outlet_id),status:'ACTIVE'}};
  res.json(await prisma.user.findMany({where,select:userSelect,orderBy:{createdAt:'desc'}}));
}));
api.post('/users',allow('OWNER'),asyncRoute(async(req,res)=>{
  const d=createUserBody.parse(req.body);
  if(await prisma.user.findUnique({where:{username:d.username}}))throw new ApiError(409,'Username sudah digunakan');
  const passwordHash=await bcrypt.hash(d.password!,10);
  const pinHash=d.pin?await bcrypt.hash(d.pin,10):undefined;
  const created=await prisma.$transaction(async tx=>{
    const user=await tx.user.create({data:{name:d.name,username:d.username,passwordHash,pinHash,role:d.role,status:d.status}});
    await syncUserOutlets(tx,user.id,d.role,d.outletIds);
    await tx.auditLog.create({data:{entityType:'USER',entityId:user.id,action:'USER_CREATED',oldValue:Prisma.JsonNull,newValue:{name:d.name,username:d.username,role:d.role,status:d.status,outletIds:d.outletIds},changedBy:req.user!.id}});
    return tx.user.findUnique({where:{id:user.id},select:userSelect});
  });
  res.status(201).json(created);
}));
api.get('/users/:id',allow('OWNER'),asyncRoute(async(req,res)=>{
  const user=await prisma.user.findUnique({where:{id:String(req.params.id)},select:userSelect});
  if(!user)throw new ApiError(404,'User tidak ditemukan');
  res.json(user);
}));
api.put('/users/:id',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const d=updateUserBody.parse(req.body);
  const existing=await assertNotLastOwner(id,{role:d.role,status:d.status});
  if(d.username&&d.username!==existing.username&&await prisma.user.findUnique({where:{username:d.username}}))throw new ApiError(409,'Username sudah digunakan');
  if((d.role==='SUPERVISOR'||d.role==='CASHIER')&&(!d.outletIds||d.outletIds.length<1))throw new ApiError(400,'Supervisor dan kasir minimal harus punya 1 outlet');
  const data:any={name:d.name,username:d.username,role:d.role,status:d.status};
  if(d.password)data.passwordHash=await bcrypt.hash(d.password,10);
  if(d.pin)data.pinHash=await bcrypt.hash(d.pin,10);
  const updated=await prisma.$transaction(async tx=>{
    const user=await tx.user.update({where:{id},data});
    if(d.outletIds||d.role)await syncUserOutlets(tx,id,d.role||user.role,d.outletIds||[]);
    await tx.auditLog.create({data:{entityType:'USER',entityId:id,action:'USER_UPDATED',oldValue:{name:existing.name,username:existing.username,role:existing.role,status:existing.status},newValue:{...data,outletIds:d.outletIds},changedBy:req.user!.id}});
    return tx.user.findUnique({where:{id},select:userSelect});
  });
  res.json(updated);
}));
api.delete('/users/:id',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const existing=await assertNotLastOwner(id,{status:'INACTIVE'});
  const updated=await prisma.$transaction(async tx=>{
    const user=await tx.user.update({where:{id},data:{status:'INACTIVE'},select:userSelect});
    await tx.auditLog.create({data:{entityType:'USER',entityId:id,action:'USER_SOFT_DELETED',oldValue:{status:existing.status},newValue:{status:'INACTIVE'},changedBy:req.user!.id}});
    return user;
  });
  res.json(updated);
}));
api.post('/users/:id/reset-password',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const d=z.object({password:z.string().min(8),confirmPassword:z.string()}).refine(x=>x.password===x.confirmPassword,{message:'Password dan confirm password harus sama'}).parse(req.body);
  await prisma.user.update({where:{id},data:{passwordHash:await bcrypt.hash(d.password,10)}});
  await prisma.auditLog.create({data:{entityType:'USER',entityId:id,action:'USER_PASSWORD_RESET',oldValue:Prisma.JsonNull,newValue:{reset:true},changedBy:req.user!.id}});
  res.json({ok:true});
}));
api.get('/users/:id/outlets',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.userOutlet.findMany({where:{userId:String(req.params.id)},include:{outlet:true},orderBy:{outlet:{name:'asc'}}}))));
api.put('/users/:id/outlets',allow('OWNER'),asyncRoute(async(req,res)=>{
  const id=String(req.params.id);
  const user=await prisma.user.findUnique({where:{id}});
  if(!user)throw new ApiError(404,'User tidak ditemukan');
  const outletIds=z.object({outletIds:z.array(z.string())}).parse(req.body).outletIds;
  if(user.role!=='OWNER'&&outletIds.length<1)throw new ApiError(400,'Supervisor dan kasir minimal harus punya 1 outlet');
  const rows=await prisma.$transaction(async tx=>{await syncUserOutlets(tx,id,user.role,outletIds);await tx.auditLog.create({data:{entityType:'USER',entityId:id,action:'USER_OUTLETS_UPDATED',oldValue:Prisma.JsonNull,newValue:{outletIds},changedBy:req.user!.id}});return tx.userOutlet.findMany({where:{userId:id},include:{outlet:true},orderBy:{outlet:{name:'asc'}}});});
  res.json(rows);
}));
api.get('/outlets',asyncRoute(async(req,res)=>res.json(await prisma.outlet.findMany({where:req.user!.role==='OWNER'?{}:{id:{in:req.user!.outletIds}},orderBy:{name:'asc'}}))));
api.post('/outlets',allow('OWNER'),asyncRoute(async(req,res)=>res.status(201).json(await prisma.outlet.create({data:z.object({code:z.string().min(2),name:z.string().min(2),address:z.string().optional(),phone:z.string().optional()}).parse(req.body)}))));
api.put('/outlets/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.outlet.update({where:{id:String(req.params.id)},data:z.object({code:z.string().min(2).optional(),name:z.string().min(2).optional(),address:z.string().nullable().optional(),phone:z.string().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).optional()}).parse(req.body)}))));
api.delete('/outlets/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.outlet.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));

const printerBody=z.object({outletId:z.string(),printerName:z.string().min(2),printerType:z.enum(['THERMAL']).default('THERMAL'),connectionType:z.enum(['BLUETOOTH','USB','NETWORK','BROWSER']),paperSize:z.enum(['MM58','MM80']).default('MM58'),ipAddress:z.string().nullable().optional(),port:z.coerce.number().int().positive().nullable().optional(),bluetoothAddress:z.string().nullable().optional(),usbVendorId:z.string().nullable().optional(),usbProductId:z.string().nullable().optional(),isCustomerReceipt:z.coerce.boolean().default(false),isKitchenPrinter:z.coerce.boolean().default(false),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
api.get('/printers',allow('OWNER','SUPERVISOR','CASHIER'),asyncRoute(async(req,res)=>{const where:any={};if(req.query.outlet_id){assertOutlet(req,String(req.query.outlet_id));where.outletId=String(req.query.outlet_id);}else if(req.user!.role!=='OWNER')where.outletId={in:req.user!.outletIds};res.json(await prisma.printer.findMany({where,include:{outlet:true},orderBy:{createdAt:'desc'}}));}));
api.post('/printers',allow('OWNER'),asyncRoute(async(req,res)=>{const d=printerBody.parse(req.body);assertOutlet(req,d.outletId);res.status(201).json(await prisma.printer.create({data:d,include:{outlet:true}}));}));
api.put('/printers/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const d=printerBody.partial().parse(req.body);const existing=await prisma.printer.findUnique({where:{id:String(req.params.id)}});if(!existing)throw new ApiError(404,'Printer tidak ditemukan');assertOutlet(req,d.outletId||existing.outletId);res.json(await prisma.printer.update({where:{id:existing.id},data:d,include:{outlet:true}}));}));
api.delete('/printers/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.printer.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));

const categoryBody=z.object({name:z.string().min(2),description:z.string().nullable().optional(),sortOrder:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
api.get('/categories',asyncRoute(async(_q,res)=>res.json(await prisma.category.findMany({orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/categories',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.status(201).json(await prisma.category.create({data:categoryBody.parse(req.body)}))));
api.put('/categories/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.category.update({where:{id:String(req.params.id)},data:categoryBody.partial().parse(req.body)}))));
api.delete('/categories/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.category.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));

const variantGroupBase=z.object({name:z.string().min(2),description:z.string().nullable().optional(),minSelect:z.coerce.number().int().min(0).default(0),maxSelect:z.coerce.number().int().min(1).default(1),required:z.coerce.boolean().default(false),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),options:z.array(z.object({name:z.string().min(1),additionalPrice:z.coerce.number().nonnegative().default(0),hpp:z.coerce.number().nonnegative().default(0),sortOrder:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')})).optional()});
const variantGroupBody=variantGroupBase.refine(d=>d.maxSelect>=d.minSelect,{message:'Maksimal pilihan harus >= minimal pilihan'});
api.get('/variant-groups',asyncRoute(async(_q,res)=>res.json(await prisma.variantGroup.findMany({include:{options:{orderBy:{sortOrder:'asc'}}},orderBy:{name:'asc'}}))));
api.post('/variant-groups',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const d=variantGroupBody.parse(req.body);const {options,...data}=d;res.status(201).json(await prisma.variantGroup.create({data:{...data,options:{create:options||[]}},include:{options:true}}));}));
api.put('/variant-groups/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.variantGroup.update({where:{id:String(req.params.id)},data:variantGroupBase.omit({options:true}).partial().parse(req.body),include:{options:{orderBy:{sortOrder:'asc'}}}}))));
api.delete('/variant-groups/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.variantGroup.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));
api.post('/variant-groups/:id/options',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.status(201).json(await prisma.variantOption.create({data:{variantGroupId:String(req.params.id),...z.object({name:z.string().min(1),additionalPrice:z.coerce.number().nonnegative().default(0),hpp:z.coerce.number().nonnegative().default(0),sortOrder:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')}).parse(req.body)}}))));
api.put('/variant-options/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.variantOption.update({where:{id:String(req.params.id)},data:z.object({name:z.string().min(1).optional(),additionalPrice:z.coerce.number().nonnegative().optional(),hpp:z.coerce.number().nonnegative().optional(),sortOrder:z.coerce.number().int().optional(),status:z.enum(['ACTIVE','INACTIVE']).optional()}).parse(req.body)}))));
api.delete('/variant-options/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.variantOption.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));

const outletPricingInput=z.object({outletId:z.string(),isAvailable:z.coerce.boolean().default(true),outletPrice:z.coerce.number().nonnegative().nullable().optional(),outletHpp:z.coerce.number().nonnegative().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const productInput=z.object({name:z.string().min(2),categoryId:z.string().optional(),category:z.string().optional(),description:z.string().optional(),imageUrl:z.string().url().optional().or(z.literal('')),basePrice:z.coerce.number().nonnegative().optional(),baseHpp:z.coerce.number().nonnegative().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),variantGroupIds:z.array(z.string()).default([]),outletIds:z.array(z.string()).default([]),outletPricing:z.array(outletPricingInput).optional(),variants:z.array(z.object({variantName:z.string(),sellingPrice:z.coerce.number().nonnegative(),hpp:z.coerce.number().nonnegative()})).optional()});
const productInclude={categoryRef:true,variants:true,addons:true,outlets:{include:{outlet:true},orderBy:{outlet:{name:'asc' as const}}},variantGroups:{orderBy:{sortOrder:'asc' as const},include:{group:{include:{options:{orderBy:{sortOrder:'asc' as const},include:{outlets:{include:{outlet:true}}}}}}}}};
async function categoryName(categoryId?:string,category?:string){if(categoryId){const c=await prisma.category.findUnique({where:{id:categoryId}});if(!c)throw new ApiError(400,'Kategori tidak ditemukan');return c.name;} if(category)return category; throw new ApiError(400,'Kategori wajib diisi');}
api.get('/products',asyncRoute(async(_q,res)=>res.json(await prisma.product.findMany({include:productInclude,orderBy:{name:'asc'}}))));
api.get('/pos/products',asyncRoute(async(req,res)=>{ const outletId=String(req.query.outlet_id||''); assertOutlet(req,outletId); const products=await prisma.product.findMany({where:{status:'ACTIVE',outlets:{some:{outletId,isAvailable:true,isActive:true,status:'ACTIVE'}}},include:{categoryRef:true,outlets:{where:{outletId}},variants:{where:{status:'ACTIVE'}},addons:{where:{status:'ACTIVE'}},variantGroups:{orderBy:{sortOrder:'asc'},include:{group:{include:{options:{where:{status:'ACTIVE'},orderBy:{sortOrder:'asc'},include:{outlets:{where:{outletId}}}}}}}}},orderBy:{name:'asc'}});res.json(products.map(p=>{const po=p.outlets[0];return {...p,basePrice:po?.outletPrice??p.basePrice,baseHpp:po?.outletHpp??p.baseHpp,masterBasePrice:p.basePrice,masterBaseHpp:p.baseHpp,variantGroups:p.variantGroups.map(vg=>({...vg,group:{...vg.group,options:vg.group.options.filter(o=>!o.outlets[0]||o.outlets[0].status==='ACTIVE').map(o=>({...o,additionalPrice:o.outlets[0]?.additionalPrice??o.additionalPrice,hpp:o.outlets[0]?.hpp??o.hpp,masterAdditionalPrice:o.additionalPrice,masterHpp:o.hpp}))}}))};})); }));
api.post('/products',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const d=productInput.parse(req.body);
  const category=await categoryName(d.categoryId,d.category);
  const basePrice=d.basePrice??d.variants?.[0]?.sellingPrice??0,baseHpp=d.baseHpp??d.variants?.[0]?.hpp??0;
  let outletRows=(d.outletPricing??d.outletIds.map(outletId=>({outletId,isAvailable:true,status:'ACTIVE' as const,outletPrice:null,outletHpp:null}))).map(x=>({...x,outletPrice:x.outletPrice??null,outletHpp:x.outletHpp??null}));
  if(!outletRows.length){
    const outlets=await prisma.outlet.findMany({where:{status:'ACTIVE'},select:{id:true}});
    outletRows=outlets.map(o=>({outletId:o.id,isAvailable:true,status:'ACTIVE' as const,outletPrice:null,outletHpp:null}));
  }
  res.status(201).json(await prisma.product.create({data:{name:d.name,category,categoryId:d.categoryId,description:d.description,imageUrl:d.imageUrl||null,basePrice,baseHpp,status:d.status,variants:{create:d.variants?.length?d.variants:[{variantName:'Base',sellingPrice:basePrice,hpp:baseHpp}]},variantGroups:{create:d.variantGroupIds.map((variantGroupId,i)=>({variantGroupId,sortOrder:i}))},outlets:{create:outletRows.map(x=>({outletId:x.outletId,isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice,outletHpp:x.outletHpp}))}},include:productInclude}));
}));
api.put('/products/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{
  const d=productInput.partial().parse(req.body);
  const id=String(req.params.id);
  const category=d.categoryId||d.category?await categoryName(d.categoryId,d.category):undefined;
  res.json(await prisma.$transaction(async tx=>{
    const current=await tx.product.findUnique({where:{id},include:{outlets:true}});
    if(!current)throw new ApiError(404,'Produk tidak ditemukan');
    const oldBasePrice=Number(current.basePrice),oldBaseHpp=Number(current.baseHpp);
    if(d.variantGroupIds){await tx.productVariantGroup.deleteMany({where:{productId:id}});await tx.productVariantGroup.createMany({data:d.variantGroupIds.map((variantGroupId,i)=>({productId:id,variantGroupId,sortOrder:i})),skipDuplicates:true});}
    if(d.outletPricing){
      for(const x of d.outletPricing){
        const existing=current.outlets.find(o=>o.outletId===x.outletId);
        const rawPrice=x.outletPrice??null,rawHpp=x.outletHpp??null;
        const outletPrice=rawPrice!==null&&d.basePrice!==undefined&&Number(rawPrice)===oldBasePrice?d.basePrice:rawPrice;
        const outletHpp=rawHpp!==null&&d.baseHpp!==undefined&&Number(rawHpp)===oldBaseHpp?d.baseHpp:rawHpp;
        await tx.productOutlet.upsert({where:{productId_outletId:{productId:id,outletId:x.outletId}},update:{isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice,outletHpp},create:{productId:id,outletId:x.outletId,isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice,outletHpp}});
      }
    }else if(d.outletIds){await tx.productOutlet.deleteMany({where:{productId:id}});await tx.productOutlet.createMany({data:d.outletIds.map(outletId=>({productId:id,outletId,isAvailable:true,isActive:true,status:'ACTIVE'})),skipDuplicates:true});}
    const updated=await tx.product.update({where:{id},data:{name:d.name,category,categoryId:d.categoryId,description:d.description,imageUrl:d.imageUrl||undefined,basePrice:d.basePrice,baseHpp:d.baseHpp,status:d.status},include:productInclude});
    if(d.basePrice!==undefined||d.baseHpp!==undefined){
      const baseVariant=updated.variants.find(v=>v.variantName==='Base');
      if(baseVariant)await tx.productVariant.update({where:{id:baseVariant.id},data:{sellingPrice:d.basePrice??baseVariant.sellingPrice,hpp:d.baseHpp??baseVariant.hpp}});
    }
    return tx.product.findUniqueOrThrow({where:{id},include:productInclude});
  }));
}));
api.delete('/products/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.product.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));
api.get('/products/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const productId=String(req.params.id);const [outlets,rows]=await Promise.all([prisma.outlet.findMany({orderBy:{name:'asc'}}),prisma.productOutlet.findMany({where:{productId},include:{outlet:true}})]);res.json(outlets.map(outlet=>rows.find(r=>r.outletId===outlet.id)||{productId,outletId:outlet.id,outlet,isAvailable:false,isActive:false,outletPrice:null,outletHpp:null,status:'INACTIVE'}));}));
api.put('/products/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const productId=String(req.params.id);const rows=z.object({outlets:z.array(outletPricingInput)}).parse(req.body).outlets;res.json(await prisma.$transaction(async tx=>{for(const x of rows)await tx.productOutlet.upsert({where:{productId_outletId:{productId,outletId:x.outletId}},update:{isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice??null,outletHpp:x.outletHpp??null},create:{productId,outletId:x.outletId,isAvailable:x.isAvailable,isActive:x.isAvailable,status:x.status,outletPrice:x.outletPrice??null,outletHpp:x.outletHpp??null}});return tx.productOutlet.findMany({where:{productId},include:{outlet:true},orderBy:{outlet:{name:'asc'}}});}));}));
api.post('/products/:id/variant-groups',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const d=z.object({variantGroupId:z.string(),sortOrder:z.coerce.number().int().default(0)}).parse(req.body);res.status(201).json(await prisma.productVariantGroup.upsert({where:{productId_variantGroupId:{productId:String(req.params.id),variantGroupId:d.variantGroupId}},update:{sortOrder:d.sortOrder},create:{productId:String(req.params.id),...d}}));}));
api.delete('/products/:id/variant-groups/:groupId',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.productVariantGroup.delete({where:{productId_variantGroupId:{productId:String(req.params.id),variantGroupId:String(req.params.groupId)}}}))));
api.post('/products/:id/variants',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.status(201).json(await prisma.productVariant.create({data:{productId:String(req.params.id),...z.object({variantName:z.string(),sellingPrice:z.coerce.number(),hpp:z.coerce.number()}).parse(req.body)}}))));
api.put('/variants/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.productVariant.update({where:{id:String(req.params.id)},data:z.object({variantName:z.string().optional(),sellingPrice:z.coerce.number().optional(),hpp:z.coerce.number().optional(),status:z.enum(['ACTIVE','INACTIVE']).optional()}).parse(req.body)}))));
api.delete('/variants/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.productVariant.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));
const variantOptionOutletInput=z.object({outletId:z.string(),additionalPrice:z.coerce.number().nonnegative().nullable().optional(),hpp:z.coerce.number().nonnegative().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
api.get('/variant-options/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const variantOptionId=String(req.params.id);const [outlets,rows]=await Promise.all([prisma.outlet.findMany({orderBy:{name:'asc'}}),prisma.variantOptionOutlet.findMany({where:{variantOptionId},include:{outlet:true}})]);res.json(outlets.map(outlet=>rows.find(r=>r.outletId===outlet.id)||{variantOptionId,outletId:outlet.id,outlet,additionalPrice:null,hpp:null,status:'ACTIVE'}));}));
api.put('/variant-options/:id/outlets',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const variantOptionId=String(req.params.id);const rows=z.object({outlets:z.array(variantOptionOutletInput)}).parse(req.body).outlets;res.json(await prisma.$transaction(async tx=>{for(const x of rows)await tx.variantOptionOutlet.upsert({where:{variantOptionId_outletId:{variantOptionId,outletId:x.outletId}},update:{additionalPrice:x.additionalPrice??null,hpp:x.hpp??null,status:x.status},create:{variantOptionId,outletId:x.outletId,additionalPrice:x.additionalPrice??null,hpp:x.hpp??null,status:x.status}});return tx.variantOptionOutlet.findMany({where:{variantOptionId},include:{outlet:true}});}));}));

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
  assertOutlet(req,outletId);
  return prisma.cashSession.findFirst({where:{outletId,status:'OPEN'},include});
}
async function openOutletShift(req:any,outletId:string,openingCash:number){
  assertOutlet(req,outletId);
  const active=await prisma.cashSession.findFirst({where:{outletId,status:'OPEN'}});
  if(active)throw new ApiError(409,'Shift outlet masih aktif. Tidak perlu membuka shift baru.');
  return prisma.cashSession.create({data:{outletId,cashierId:req.user!.id,openingCash},include:activeShiftInclude});
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
api.get('/cash-sessions/active',asyncRoute(async(req,res)=>{const outletId=String(req.query.outletId||req.query.outlet_id||'');if(outletId)return res.json(shiftResponse(await findOutletShift(req,outletId)));const where:any={status:'OPEN'};if(req.user!.role!=='OWNER')where.outletId={in:req.user!.outletIds};res.json(shiftResponse(await prisma.cashSession.findFirst({where,include:activeShiftInclude,orderBy:{openedAt:'desc'}})));}));
api.get('/cash-sessions/reports',asyncRoute(async(req,res)=>{const consolidated=String(req.query.consolidated||'')==='1';if(consolidated&&req.user!.role!=='OWNER')throw new ApiError(403,'Hanya OWNER yang dapat melihat laporan konsolidasi.');const where:any={status:'CLOSED'};if(req.query.from||req.query.to){where.closedAt={};if(req.query.from)where.closedAt.gte=new Date(String(req.query.from)+'T00:00:00.000Z');if(req.query.to)where.closedAt.lte=new Date(String(req.query.to)+'T23:59:59.999Z');}if(!consolidated)where.outletId=requiredOutletId(req);if(req.query.cashierId)where.closedByUserId=String(req.query.cashierId);const rows=await prisma.cashSession.findMany({where,include:{outlet:true,cashier:{select:{id:true,name:true}},closedBy:{select:{id:true,name:true}},sales:true,expenses:{where:{status:'ACTIVE'}}},orderBy:{closedAt:'desc'},take:200});res.json(rows.map((s:any)=>{const paid=s.sales.filter((x:any)=>x.status==='PAID');const cash=paid.filter((x:any)=>x.paymentMethod==='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const nonCash=paid.filter((x:any)=>x.paymentMethod!=='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const expense=s.expenses.reduce((n:number,x:any)=>n+Number(x.amount),0);return {id:s.id,shiftNumber:shiftNumberOf(s),outlet:s.outlet,openedBy:s.cashier,closedBy:s.closedBy,openedAt:s.openedAt,closedAt:s.closedAt,totalOmset:money(paid.reduce((n:number,x:any)=>n+Number(x.grandTotal),0)),totalCash:money(cash),totalNonCash:money(nonCash),totalExpense:money(expense),expectedCash:money(Number(s.expectedCash||0)),actualCash:s.closingCashActual==null?null:money(Number(s.closingCashActual)),variance:s.variance==null?null:money(Number(s.variance))};}));}));
api.get('/cash-sessions/reports/consolidated',allow('OWNER'),asyncRoute(async(req,res)=>{const where:any={status:'CLOSED'};if(req.query.from||req.query.to){where.closedAt={};if(req.query.from)where.closedAt.gte=new Date(String(req.query.from)+'T00:00:00.000Z');if(req.query.to)where.closedAt.lte=new Date(String(req.query.to)+'T23:59:59.999Z');}if(req.query.cashierId)where.closedByUserId=String(req.query.cashierId);const rows=await prisma.cashSession.findMany({where,include:{outlet:true,cashier:{select:{id:true,name:true}},closedBy:{select:{id:true,name:true}},sales:true,expenses:{where:{status:'ACTIVE'}}},orderBy:{closedAt:'desc'},take:200});res.json(rows.map((s:any)=>{const paid=s.sales.filter((x:any)=>x.status==='PAID');const cash=paid.filter((x:any)=>x.paymentMethod==='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const nonCash=paid.filter((x:any)=>x.paymentMethod!=='CASH').reduce((n:number,x:any)=>n+Number(x.grandTotal),0);const expense=s.expenses.reduce((n:number,x:any)=>n+Number(x.amount),0);return {id:s.id,shiftNumber:shiftNumberOf(s),outlet:s.outlet,openedBy:s.cashier,closedBy:s.closedBy,openedAt:s.openedAt,closedAt:s.closedAt,totalOmset:money(paid.reduce((n:number,x:any)=>n+Number(x.grandTotal),0)),totalCash:money(cash),totalNonCash:money(nonCash),totalExpense:money(expense),expectedCash:money(Number(s.expectedCash||0)),actualCash:s.closingCashActual==null?null:money(Number(s.closingCashActual)),variance:s.variance==null?null:money(Number(s.variance))};}));}));
api.get('/cash-sessions/:id/close-report',asyncRoute(async(req,res)=>{const report=await buildShiftCloseReport(String(req.params.id));assertOutlet(req,report.outlet.id);res.json(report);}));
api.post('/cash-sessions/:id/print-close-report',asyncRoute(async(req,res)=>{const report=await buildShiftCloseReport(String(req.params.id));assertOutlet(req,report.outlet.id);const d=z.object({status:z.enum(['SUCCESS','FAILED']).default('SUCCESS'),errorMessage:z.string().nullable().optional(),printerId:z.string().nullable().optional()}).parse(req.body||{});const log=await prisma.printerLog.create({data:{outletId:report.outlet.id,cashSessionId:report.id,printerId:d.printerId||undefined,printType:'SHIFT_CLOSE_REPORT',status:d.status,errorMessage:d.errorMessage||undefined,printedBy:req.user!.id},include:{printer:true,user:{select:{name:true}}}});res.status(201).json(log);}));
async function requireActiveShift(req:any,outletId:string,cashSessionId?:string){
  assertOutlet(req,outletId);
  const active=await prisma.cashSession.findFirst({where:{outletId,status:'OPEN'}});
  if(!active)throw new ApiError(400,'Shift belum dibuka. Silakan buka kasir terlebih dahulu.');
  if(cashSessionId&&cashSessionId!==active.id&&!cashSessionId.startsWith('local_'))throw new ApiError(400,'Shift aktif tidak sesuai dengan transaksi.');
  return active;
}
api.post('/cash-sessions/:id/close',asyncRoute(async(req,res)=>{const session=await prisma.cashSession.findFirst({where:{id:String(req.params.id),status:'OPEN'},select:{outletId:true}});if(!session)throw new ApiError(404,'Shift aktif tidak ditemukan');const d=shiftCloseBody.parse(req.body);res.json(await closeOutletShift(req,session.outletId,d.closingCashActual));}));

const expenseCategoryBody=z.object({name:z.string().min(2),description:z.string().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),sortOrder:z.coerce.number().int().default(0)});
api.get('/expense-categories',asyncRoute(async(_req,res)=>res.json(await prisma.expenseCategory.findMany({orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/expense-categories',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.status(201).json(await prisma.expenseCategory.create({data:expenseCategoryBody.parse(req.body)}))));
api.put('/expense-categories/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.expenseCategory.update({where:{id:String(req.params.id)},data:expenseCategoryBody.partial().parse(req.body)}))));
api.delete('/expense-categories/:id',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>res.json(await prisma.expenseCategory.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));

const expenseBody=z.object({categoryId:z.string().optional(),description:z.string().min(2),amount:z.coerce.number().positive(),paymentSource:z.enum(['CASH_DRAWER','NON_CASH','OWNER_TRANSFER']).default('CASH_DRAWER'),note:z.string().nullable().optional(),receiptImageUrl:z.string().nullable().optional()});
const expenseInclude={outlet:true,cashier:{select:{name:true}},cashSession:true,categoryRef:true};
api.get('/expenses',asyncRoute(async(req,res)=>{const where:any={status:req.query.status?String(req.query.status):'ACTIVE',outletId:requiredOutletId(req)};if(req.query.cash_session_id)where.cashSessionId=String(req.query.cash_session_id);if(req.query.cashier_id)where.cashierId=String(req.query.cashier_id);if(req.query.category_id)where.categoryId=String(req.query.category_id);if(req.query.payment_source)where.paymentSource=String(req.query.payment_source);if(req.query.date)where.createdAt=dayRange(String(req.query.date));res.json(await prisma.expense.findMany({where,include:expenseInclude,orderBy:{createdAt:'desc'}}));}));
api.post('/expenses',asyncRoute(async(req,res)=>{const d=expenseBody.parse(req.body);const outletId=typeof req.body?.outletId==='string'?req.body.outletId:undefined;const where:any={status:'OPEN'};if(outletId){assertOutlet(req,outletId);where.outletId=outletId;}else if(req.user!.role!=='OWNER')where.outletId={in:req.user!.outletIds};const active=await prisma.cashSession.findFirst({where,include:{outlet:true},orderBy:{openedAt:'desc'}});if(!active)throw new ApiError(400,'Shift belum dibuka. Silakan buka kasir terlebih dahulu.');assertOutlet(req,active.outletId);const cat=d.categoryId?await prisma.expenseCategory.findUnique({where:{id:d.categoryId}}):null;if(d.categoryId&&!cat)throw new ApiError(400,'Kategori pengeluaran tidak ditemukan');res.status(201).json(await prisma.expense.create({data:{outletId:active.outletId,cashSessionId:active.id,cashierId:req.user!.id,categoryId:cat?.id,categoryName:cat?.name||'Lain-lain',description:d.description,amount:d.amount,paymentSource:d.paymentSource,note:d.note,receiptImageUrl:d.receiptImageUrl},include:expenseInclude}));}));
api.put('/expenses/:id',asyncRoute(async(req,res)=>{const d=expenseBody.partial().parse(req.body);const existing=await prisma.expense.findUnique({where:{id:String(req.params.id)},include:{cashSession:true}});if(!existing)throw new ApiError(404,'Pengeluaran tidak ditemukan');assertOutlet(req,existing.outletId);const isOwner=req.user!.role==='OWNER'||req.user!.role==='SUPERVISOR';if(!isOwner&&(existing.cashierId!==req.user!.id||existing.cashSession.status==='CLOSED'))throw new ApiError(403,'Pengeluaran tidak bisa diedit setelah shift ditutup');const cat=d.categoryId?await prisma.expenseCategory.findUnique({where:{id:d.categoryId}}):null;if(d.categoryId&&!cat)throw new ApiError(400,'Kategori pengeluaran tidak ditemukan');const updated=await prisma.expense.update({where:{id:existing.id},data:{categoryId:d.categoryId??existing.categoryId,categoryName:cat?.name??existing.categoryName,description:d.description,amount:d.amount,paymentSource:d.paymentSource,note:d.note,receiptImageUrl:d.receiptImageUrl},include:expenseInclude});await prisma.auditLog.create({data:{entityType:'EXPENSE',entityId:existing.id,action:'EXPENSE_UPDATED',oldValue:existing as any,newValue:updated as any,changedBy:req.user!.id}});res.json(updated);}));
api.delete('/expenses/:id',asyncRoute(async(req,res)=>{const existing=await prisma.expense.findUnique({where:{id:String(req.params.id)},include:{cashSession:true}});if(!existing)throw new ApiError(404,'Pengeluaran tidak ditemukan');assertOutlet(req,existing.outletId);const isOwner=req.user!.role==='OWNER'||req.user!.role==='SUPERVISOR';if(!isOwner&&(existing.cashierId!==req.user!.id||existing.cashSession.status==='CLOSED'))throw new ApiError(403,'Pengeluaran tidak bisa dihapus setelah shift ditutup');const updated=await prisma.expense.update({where:{id:existing.id},data:{status:'CANCELLED'},include:expenseInclude});await prisma.auditLog.create({data:{entityType:'EXPENSE',entityId:existing.id,action:'EXPENSE_CANCELLED',oldValue:existing as any,newValue:updated as any,changedBy:req.user!.id}});res.json(updated);}));

const inventoryAccess=allow('OWNER','SUPERVISOR');
const inventoryItemInclude:any={category:true,unit:true,stocks:{include:{warehouse:true},orderBy:{warehouseId:'asc'}}};
const inventoryItemBody=z.object({code:z.string().min(1),sku:z.string().trim().nullable().optional().transform(v=>v||null),barcode:z.string().trim().nullable().optional().transform(v=>v||null),name:z.string().min(2),categoryId:z.string(),unitId:z.string(),minimumStock:z.coerce.number().nonnegative().default(0),currentStock:z.coerce.number().nonnegative().default(0),averageCost:z.coerce.number().nonnegative().default(0),supplier:z.string().nullable().optional(),notes:z.string().nullable().optional(),photoUrl:z.string().nullable().optional(),stockAlertEnabled:z.coerce.boolean().default(false),stockAlertType:z.enum(['OUT_OF_STOCK','LOW_STOCK','CUSTOM_THRESHOLD']).default('LOW_STOCK'),stockAlertThreshold:z.coerce.number().nonnegative().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const warehouseBody=z.object({code:z.string().min(1),name:z.string().min(2),type:z.enum(['CENTRAL','PRODUCTION','OUTLET','VIRTUAL']).default('CENTRAL'),outletId:z.string().nullable().optional(),address:z.string().nullable().optional(),picName:z.string().nullable().optional(),phone:z.string().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
const inventoryLookupBody=z.object({name:z.string().min(1),sortOrder:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE')});
function inventoryDateRange(query:any){if(query.from&&query.to){const start=new Date(`${query.from}T00:00:00+07:00`),end=new Date(`${query.to}T00:00:00+07:00`);end.setDate(end.getDate()+1);return {gte:start,lt:end};}const period=String(query.period||'today'),now=new Date(),start=new Date(now);if(period==='week'){const day=(start.getDay()+6)%7;start.setDate(start.getDate()-day);start.setHours(0,0,0,0);}else if(period==='month'){start.setDate(1);start.setHours(0,0,0,0);}else start.setHours(0,0,0,0);return {gte:start,lte:now};}
async function getDefaultWarehouse(tx:any=prisma){let wh=await tx.inventoryWarehouse.findFirst({where:{status:'ACTIVE'},orderBy:{createdAt:'asc'}});if(!wh)wh=await tx.inventoryWarehouse.create({data:{code:'WH-DEFAULT',name:'Gudang Utama',type:'CENTRAL',status:'ACTIVE'}});return wh;}
async function warehouseIdOrDefault(id?:string|null,tx:any=prisma){if(id){const wh=await tx.inventoryWarehouse.findUnique({where:{id}});if(!wh||wh.status!=='ACTIVE')throw new ApiError(404,'Warehouse tidak ditemukan');return wh.id;}return (await getDefaultWarehouse(tx)).id;}
function invNo(prefix:string){return `${prefix}-${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')}-${Date.now().toString().slice(-6)}`;}
async function ensureInventoryStock(tx:any,warehouseId:string,itemId:string){return tx.inventoryStock.upsert({where:{warehouseId_inventoryItemId:{warehouseId,inventoryItemId:itemId}},create:{warehouseId,inventoryItemId:itemId,currentQty:0,reservedQty:0,availableQty:0,averageCost:0},update:{}});}
async function refreshLegacyItemStock(tx:any,itemId:string){const stocks=await tx.inventoryStock.findMany({where:{inventoryItemId:itemId}});const current=stocks.reduce((n:any,s:any)=>n+Number(s.currentQty),0);const value=stocks.reduce((n:any,s:any)=>n+Number(s.currentQty)*Number(s.averageCost),0);await tx.inventoryItem.update({where:{id:itemId},data:{currentStock:current,averageCost:current>0?money(value/current):0,stockAlertState:current>0?'NORMAL':undefined}});}
async function changeInventoryStock(tx:any,args:{warehouseId:string,itemId:string,qty:number,type:any,userId:string,unitCost?:number,reference?:string,referenceId?:string,referenceType?:string,remarks?:string}){const item=await tx.inventoryItem.findUnique({where:{id:args.itemId}});if(!item||item.status!=='ACTIVE')throw new ApiError(404,'Bahan baku tidak ditemukan');const stock=await ensureInventoryStock(tx,args.warehouseId,args.itemId);const before=Number(stock.currentQty);const isIn=['STOCK_IN','TRANSFER_IN','ADJUSTMENT_IN','OPNAME'].includes(args.type);const after=args.type==='OPNAME'?args.qty:(isIn?before+args.qty:before-args.qty);if(after<0)throw new ApiError(400,'Stok tidak mencukupi.');const unitCost=(args.unitCost??Number(stock.averageCost))||Number(item.averageCost)||0;const averageCost=args.type==='STOCK_IN'&&after>0?money(((before*Number(stock.averageCost))+(args.qty*unitCost))/after):Number(stock.averageCost);await tx.inventoryStock.update({where:{id:stock.id},data:{currentQty:after,availableQty:after-Number(stock.reservedQty),averageCost,lastMovementAt:new Date()}});const movement=await tx.inventoryMovement.create({data:{movementNumber:invNo('INV'),warehouseId:args.warehouseId,inventoryItemId:args.itemId,movementType:args.type,qty:args.type==='OPNAME'?Math.abs(after-before):args.qty,beforeQty:before,afterQty:after,unitCost,totalCost:money(Math.abs(after-before)*unitCost),referenceType:args.referenceType,reference:args.reference,referenceId:args.referenceId,remarks:args.remarks,createdBy:args.userId},include:{item:{include:inventoryItemInclude},warehouse:true,user:{select:{name:true}}}});await refreshLegacyItemStock(tx,args.itemId);return movement;}
function inventoryAlertThreshold(item:any){const type=item.stockAlertType||'LOW_STOCK';if(type==='OUT_OF_STOCK')return 0;if(type==='CUSTOM_THRESHOLD')return Number(item.stockAlertThreshold??0);return Number(item.minimumStock);}
function inventoryAlertBreached(item:any,current?:number){return Number(current??item.currentStock)<=inventoryAlertThreshold(item);}
function inventoryAlertTitle(item:any,current?:number){return item.stockAlertType==='OUT_OF_STOCK'||Number(current??item.currentStock)<=0?'Stok bahan kosong':'Stok bahan menipis';}
function inventoryAlertMessage(item:any,outletName?:string,current?:number){const unit=item.unit?.name||'';const where=outletName?` di outlet ${outletName}`:'';if(item.stockAlertType==='OUT_OF_STOCK'||Number(current??item.currentStock)<=0)return `${item.name} sudah habis${where}.`;return `${item.name} tersisa ${Number(current??item.currentStock)} ${unit}. Minimum/threshold ${inventoryAlertThreshold(item)} ${unit}.`.replace(/\s+\./,'.');}
api.get('/warehouses',inventoryAccess,asyncRoute(async(req,res)=>{const where:any={};if(req.query.status)where.status=String(req.query.status);if(req.query.q){const q=String(req.query.q);where.OR=[{name:{contains:q,mode:'insensitive'}},{code:{contains:q,mode:'insensitive'}}];}res.json(await prisma.inventoryWarehouse.findMany({where,include:{outlet:true},orderBy:{name:'asc'}}));}));
api.post('/warehouses',inventoryAccess,asyncRoute(async(req,res)=>{const d=warehouseBody.parse(req.body);if(d.outletId)assertOutlet(req,d.outletId);if(await prisma.inventoryWarehouse.findUnique({where:{code:d.code}}))throw new ApiError(409,'Kode warehouse sudah digunakan');res.status(201).json(await prisma.inventoryWarehouse.create({data:d,include:{outlet:true}}));}));
api.put('/warehouses/:id',inventoryAccess,asyncRoute(async(req,res)=>{const d=warehouseBody.partial().parse(req.body);if(d.outletId)assertOutlet(req,d.outletId);res.json(await prisma.inventoryWarehouse.update({where:{id:String(req.params.id)},data:d,include:{outlet:true}}));}));
api.delete('/warehouses/:id',inventoryAccess,asyncRoute(async(req,res)=>res.json(await prisma.inventoryWarehouse.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));
api.get('/inventory/warehouses',inventoryAccess,asyncRoute(async(req,res)=>{
  const where:any={};
  if(req.query.status)where.status=String(req.query.status);
  res.json(await prisma.inventoryWarehouse.findMany({where,include:{outlet:true},orderBy:{name:'asc'}}));
}));
api.get('/inventory/categories',inventoryAccess,asyncRoute(async(_req,res)=>res.json(await prisma.inventoryCategory.findMany({orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/inventory/categories',inventoryAccess,asyncRoute(async(req,res)=>{const d=inventoryLookupBody.parse(req.body);if(await prisma.inventoryCategory.findUnique({where:{name:d.name}}))throw new ApiError(409,'Kategori inventory sudah ada.');res.status(201).json(await prisma.inventoryCategory.create({data:d}));}));
api.get('/inventory/units',inventoryAccess,asyncRoute(async(_req,res)=>res.json(await prisma.inventoryUnit.findMany({orderBy:[{sortOrder:'asc'},{name:'asc'}]}))));
api.post('/inventory/units',inventoryAccess,asyncRoute(async(req,res)=>{const d=inventoryLookupBody.parse(req.body);if(await prisma.inventoryUnit.findUnique({where:{name:d.name}}))throw new ApiError(409,'Satuan inventory sudah ada.');res.status(201).json(await prisma.inventoryUnit.create({data:d}));}));
api.get('/inventory/items',inventoryAccess,asyncRoute(async(req,res)=>{const where:any={};if(req.query.q){const q=String(req.query.q);where.OR=[{name:{contains:q,mode:'insensitive'}},{code:{contains:q,mode:'insensitive'}},{sku:{contains:q,mode:'insensitive'}},{barcode:{contains:q,mode:'insensitive'}}];}if(req.query.category_id)where.categoryId=String(req.query.category_id);if(req.query.status)where.status=String(req.query.status);res.json(await prisma.inventoryItem.findMany({where,include:inventoryItemInclude,orderBy:{name:'asc'}}));}));
api.get('/inventory/search',inventoryAccess,asyncRoute(async(req,res)=>{const q=String(req.query.q||req.query.sku||req.query.barcode||'').trim();if(!q)throw new ApiError(400,'Query wajib diisi.');res.json(await prisma.inventoryItem.findMany({where:{OR:[{sku:{equals:q,mode:'insensitive'}},{barcode:{equals:q,mode:'insensitive'}},{code:{equals:q,mode:'insensitive'}},{sku:{contains:q,mode:'insensitive'}},{barcode:{contains:q,mode:'insensitive'}},{code:{contains:q,mode:'insensitive'}},{name:{contains:q,mode:'insensitive'}}]},include:inventoryItemInclude,orderBy:[{sku:'asc'},{name:'asc'}],take:20}));}));
api.get('/inventory/items/by-sku/:sku',inventoryAccess,asyncRoute(async(req,res)=>{const sku=String(req.params.sku).trim();const item=await prisma.inventoryItem.findFirst({where:{OR:[{sku:{equals:sku,mode:'insensitive'}},{barcode:{equals:sku,mode:'insensitive'}}]},include:inventoryItemInclude});if(!item)throw new ApiError(404,'Barang belum terdaftar.');res.json(item);}));
api.post('/inventory/items',inventoryAccess,asyncRoute(async(req,res)=>{const d=inventoryItemBody.parse(req.body);if(await prisma.inventoryItem.findUnique({where:{code:d.code}}))throw new ApiError(409,'Kode bahan baku sudah digunakan');if(d.sku&&await prisma.inventoryItem.findFirst({where:{sku:{equals:d.sku,mode:'insensitive'}}}))throw new ApiError(409,'SKU sudah digunakan.');if(d.barcode&&await prisma.inventoryItem.findFirst({where:{barcode:{equals:d.barcode,mode:'insensitive'}}}))throw new ApiError(409,'Barcode sudah digunakan.');const warehouseId=await warehouseIdOrDefault(String(req.body.warehouseId||''));res.status(201).json(await prisma.$transaction(async tx=>{const item=await tx.inventoryItem.create({data:d,include:inventoryItemInclude});if(Number(d.currentStock)>0){await ensureInventoryStock(tx,warehouseId,item.id);await changeInventoryStock(tx,{warehouseId,itemId:item.id,qty:Number(d.currentStock),type:'STOCK_IN',userId:req.user!.id,unitCost:Number(d.averageCost),reference:'Initial Stock',referenceType:'INITIAL'});}return tx.inventoryItem.findUnique({where:{id:item.id},include:inventoryItemInclude});}));}));
api.put('/inventory/items/:id',inventoryAccess,asyncRoute(async(req,res)=>{const d=inventoryItemBody.partial().parse(req.body);const id=String(req.params.id);const existing=await prisma.inventoryItem.findUnique({where:{id}});if(!existing)throw new ApiError(404,'Bahan baku tidak ditemukan');if(d.code&&d.code!==existing.code&&await prisma.inventoryItem.findUnique({where:{code:d.code}}))throw new ApiError(409,'Kode bahan baku sudah digunakan');if(d.sku&&d.sku!==existing.sku&&await prisma.inventoryItem.findFirst({where:{sku:{equals:d.sku,mode:'insensitive'},NOT:{id}}}))throw new ApiError(409,'SKU sudah digunakan.');if(d.barcode&&d.barcode!==existing.barcode&&await prisma.inventoryItem.findFirst({where:{barcode:{equals:d.barcode,mode:'insensitive'},NOT:{id}}}))throw new ApiError(409,'Barcode sudah digunakan.');res.json(await prisma.inventoryItem.update({where:{id},data:d,include:inventoryItemInclude}));}));
api.delete('/inventory/items/:id',inventoryAccess,asyncRoute(async(req,res)=>res.json(await prisma.inventoryItem.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'},include:inventoryItemInclude}))));
api.get('/inventory/stocks',inventoryAccess,asyncRoute(async(req,res)=>{const where:any={};if(req.query.warehouseId)where.warehouseId=String(req.query.warehouseId);if(req.query.itemId)where.inventoryItemId=String(req.query.itemId);res.json(await prisma.inventoryStock.findMany({where,include:{warehouse:true,item:{include:inventoryItemInclude}},orderBy:{updatedAt:'desc'}}));}));
api.get('/inventory/dashboard',inventoryAccess,asyncRoute(async(req,res)=>{const warehouseId=req.query.warehouseId?String(req.query.warehouseId):undefined;const range=inventoryDateRange(req.query);const [stocks,items,movements]=await Promise.all([prisma.inventoryStock.findMany({where:{...(warehouseId?{warehouseId}:{}),item:{status:'ACTIVE'}},include:{item:true}}),prisma.inventoryItem.findMany({where:{status:'ACTIVE'}}),prisma.inventoryMovement.findMany({where:{createdAt:range,...(warehouseId?{warehouseId}:{}),},include:{item:true,warehouse:true},orderBy:{createdAt:'desc'},take:20})]);const totalStockValue=money(stocks.reduce((n,s)=>n+Number(s.currentQty)*Number(s.averageCost),0));const lowStock=stocks.filter(s=>Number(s.currentQty)>0&&Number(s.currentQty)<=Number(s.item.minimumStock)).length;const outOfStock=stocks.filter(s=>Number(s.currentQty)<=0).length;const by=(types:string[])=>movements.filter(m=>types.includes(String(m.movementType))).reduce((n,m)=>n+Number(m.qty),0);res.json({totalItems:warehouseId?new Set(stocks.map(s=>s.inventoryItemId)).size:items.length,totalStockValue,lowStock,outOfStock,chart:{stockIn:by(['STOCK_IN','TRANSFER_IN','ADJUSTMENT_IN']),stockOut:by(['STOCK_OUT','TRANSFER_OUT','ADJUSTMENT_OUT']),adjustment:by(['ADJUSTMENT','ADJUSTMENT_IN','ADJUSTMENT_OUT','OPNAME'])},recentMovements:movements});}));
api.get('/inventory/summary',inventoryAccess,asyncRoute(async(req,res)=>{req.query.period=req.query.period||'today';const warehouseId=req.query.warehouseId?`?warehouseId=${req.query.warehouseId}&period=${req.query.period}`:`?period=${req.query.period}`;res.redirect(307,`/api/inventory/dashboard${warehouseId}`);}));
api.get('/inventory/movements',inventoryAccess,asyncRoute(async(req,res)=>{const where:any={};if(req.query.warehouseId)where.warehouseId=String(req.query.warehouseId);if(req.query.item_id)where.inventoryItemId=String(req.query.item_id);if(req.query.type)where.movementType=String(req.query.type);res.json(await prisma.inventoryMovement.findMany({where,include:{item:{include:inventoryItemInclude},warehouse:true,user:{select:{name:true}}},orderBy:{createdAt:'desc'},take:300}));}));
api.get('/inventory/history',inventoryAccess,asyncRoute(async(req,res)=>{const where:any={};if(req.query.warehouseId)where.warehouseId=String(req.query.warehouseId);if(req.query.item_id)where.inventoryItemId=String(req.query.item_id);if(req.query.type)where.movementType=String(req.query.type);res.json(await prisma.inventoryMovement.findMany({where,include:{item:{include:inventoryItemInclude},warehouse:true,user:{select:{name:true}}},orderBy:{createdAt:'desc'},take:300}));}));
api.get('/inventory/alerts',inventoryAccess,asyncRoute(async(_req,res)=>res.json(await prisma.inventoryAlertLog.findMany({include:{item:{include:inventoryItemInclude}},orderBy:{sentAt:'desc'},take:200}))));
api.get('/inventory/alerts/check',inventoryAccess,asyncRoute(async(req,res)=>{const warehouseId=req.query.warehouseId?String(req.query.warehouseId):undefined;let outletName='';if(req.query.outletId){assertOutlet(req,String(req.query.outletId));const outlet=await prisma.outlet.findUnique({where:{id:String(req.query.outletId)},select:{name:true}});outletName=outlet?.name||'';}const stocks=await prisma.inventoryStock.findMany({where:{...(warehouseId?{warehouseId}:{}),item:{status:'ACTIVE',stockAlertEnabled:true}},include:{item:{include:{category:true,unit:true}}}});const cutoff=new Date(Date.now()-6*60*60*1000);const alerts=[];for(const stock of stocks){const item=stock.item,current=Number(stock.currentQty);if(!inventoryAlertBreached(item,current)){if(item.stockAlertState!=='NORMAL')await prisma.inventoryItem.update({where:{id:item.id},data:{stockAlertState:'NORMAL'}});continue;}if(item.stockAlertState==='ALERTED'&&item.lastStockAlertAt&&item.lastStockAlertAt>cutoff)continue;alerts.push({inventoryItemId:item.id,itemName:item.name,unit:item.unit?.name,alertType:item.stockAlertType,currentStock:current,threshold:inventoryAlertThreshold(item),title:inventoryAlertTitle(item,current),message:inventoryAlertMessage(item,outletName,current)});}res.json(alerts);}));
api.post('/inventory/alert-logs',inventoryAccess,asyncRoute(async(req,res)=>{const d=z.object({inventoryItemId:z.string(),alertType:z.enum(['OUT_OF_STOCK','LOW_STOCK','CUSTOM_THRESHOLD']),currentStock:z.coerce.number(),threshold:z.coerce.number().nullable().optional(),title:z.string().min(1),message:z.string().min(1),status:z.enum(['SENT','FAILED']).default('SENT'),errorMessage:z.string().nullable().optional()}).parse(req.body);const item=await prisma.inventoryItem.findUnique({where:{id:d.inventoryItemId}});if(!item)throw new ApiError(404,'Bahan baku tidak ditemukan');const log=await prisma.inventoryAlertLog.create({data:{inventoryItemId:d.inventoryItemId,alertType:d.alertType,currentStock:d.currentStock,threshold:d.threshold??null,title:d.title,message:d.message,status:d.status,errorMessage:d.errorMessage??null},include:{item:{include:inventoryItemInclude}}});await prisma.inventoryItem.update({where:{id:d.inventoryItemId},data:{lastStockAlertAt:new Date(),stockAlertState:'ALERTED'}});res.status(201).json(log);}));
api.post('/inventory/stock-in',inventoryAccess,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),date:z.string().optional(),supplier:z.string().optional(),reference:z.string().optional(),remarks:z.string().optional(),items:z.array(z.object({itemId:z.string(),qty:z.coerce.number().positive(),unitCost:z.coerce.number().nonnegative()})).min(1)}).parse(req.body);const warehouseId=await warehouseIdOrDefault(d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>{const results=[];for(const row of d.items)results.push(await changeInventoryStock(tx,{warehouseId,itemId:row.itemId,qty:row.qty,type:'STOCK_IN',userId:req.user!.id,unitCost:row.unitCost,reference:d.reference||d.supplier,referenceType:'STOCK_IN',remarks:d.remarks}));return results;}));}));
api.post('/inventory/stock-out',inventoryAccess,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),date:z.string().optional(),destination:z.string().optional(),remarks:z.string().optional(),items:z.array(z.object({itemId:z.string(),qty:z.coerce.number().positive()})).min(1)}).parse(req.body);const warehouseId=await warehouseIdOrDefault(d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>{const results=[];for(const row of d.items)results.push(await changeInventoryStock(tx,{warehouseId,itemId:row.itemId,qty:row.qty,type:'STOCK_OUT',userId:req.user!.id,reference:d.destination,referenceType:'STOCK_OUT',remarks:d.remarks}));return results;}));}));
api.post('/inventory/adjustments',inventoryAccess,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),itemId:z.string(),qty:z.coerce.number().positive(),adjustmentType:z.enum(['INCREASE','DECREASE']),reason:z.string().min(1),remarks:z.string().optional()}).parse(req.body);const warehouseId=await warehouseIdOrDefault(d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>changeInventoryStock(tx,{warehouseId,itemId:d.itemId,qty:d.qty,type:d.adjustmentType==='INCREASE'?'ADJUSTMENT_IN':'ADJUSTMENT_OUT',userId:req.user!.id,reference:d.reason,referenceType:'ADJUSTMENT',remarks:d.remarks})))}));
api.post('/inventory/opname',inventoryAccess,asyncRoute(async(req,res)=>{const d=z.object({warehouseId:z.string().optional(),items:z.array(z.object({itemId:z.string(),actualStock:z.coerce.number().nonnegative(),remarks:z.string().optional()})).min(1)}).parse(req.body);const warehouseId=await warehouseIdOrDefault(d.warehouseId);res.status(201).json(await prisma.$transaction(async tx=>{const results=[];for(const row of d.items)results.push(await changeInventoryStock(tx,{warehouseId,itemId:row.itemId,qty:row.actualStock,type:'OPNAME',userId:req.user!.id,reference:'Stock Opname',referenceType:'OPNAME',remarks:row.remarks}));return results;}));}));
api.get('/inventory/transfers',inventoryAccess,asyncRoute(async(req,res)=>{const where:any={};if(req.query.status)where.status=String(req.query.status);if(req.query.warehouseId)where.OR=[{fromWarehouseId:String(req.query.warehouseId)},{toWarehouseId:String(req.query.warehouseId)}];res.json(await prisma.stockTransfer.findMany({where,include:{fromWarehouse:true,toWarehouse:true,creator:{select:{name:true}},completer:{select:{name:true}},items:{include:{item:true}}},orderBy:{createdAt:'desc'},take:200}));}));
api.post('/inventory/transfers',inventoryAccess,asyncRoute(async(req,res)=>{const d=z.object({fromWarehouseId:z.string(),toWarehouseId:z.string(),notes:z.string().optional(),autoComplete:z.coerce.boolean().default(false),items:z.array(z.object({itemId:z.string(),qty:z.coerce.number().positive(),unitCost:z.coerce.number().nonnegative().optional()})).min(1)}).parse(req.body);if(d.fromWarehouseId===d.toWarehouseId)throw new ApiError(400,'Warehouse asal dan tujuan harus berbeda');const created=await prisma.stockTransfer.create({data:{transferNumber:invNo('TRF'),fromWarehouseId:d.fromWarehouseId,toWarehouseId:d.toWarehouseId,notes:d.notes,status:'SUBMITTED',createdBy:req.user!.id,items:{create:d.items.map(i=>({inventoryItemId:i.itemId,qty:i.qty,unitCost:i.unitCost}))}},include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}}});if(!d.autoComplete)return res.status(201).json(created);req.params.id=created.id;return res.status(201).json(await completeStockTransfer(created.id,req.user!.id));}));
async function completeStockTransfer(id:string,userId:string){return prisma.$transaction(async tx=>{const transfer=await tx.stockTransfer.findUnique({where:{id},include:{items:true}});if(!transfer)throw new ApiError(404,'Transfer tidak ditemukan');if(transfer.status==='COMPLETED')return transfer;if(transfer.status==='CANCELLED')throw new ApiError(400,'Transfer sudah dibatalkan');for(const row of transfer.items){await changeInventoryStock(tx,{warehouseId:transfer.fromWarehouseId,itemId:row.inventoryItemId,qty:Number(row.qty),type:'TRANSFER_OUT',userId,unitCost:Number(row.unitCost||0),reference:transfer.transferNumber,referenceId:transfer.id,referenceType:'TRANSFER'});await changeInventoryStock(tx,{warehouseId:transfer.toWarehouseId,itemId:row.inventoryItemId,qty:Number(row.qty),type:'TRANSFER_IN',userId,unitCost:Number(row.unitCost||0),reference:transfer.transferNumber,referenceId:transfer.id,referenceType:'TRANSFER'});}return tx.stockTransfer.update({where:{id},data:{status:'COMPLETED',completedBy:userId,completedAt:new Date()},include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}}});});}
api.post('/inventory/transfers/:id/complete',inventoryAccess,asyncRoute(async(req,res)=>res.json(await completeStockTransfer(String(req.params.id),req.user!.id))));
api.post('/inventory/transfers/:id/cancel',inventoryAccess,asyncRoute(async(req,res)=>res.json(await prisma.stockTransfer.update({where:{id:String(req.params.id)},data:{status:'CANCELLED'},include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}}}))));
api.get('/inventory/reports/transfers',inventoryAccess,asyncRoute(async(req,res)=>{const where:any={};if(req.query.from&&req.query.to)where.createdAt=inventoryDateRange(req.query);res.json(await prisma.stockTransfer.findMany({where,include:{fromWarehouse:true,toWarehouse:true,items:{include:{item:true}}},orderBy:{createdAt:'desc'},take:300}));}));

const couponBody=z.object({couponCode:z.string().min(3).transform(v=>v.toUpperCase()),couponName:z.string().min(2),discountType:z.enum(['NOMINAL','PERCENTAGE']),discountValue:z.coerce.number().positive(),maxDiscountAmount:z.coerce.number().positive().nullable().optional(),minimumTransactionAmount:z.coerce.number().nonnegative().default(0),startDate:z.coerce.date(),endDate:z.coerce.date(),usageLimit:z.coerce.number().int().positive().nullable().optional(),usagePerCustomer:z.coerce.number().int().positive().nullable().optional(),status:z.enum(['ACTIVE','INACTIVE']).default('ACTIVE'),outletIds:z.array(z.string()).default([]),productIds:z.array(z.string()).default([]),categories:z.array(z.string()).default([])}).refine(d=>d.endDate>d.startDate,{message:'Tanggal selesai harus setelah tanggal mulai'}).refine(d=>d.discountType!=='PERCENTAGE'||d.discountValue<=100,{message:'Persentase maksimal 100'});
api.get('/coupons',allow('OWNER','SUPERVISOR'),asyncRoute(async(_q,res)=>res.json(await prisma.coupon.findMany({include:{outlets:{include:{outlet:true}},products:{include:{product:true}},categories:true},orderBy:{createdAt:'desc'}}))));
api.post('/coupons',allow('OWNER'),asyncRoute(async(req,res)=>{const d=couponBody.parse(req.body);const {outletIds,productIds,categories,...data}=d;res.status(201).json(await prisma.coupon.create({data:{...data,outlets:{create:outletIds.map(outletId=>({outletId}))},products:{create:productIds.map(productId=>({productId}))},categories:{create:categories.map(category=>({category}))}},include:{outlets:true,products:true,categories:true}}));}));
api.put('/coupons/:id',allow('OWNER'),asyncRoute(async(req,res)=>{const d=couponBody.parse(req.body);const {outletIds,productIds,categories,...data}=d;const id=String(req.params.id);res.json(await prisma.$transaction(async tx=>{await tx.couponOutlet.deleteMany({where:{couponId:id}});await tx.couponProduct.deleteMany({where:{couponId:id}});await tx.couponCategory.deleteMany({where:{couponId:id}});return tx.coupon.update({where:{id},data:{...data,outlets:{create:outletIds.map(outletId=>({outletId}))},products:{create:productIds.map(productId=>({productId}))},categories:{create:categories.map(category=>({category}))}},include:{outlets:true,products:true,categories:true}});}));}));
api.delete('/coupons/:id',allow('OWNER'),asyncRoute(async(req,res)=>res.json(await prisma.coupon.update({where:{id:String(req.params.id)},data:{status:'INACTIVE'}}))));
api.post('/coupons/validate',asyncRoute(async(req,res)=>{const d=z.object({couponCode:z.string(),outletId:z.string(),items:z.array(z.any())}).parse(req.body);assertOutlet(req,d.outletId);const lines=await priceCart(d.items,d.outletId);const result=await validateCoupon(d.couponCode,d.outletId,lines);res.json({valid:true,coupon:{code:result.coupon.couponCode,name:result.coupon.couponName},discountAmount:result.discountAmount,eligibleAmount:result.eligibleAmount});}));

const saleInput=z.object({outletId:z.string(),cashSessionId:z.string().optional(),customerName:z.string().trim().optional(),items:z.array(z.object({productId:z.string(),variantId:z.string().optional(),selectedVariantOptionIds:z.array(z.string()).optional(),qty:z.number().int().positive(),addonIds:z.array(z.string()).optional(),itemNote:z.string().trim().max(255).optional(),discount:z.object({type:z.enum(['NOMINAL','PERCENTAGE']),value:z.number().nonnegative()}).optional()})).min(1),transactionDiscount:z.object({type:z.enum(['NOMINAL','PERCENTAGE']),value:z.number().nonnegative()}).optional(),couponCode:z.string().optional(),paymentMethod:z.enum(['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER']).optional(),cashReceived:z.number().nonnegative().optional(),idempotencyKey:z.string().min(8).optional()});
async function nextNumber(prefix:string,outletId:string,field:'orderNumber'|'transactionNumber'){
  const outlet=await prisma.outlet.findUniqueOrThrow({where:{id:outletId}});
  const range=dayRange();
  const count=await prisma.sale.count({where:{outletId,createdAt:range,[field]:{not:null}}});
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
  return `${prefix}-${outlet.code}-${date}-${String(count+1).padStart(4,'0')}`;
}
function saleItemCreate(l:any){return {outletId:l.outletId,productId:l.productId,productVariantId:l.variantId,productName:l.productName,variantName:l.variantName,itemNote:l.itemNote,qty:l.qty,sellingPrice:l.unitPrice,hpp:l.hpp,subtotal:l.gross,totalHpp:money(l.hpp*l.qty),grossProfit:money(l.net-l.hpp*l.qty),priceBeforeDiscount:l.unitPrice,discountType:l.discountType,discountValue:l.discountValue,discountAmount:l.discountAmount,subtotalAfterDiscount:l.net,selectedVariantsJson:l.selectedVariants,basePrice:l.basePrice,outletPrice:l.outletPrice,variantPriceTotal:l.variantPriceTotal,finalUnitPrice:l.unitPrice,baseHpp:l.baseHpp,outletHpp:l.outletHpp,variantHppTotal:l.variantHppTotal,finalUnitHpp:l.hpp,addons:{create:l.addons.map((a:any)=>({addonId:a.id,addonName:a.name,price:a.price,hpp:a.hpp}))}};}
async function buildOrderTotals(d:z.infer<typeof saleInput>){
  const lines=await priceCart(d.items,d.outletId);
  const gross=money(lines.reduce((s,l)=>s+l.gross,0)),productDiscount=money(lines.reduce((s,l)=>s+l.discountAmount,0)),afterProduct=money(gross-productDiscount),transactionDiscount=discountAmount(afterProduct,d.transactionDiscount),afterTransaction=money(afterProduct-transactionDiscount);
  const couponResult=d.couponCode?await validateCoupon(d.couponCode,d.outletId,lines):null;
  const couponDiscount=Math.min(afterTransaction,couponResult?.discountAmount||0),grand=money(afterTransaction-couponDiscount),totalHpp=money(lines.reduce((s,l)=>s+l.hpp*l.qty,0));
  return {lines,gross,productDiscount,transactionDiscount,couponResult,couponDiscount,grand,totalHpp};
}
async function createOrder(req:any,d:z.infer<typeof saleInput>,paid:boolean){
  const activeShift=await requireActiveShift(req,d.outletId,d.cashSessionId);
  d={...d,cashSessionId:activeShift.id};
  if(d.idempotencyKey){const key=await prisma.idempotencyKey.findUnique({where:{key:d.idempotencyKey}});if(key){const existing=await prisma.sale.findUnique({where:{id:key.entityId},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});if(existing)return existing;}}
  const customerName=d.customerName?.trim()||'Walk In';
  const totals=await buildOrderTotals(d);
  if(paid&&!d.paymentMethod) throw new ApiError(400,'Payment method wajib diisi');
  if(paid&&d.paymentMethod==='CASH'&&(d.cashReceived??0)<totals.grand) throw new ApiError(400,'Uang diterima kurang');
  const orderNumber=await nextNumber('ORD',d.outletId,'orderNumber');
  const transactionNumber=paid?await nextNumber('FORU',d.outletId,'transactionNumber'):null;
  return prisma.$transaction(async tx=>{
    const created=await tx.sale.create({data:{orderNumber,transactionNumber,outletId:d.outletId,cashierId:req.user!.id,cashSessionId:d.cashSessionId,customerName,subtotal:totals.gross,discountAmount:money(totals.productDiscount+totals.transactionDiscount+totals.couponDiscount),totalAmount:totals.grand,subtotalBeforeDiscount:totals.gross,productDiscountTotal:totals.productDiscount,transactionDiscountAmount:totals.transactionDiscount,couponCode:totals.couponResult?.coupon.couponCode,couponDiscountAmount:totals.couponDiscount,grandTotal:totals.grand,totalHpp:totals.totalHpp,grossProfit:paid?money(totals.grand-totals.totalHpp):0,paymentMethod:paid?d.paymentMethod:undefined,cashReceived:paid?d.cashReceived:undefined,changeAmount:paid&&d.paymentMethod==='CASH'?money((d.cashReceived||0)-totals.grand):undefined,status:paid?'PAID':'PENDING_PAYMENT',paidAt:paid?new Date():undefined,items:{create:totals.lines.map(saleItemCreate)}},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});
    if(paid&&totals.couponResult){await tx.coupon.update({where:{id:totals.couponResult.coupon.id},data:{usedCount:{increment:1}}});await tx.couponUsage.create({data:{couponId:totals.couponResult.coupon.id,saleId:created.id,outletId:d.outletId,cashierId:req.user!.id}});}
    if(d.idempotencyKey)await tx.idempotencyKey.create({data:{key:d.idempotencyKey,entityType:paid?'SALE':'ORDER',entityId:created.id}});
    return created;
  });
}
api.post('/orders',asyncRoute(async(req,res)=>res.status(201).json(await createOrder(req,saleInput.parse(req.body),false))));
api.post('/sales',asyncRoute(async(req,res)=>res.status(201).json(await createOrder(req,saleInput.parse(req.body),true))));
function queryDateRange(query:any){const from=String(query.from||query.date||'');const to=String(query.to||query.date||'');if(from&&to){const start=new Date(`${from}T00:00:00+07:00`),end=new Date(`${to}T00:00:00+07:00`);end.setDate(end.getDate()+1);return {gte:start,lt:end};}return query.date?dayRange(String(query.date)):undefined;}
function requiredOutletId(req:any){const outletId=String(req.query.outletId||req.query.outlet_id||'');if(!outletId)throw new ApiError(400,'outletId wajib dipilih untuk laporan operasional.');assertOutlet(req,outletId);return outletId;}
function ordersBaseWhere(req:any){const where:any={outletId:requiredOutletId(req)};const range=queryDateRange(req.query);if(range)where.createdAt=range;return where;}
api.get('/orders',asyncRoute(async(req,res)=>{const where:any=ordersBaseWhere(req);if(req.query.status)where.status=String(req.query.status);if(req.query.customer_name)where.customerName={contains:String(req.query.customer_name),mode:'insensitive'};res.json(await prisma.sale.findMany({where,include:{outlet:true,cashier:{select:{name:true}},items:{select:{id:true,productName:true,qty:true}}},orderBy:{createdAt:'desc'},take:200}));}));
api.get('/orders/summary',asyncRoute(async(req,res)=>{
  const baseWhere=ordersBaseWhere(req);
  const statusScope=['PENDING_PAYMENT','PAID','CANCELLED','VOID'];
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
api.get('/orders/:id',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)},include:{outlet:true,cashier:{select:{name:true}},items:{include:{addons:true}},printerLogs:{include:{printer:true,user:{select:{name:true}},},orderBy:{printedAt:'desc'}}}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');assertOutlet(req,sale.outletId);res.json(sale);}));
async function updatePendingOrder(req:any,id:string,d:z.infer<typeof saleInput>){
  const existing=await prisma.sale.findUnique({where:{id},include:{items:{include:{addons:true}}}});
  if(!existing) throw new ApiError(404,'Order tidak ditemukan');
  assertOutlet(req,existing.outletId);
  if(existing.status!=='PENDING_PAYMENT') throw new ApiError(400,'Order sudah tidak bisa diedit karena status berubah.');
  if(d.outletId!==existing.outletId) throw new ApiError(400,'Outlet order tidak bisa diubah');
  const activeShift=await requireActiveShift(req,existing.outletId,d.cashSessionId);
  d={...d,cashSessionId:activeShift.id};
  const customerName=d.customerName?.trim()||'Walk In';
  const totals=await buildOrderTotals(d);
  return prisma.$transaction(async tx=>{
    await tx.saleItem.deleteMany({where:{saleId:id}});
    const updated=await tx.sale.update({where:{id},data:{customerName,cashSessionId:d.cashSessionId,subtotal:totals.gross,discountAmount:money(totals.productDiscount+totals.transactionDiscount+totals.couponDiscount),totalAmount:totals.grand,subtotalBeforeDiscount:totals.gross,productDiscountTotal:totals.productDiscount,transactionDiscountAmount:totals.transactionDiscount,couponCode:totals.couponResult?.coupon.couponCode,couponDiscountAmount:totals.couponDiscount,grandTotal:totals.grand,totalHpp:totals.totalHpp,grossProfit:0,paymentMethod:null,cashReceived:null,changeAmount:null,items:{create:totals.lines.map(saleItemCreate)}},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});
    await tx.auditLog.create({data:{entityType:'ORDER',entityId:id,action:'ORDER_UPDATED',oldValue:{customerName:existing.customerName,grandTotal:existing.grandTotal,items:existing.items},newValue:{customerName,grandTotal:updated.grandTotal,items:updated.items},changedBy:req.user!.id}});
    return updated;
  });
}
api.put('/orders/:id',asyncRoute(async(req,res)=>res.json(await updatePendingOrder(req,String(req.params.id),saleInput.parse(req.body)))));
api.post('/orders/:id/pay',asyncRoute(async(req,res)=>{const body=z.object({paymentMethod:z.enum(['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER']),cashReceived:z.number().nonnegative().optional(),cashSessionId:z.string().optional(),order:z.any().optional()}).parse(req.body);let sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');assertOutlet(req,sale.outletId);if(sale.status!=='PENDING_PAYMENT')throw new ApiError(400,'Hanya pending order yang bisa dibayar');const activeShift=await requireActiveShift(req,sale.outletId,body.cashSessionId);if(body.order){sale=await updatePendingOrder(req,sale.id,saleInput.parse({...body.order,outletId:sale.outletId,cashSessionId:activeShift.id}));}const grand=Number(sale.grandTotal);if(body.paymentMethod==='CASH'&&(body.cashReceived??0)<grand)throw new ApiError(400,'Uang diterima kurang');const transactionNumber=await nextNumber('FORU',sale.outletId,'transactionNumber');res.json(await prisma.$transaction(async tx=>{const updated=await tx.sale.update({where:{id:sale!.id},data:{transactionNumber,status:'PAID',paidAt:new Date(),cashSessionId:activeShift.id,paymentMethod:body.paymentMethod,cashReceived:body.cashReceived,changeAmount:body.paymentMethod==='CASH'?money((body.cashReceived||0)-grand):0,grossProfit:money(grand-Number(sale!.totalHpp))},include:{items:{include:{addons:true}},outlet:true,cashier:{select:{name:true}}}});if(updated.couponCode){const coupon=await tx.coupon.findUnique({where:{couponCode:updated.couponCode}});if(coupon){await tx.coupon.update({where:{id:coupon.id},data:{usedCount:{increment:1}}});await tx.couponUsage.create({data:{couponId:coupon.id,saleId:updated.id,outletId:updated.outletId,cashierId:req.user!.id}});}}await tx.auditLog.create({data:{entityType:'ORDER',entityId:updated.id,action:'ORDER_PAID',oldValue:{status:'PENDING_PAYMENT'},newValue:{status:'PAID',transactionNumber},changedBy:req.user!.id}});return updated;}));}));
api.post('/orders/:id/cancel',asyncRoute(async(req,res)=>{const reason=z.object({reason:z.string().min(3).optional()}).parse(req.body).reason;const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');assertOutlet(req,sale.outletId);if(sale.status!=='PENDING_PAYMENT'&&sale.status!=='DRAFT')throw new ApiError(400,'Hanya pending order yang bisa dibatalkan');res.json(await prisma.$transaction(async tx=>{const updated=await tx.sale.update({where:{id:sale.id},data:{status:'CANCELLED',cancelledAt:new Date(),cancelReason:reason||'Cancelled by cashier'}});await tx.auditLog.create({data:{entityType:'ORDER',entityId:sale.id,action:'ORDER_CANCELLED',oldValue:{status:sale.status},newValue:{status:'CANCELLED',reason:updated.cancelReason},changedBy:req.user!.id}});return updated;}));}));
api.get('/sales',asyncRoute(async(req,res)=>{const where:any={status:{in:['PAID','VOID']},outletId:requiredOutletId(req)};if(req.query.date)where.createdAt=dayRange(String(req.query.date));if(req.query.payment_method)where.paymentMethod=req.query.payment_method;res.json(await prisma.sale.findMany({where,include:{outlet:true,cashier:{select:{name:true}}},orderBy:{createdAt:'desc'},take:200}));}));
api.get('/sales/:id',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)},include:{outlet:true,cashier:{select:{name:true}},items:{include:{addons:true}},printerLogs:{include:{printer:true,user:{select:{name:true}},},orderBy:{printedAt:'desc'}}}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');assertOutlet(req,sale.outletId);res.json(sale);}));
api.put('/sales/:id/customer',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const customerName=z.object({customerName:z.string().trim().optional()}).parse(req.body).customerName?.trim()||'Walk In';const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');assertOutlet(req,sale.outletId);res.json(await prisma.$transaction(async tx=>{const updated=await tx.sale.update({where:{id:sale.id},data:{customerName}});await tx.auditLog.create({data:{entityType:'SALE',entityId:sale.id,action:'UPDATE_CUSTOMER_NAME',oldValue:{customerName:sale.customerName},newValue:{customerName},changedBy:req.user!.id}});return updated;}));}));
api.post('/sales/:id/void',allow('OWNER','SUPERVISOR'),asyncRoute(async(req,res)=>{const reason=z.object({reason:z.string().min(5)}).parse(req.body).reason;const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)},include:{couponUsage:true}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');assertOutlet(req,sale.outletId);if(sale.status!=='PAID')throw new ApiError(400,'Hanya transaksi paid yang bisa void');res.json(await prisma.$transaction(async tx=>{if(sale.couponUsage){await tx.coupon.update({where:{id:sale.couponUsage.couponId},data:{usedCount:{decrement:1}}});await tx.couponUsage.delete({where:{saleId:sale.id}});}return tx.sale.update({where:{id:sale.id},data:{status:'VOID',voidReason:reason,voidedAt:new Date()}});}));}));

async function logPrintAttempt(saleId:string,userId:string,type:'CUSTOMER_RECEIPT'|'KITCHEN_TICKET'|'CUSTOMER_ITEM_LIST',forcedPrinterId?:string){
  const sale=await prisma.sale.findUnique({where:{id:saleId},include:{outlet:true}});
  if(!sale) throw new ApiError(404,'Transaksi tidak ditemukan');
  const printer=forcedPrinterId?await prisma.printer.findFirst({where:{id:forcedPrinterId,outletId:sale.outletId,status:'ACTIVE'}}):await prisma.printer.findFirst({where:{outletId:sale.outletId,status:'ACTIVE',...(type==='KITCHEN_TICKET'?{isKitchenPrinter:true}:{isCustomerReceipt:true})},orderBy:{createdAt:'asc'}});
  const status=printer?'SUCCESS':'FAILED';
  const errorMessage=printer?null:'Printer aktif belum disetting, gunakan browser print fallback';
  return prisma.printerLog.create({data:{outletId:sale.outletId,saleId:sale.id,printerId:printer?.id,printType:type,status,errorMessage,printedBy:userId},include:{printer:true}});
}
api.post('/print/customer-receipt/:saleId',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.saleId)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');assertOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'CUSTOMER_RECEIPT'));}));
api.post('/print/kitchen-ticket/:saleId',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.saleId)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');assertOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'KITCHEN_TICKET'));}));
api.post('/print/reprint/:saleId',asyncRoute(async(req,res)=>{const d=z.object({printType:z.enum(['CUSTOMER_RECEIPT','KITCHEN_TICKET'])}).parse(req.body);const sale=await prisma.sale.findUnique({where:{id:String(req.params.saleId)}});if(!sale)throw new ApiError(404,'Transaksi tidak ditemukan');assertOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,d.printType));}));
api.post('/orders/:id/print/customer-item-list',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');assertOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'CUSTOMER_ITEM_LIST'));}));
api.post('/orders/:id/print/kitchen-ticket',asyncRoute(async(req,res)=>{const sale=await prisma.sale.findUnique({where:{id:String(req.params.id)}});if(!sale)throw new ApiError(404,'Order tidak ditemukan');assertOutlet(req,sale.outletId);res.json(await logPrintAttempt(sale.id,req.user!.id,'KITCHEN_TICKET'));}));

const syncRow=z.object({local_id:z.string(),action:z.enum(['CREATE','UPDATE','DELETE','PAY','CANCEL','VOID','CLOSE_SHIFT','PRINT']),idempotency_key:z.string().min(8),payload_hash:z.string().optional(),payload:z.any()});
const syncPushBody=z.object({orders:z.array(syncRow).default([]),sales:z.array(syncRow).default([]),expenses:z.array(syncRow).default([]),cash_sessions:z.array(syncRow).default([]),printer_logs:z.array(syncRow).default([]),audit_logs:z.array(syncRow).default([]),variant_options:z.array(syncRow).default([])});
async function existingByKey(key:string){const found=await prisma.idempotencyKey.findUnique({where:{key}});return found?{local_id:null,server_id:found.entityId,sync_status:'SYNCED' as const,duplicate:true}:null;}
async function rememberKey(tx:any,key:string,entityType:string,entityId:string,payloadHash?:string){await tx.idempotencyKey.create({data:{key,entityType,entityId,payloadHash}});}
async function syncMasterData(req:any, incremental=false){
  const outletWhere=req.user!.role==='OWNER'?{}:{id:{in:req.user!.outletIds}};
  const outletIds=req.user!.role==='OWNER'?undefined:req.user!.outletIds;
  const since=req.query.last_sync_at?new Date(String(req.query.last_sync_at)):null;
  const changed=(where:any={})=>incremental&&since&&!Number.isNaN(since.getTime())?{...where,updatedAt:{gt:since}}:where;
  const [outlets,categories,products,variantGroups,coupons,printers,user]=await Promise.all([
    prisma.outlet.findMany({where:changed(outletWhere),orderBy:{name:'asc'}}),
    prisma.category.findMany({where:changed({status:'ACTIVE'}),orderBy:[{sortOrder:'asc'},{name:'asc'}]}),
    prisma.product.findMany({where:changed({status:'ACTIVE',...(outletIds?{outlets:{some:{outletId:{in:outletIds},isAvailable:true,status:'ACTIVE'}}}:{})}),include:productInclude,orderBy:{name:'asc'}}),
    prisma.variantGroup.findMany({where:changed({status:'ACTIVE'}),include:{options:{where:{status:'ACTIVE'},orderBy:{sortOrder:'asc'},include:{outlets:true}}},orderBy:{name:'asc'}}),
    prisma.coupon.findMany({where:changed({status:'ACTIVE'}),include:{outlets:true,products:true,categories:true}}),
    prisma.printer.findMany({where:changed(req.user!.role==='OWNER'?{}:{outletId:{in:req.user!.outletIds}}),orderBy:{createdAt:'desc'}}),
    prisma.user.findUnique({where:{id:req.user!.id},select:{id:true,name:true,username:true,role:true,outlets:true}})
  ]);
  return {outlets,categories,products,variantGroups,coupons,printers,user,incremental,serverTime:new Date().toISOString()};
}
api.get('/sync/master-data',asyncRoute(async(req,res)=>res.json(await syncMasterData(req))));
api.get('/sync/bootstrap',asyncRoute(async(req,res)=>res.json(await syncMasterData(req))));
api.get('/sync/pull',asyncRoute(async(req,res)=>res.json(await syncMasterData(req,true))));
api.get('/sync/status',asyncRoute(async(req,res)=>{res.json({online:true,serverTime:new Date().toISOString()});}));
api.post('/sync/status',asyncRoute(async(req,res)=>{const d=z.object({action:z.enum(['MANUAL_SYNC','AUTO_SYNC','SYNC_FAILED']),startedAt:z.string().optional(),finishedAt:z.string().optional(),duration:z.number().optional(),recordsUploaded:z.number().optional(),recordsDownloaded:z.number().optional(),failedRecords:z.number().optional(),device:z.string().optional(),error:z.string().optional()}).parse(req.body);await prisma.auditLog.create({data:{entityType:'SYNC',entityId:req.user!.id,action:d.action,oldValue:Prisma.JsonNull,newValue:d as any,changedBy:req.user!.id}});res.json({ok:true});}));
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
  for(const row of d.expenses)await pushResult(row,'EXPENSE',async()=>{const body=expenseBody.parse(row.payload);const requestedOutletId=row.payload.outletId;const active=await prisma.cashSession.findFirst({where:{status:'OPEN',...(requestedOutletId?{outletId:requestedOutletId}:req.user!.role==='OWNER'?{}:{outletId:{in:req.user!.outletIds}})},orderBy:{openedAt:'desc'}});const outletId=requestedOutletId||active?.outletId;if(!outletId)throw new ApiError(400,'Outlet pengeluaran offline tidak ditemukan');assertOutlet(req,outletId);const cat=body.categoryId?await prisma.expenseCategory.findUnique({where:{id:body.categoryId}}):null;return prisma.$transaction(async tx=>{const expense=await tx.expense.create({data:{outletId,cashSessionId:row.payload.cashSessionId||active?.id,cashierId:req.user!.id,categoryId:cat?.id,categoryName:cat?.name||row.payload.categoryName||'Lain-lain',description:body.description,amount:body.amount,paymentSource:body.paymentSource,note:body.note,receiptImageUrl:body.receiptImageUrl}});await rememberKey(tx,row.idempotency_key,'EXPENSE',expense.id,row.payload_hash);return expense;});});
  for(const row of d.cash_sessions)await pushResult(row,'CASH_SESSION',async()=>{const payload=z.object({outletId:z.string(),openingCash:z.coerce.number().nonnegative(),closingCashActual:z.coerce.number().nonnegative().optional(),expectedCash:z.coerce.number().optional(),variance:z.coerce.number().optional(),status:z.enum(['OPEN','CLOSED']).optional()}).parse(row.payload);assertOutlet(req,payload.outletId);return prisma.$transaction(async tx=>{const session=await tx.cashSession.create({data:{outletId:payload.outletId,cashierId:req.user!.id,openingCash:payload.openingCash,closingCashActual:payload.closingCashActual,expectedCash:payload.expectedCash,variance:payload.variance,status:payload.status||'OPEN',closedAt:payload.status==='CLOSED'?new Date():undefined}});await rememberKey(tx,row.idempotency_key,'CASH_SESSION',session.id,row.payload_hash);return session;});});
  for(const row of d.variant_options)await pushResult(row,'VARIANT_OPTION',async()=>{const payload=z.object({local_id:z.string(),server_id:z.string().nullable().optional(),variant_group_local_id:z.string(),variant_group_server_id:z.string().nullable().optional(),name:z.string().min(1),additional_price:z.coerce.number().nonnegative().default(0),hpp:z.coerce.number().nonnegative().default(0),sort_order:z.coerce.number().int().default(0),status:z.enum(['ACTIVE','INACTIVE','DELETED']).default('ACTIVE'),deleted_at:z.string().nullable().optional()}).parse(row.payload);const groupId=payload.variant_group_server_id||payload.variant_group_local_id;if(!groupId||String(groupId).startsWith('local_'))throw new ApiError(409,'Variant group belum tersinkron. Sync group terlebih dahulu.');return prisma.$transaction(async tx=>{let option;if(row.action==='CREATE'){option=await tx.variantOption.create({data:{variantGroupId:groupId,name:payload.name,additionalPrice:payload.additional_price,hpp:payload.hpp,sortOrder:payload.sort_order,status:payload.status==='DELETED'?'INACTIVE':payload.status}});}else{const optionId=payload.server_id||payload.local_id;if(!optionId||String(optionId).startsWith('local_'))throw new ApiError(409,'Variant option server_id belum ada.');option=row.action==='DELETE'?await tx.variantOption.update({where:{id:optionId},data:{status:'INACTIVE'}}):await tx.variantOption.update({where:{id:optionId},data:{name:payload.name,additionalPrice:payload.additional_price,hpp:payload.hpp,sortOrder:payload.sort_order,status:payload.status==='DELETED'?'INACTIVE':payload.status}});}await rememberKey(tx,row.idempotency_key,'VARIANT_OPTION',option.id,row.payload_hash);return option;});});
  for(const row of d.printer_logs)await pushResult(row,'PRINTER_LOG',async()=>prisma.$transaction(async tx=>{const sale=await tx.sale.findUnique({where:{id:String(row.payload.saleId)}});if(!sale)throw new ApiError(400,'Sale printer log tidak ditemukan');assertOutlet(req,sale.outletId);const log=await tx.printerLog.create({data:{outletId:sale.outletId,saleId:sale.id,printerId:row.payload.printerId,printType:row.payload.printType,status:row.payload.status||'SUCCESS',errorMessage:row.payload.errorMessage,printedBy:req.user!.id}});await rememberKey(tx,row.idempotency_key,'PRINTER_LOG',log.id,row.payload_hash);return log;}));
  for(const row of d.audit_logs)await pushResult(row,'AUDIT_LOG',async()=>prisma.$transaction(async tx=>{const log=await tx.auditLog.create({data:{entityType:row.payload.entityType||'OFFLINE',entityId:row.payload.entityId||row.local_id,action:row.payload.action||row.action,oldValue:row.payload.oldValue,newValue:row.payload.newValue,changedBy:req.user!.id}});await rememberKey(tx,row.idempotency_key,'AUDIT_LOG',log.id,row.payload_hash);return log;}));
  await prisma.auditLog.create({data:{entityType:'SYNC',entityId:req.user!.id,action:failed?'SYNC_FAILED':'MANUAL_SYNC',oldValue:Prisma.JsonNull,newValue:{started_at:startedAt,finished_at:new Date(),duration:Date.now()-startedAt.getTime(),records_uploaded:uploaded,records_downloaded:0,failed_records:failed,device:req.headers['user-agent']},changedBy:req.user!.id}});
  res.json({ok:failed===0,uploaded,failed,results});
}));

async function report(req:any,consolidated=false){if(consolidated&&req.user.role!=='OWNER')throw new ApiError(403,'Hanya OWNER yang dapat melihat laporan konsolidasi.');const range=req.query.date?dayRange(String(req.query.date)):dayRange();const baseWhere:any={createdAt:range};if(!consolidated)baseWhere.outletId=requiredOutletId(req);const sales=await prisma.sale.findMany({where:{...baseWhere,status:'PAID'},include:{items:true,outlet:true}});const expenses=await prisma.expense.findMany({where:{...baseWhere,status:'ACTIVE'},include:{categoryRef:true,outlet:true}});const pending=await prisma.sale.aggregate({where:{...baseWhere,status:'PENDING_PAYMENT'},_count:true,_sum:{grandTotal:true}});const sum=(key:string)=>money(sales.reduce((n,s)=>n+Number((s as any)[key]),0));const gross=sum('subtotalBeforeDiscount'),productDiscount=sum('productDiscountTotal'),transactionDiscount=sum('transactionDiscountAmount'),couponDiscount=sum('couponDiscountAmount'),net=sum('grandTotal'),hpp=sum('totalHpp');const cashSales=money(sales.filter(s=>s.paymentMethod==='CASH').reduce((n,s)=>n+Number(s.grandTotal),0));const cashDrawerExpense=money(expenses.filter(e=>e.paymentSource==='CASH_DRAWER').reduce((n,e)=>n+Number(e.amount),0));const nonCashExpense=money(expenses.filter(e=>e.paymentSource==='NON_CASH').reduce((n,e)=>n+Number(e.amount),0));const ownerTransferExpense=money(expenses.filter(e=>e.paymentSource==='OWNER_TRANSFER').reduce((n,e)=>n+Number(e.amount),0));const expenseByCategory=[...expenses.reduce((m,e)=>{const k=e.categoryName||e.categoryRef?.name||'Lain-lain';m.set(k,(m.get(k)||0)+Number(e.amount));return m;},new Map<string,number>()).entries()].map(([category,amount])=>({category,amount:money(amount)}));return {grossSales:gross,productDiscount,transactionDiscount,couponDiscount,netSales:net,paidSalesAmount:net,pendingOrdersCount:pending._count,pendingOrdersAmount:money(Number(pending._sum.grandTotal||0)),totalHpp:hpp,grossProfit:money(net-hpp),grossMargin:net?money((net-hpp)/net*100):0,totalTransactions:sales.length,averageTicket:sales.length?money(net/sales.length):0,payments:Object.fromEntries(['CASH','QRIS','GOFOOD','GRABFOOD','SHOPEEFOOD','VOUCHER'].map(p=>[p,money(sales.filter(s=>s.paymentMethod===p).reduce((n,s)=>n+Number(s.grandTotal),0))])),cashDrawerExpense,nonCashExpense,ownerTransferExpense,totalExpense:money(expenses.reduce((n,e)=>n+Number(e.amount),0)),expenseByCategory,netCashMovement:money(cashSales-cashDrawerExpense),sales};}
api.get('/reports/daily',asyncRoute(async(req,res)=>{const r=await report(req);res.json({...r,sales:undefined});}));
api.get('/reports/dashboard',asyncRoute(async(req,res)=>{const r=await report(req,String(req.query.consolidated||'')==='1');const outlets=new Map<string,any>();for(const s of r.sales){const x=outlets.get(s.outletId)||{outlet:s.outlet.name,netSales:0,transactions:0,grossProfit:0};x.netSales+=Number(s.grandTotal);x.transactions++;x.grossProfit+=Number(s.grossProfit);outlets.set(s.outletId,x);}res.json({...r,sales:undefined,outlets:[...outlets.values()].map(x=>({...x,averageTicket:money(x.netSales/x.transactions)}))});}));
api.get('/dashboard',asyncRoute(async(req,res)=>{const r=await report(req);res.json({...r,sales:undefined});}));
api.get('/dashboard/consolidated',allow('OWNER'),asyncRoute(async(req,res)=>{const r=await report(req,true);res.json({...r,sales:undefined});}));
api.get('/reports/products',asyncRoute(async(req,res)=>{const r=await report(req);const map=new Map<string,any>();for(const s of r.sales)for(const i of s.items){const x=map.get(i.productId)||{productName:i.productName,qty:0,revenue:0,hpp:0};x.qty+=i.qty;x.revenue+=Number(i.subtotalAfterDiscount);x.hpp+=Number(i.totalHpp);map.set(i.productId,x);}res.json([...map.values()].map(x=>({...x,grossProfit:money(x.revenue-x.hpp)})).sort((a,b)=>b.qty-a.qty));}));
api.get('/reports/outlets',asyncRoute(async(req,res)=>{const r=await report(req);const map=new Map<string,any>();for(const s of r.sales){const x=map.get(s.outletId)||{outlet:s.outlet.name,grossSales:0,netSales:0,discount:0,grossProfit:0,transactions:0};x.grossSales+=Number(s.subtotalBeforeDiscount);x.netSales+=Number(s.grandTotal);x.discount+=Number(s.discountAmount);x.grossProfit+=Number(s.grossProfit);x.transactions++;map.set(s.outletId,x);}res.json([...map.values()]);}));

app.use((err:any,_req:any,res:any,_next:any)=>{if(err instanceof z.ZodError)return res.status(400).json({message:err.issues[0]?.message||'Data tidak valid',issues:err.issues});if(err instanceof ApiError)return res.status(err.status).json({message:err.message});if(err instanceof Prisma.PrismaClientKnownRequestError&&err.code==='P2002')return res.status(409).json({message:'Data unik sudah digunakan'});console.error(err);res.status(500).json({message:'Terjadi kesalahan pada server'});});
const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`FORU POS API running on http://localhost:${port}`));
