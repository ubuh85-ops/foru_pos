import type { Request, Router } from 'express';
import type { Outlet, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError, allow, asyncRoute, prisma, tenantScope } from './lib.js';
import { bundleInclude, bundlePreviewInput, bundlePriceForChannel, priceBundle } from './bundle-engine.js';

const amount = z.number().finite().nonnegative().max(999999999999.99);
const choiceInput = z.object({
  productId: z.string().min(1), variantId: z.string().min(1).nullable().optional(),
  fixedOptionIds: z.array(z.string().min(1)).max(50).default([]),
  qty: z.number().int().min(1).max(50).default(1), additionalPrice: amount.default(0),
  isDefault: z.boolean().default(false), isActive: z.boolean().default(true),
}).strict();
const groupInput = z.object({
  name: z.string().trim().min(1).max(120), required: z.boolean().default(true), isFixed: z.boolean().default(false),
  minSelect: z.number().int().min(0).max(50).default(1), maxSelect: z.number().int().min(1).max(50).default(1),
  items: z.array(choiceInput).min(1).max(50),
}).strict().superRefine((group, ctx) => {
  const minimum = group.required ? Math.max(1, group.minSelect) : group.minSelect;
  const active = group.items.filter(item => item.isActive);
  const defaults = active.filter(item => item.isDefault).length;
  if (group.minSelect > group.maxSelect || (!group.isFixed && (minimum > group.maxSelect || minimum > active.length))) ctx.addIssue({ code: 'custom', message: 'Min/max pilihan tidak valid atau item aktif tidak cukup' });
  if (group.isFixed && !active.length) ctx.addIssue({ code: 'custom', message: 'Paket tetap wajib mempunyai item aktif' });
  if (!group.isFixed && defaults > group.maxSelect) ctx.addIssue({ code: 'custom', message: 'Pilihan default melebihi maksimum' });
});
export const bundleAdminInput = z.object({
  name: z.string().trim().min(1).max(160), categoryId: z.string().min(1),
  description: z.string().trim().max(3000).nullable().optional(),
  imageUrl: z.string().max(1000).nullable().optional(), basePrice: amount,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  availablePOS: z.boolean().default(true), availableWebOrder: z.boolean().default(true),
  startDate: z.string().datetime({ offset: true }).nullable().optional(), endDate: z.string().datetime({ offset: true }).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  outlets: z.array(z.object({ outletId: z.string().min(1), isActive: z.boolean().default(true),
    price: amount.nullable().optional(), gofoodPrice: amount.nullable().optional(),
    grabfoodPrice: amount.nullable().optional(), shopeefoodPrice: amount.nullable().optional(),
  }).strict()).min(1).max(200),
  groups: z.array(groupInput).min(1).max(20),
}).strict().superRefine((data, ctx) => {
  if (data.startDate && data.endDate && new Date(data.startDate) > new Date(data.endDate)) ctx.addIssue({ code: 'custom', message: 'Periode paket tidak valid' });
  if (new Set(data.outlets.map(row => row.outletId)).size !== data.outlets.length) ctx.addIssue({ code: 'custom', message: 'Outlet paket duplikat' });
  if (data.groups.reduce((sum, group) => sum + group.items.length, 0) > 100) ctx.addIssue({ code: 'custom', message: 'Maksimal 100 pilihan per paket' });
});

async function validateReferences(tx: Prisma.TransactionClient, businessId: string, body: z.infer<typeof bundleAdminInput>) {
  const category = await tx.category.findFirst({ where: { id: body.categoryId, businessId } });
  if (!category) throw new ApiError(403, 'Kategori tidak diizinkan');
  const outlets = await tx.outlet.count({ where: { id: { in: body.outlets.map(row => row.outletId) }, businessId, status: 'ACTIVE' } });
  if (outlets !== body.outlets.length) throw new ApiError(403, 'Outlet tidak diizinkan');
  const choices = body.groups.flatMap(group => group.items);
  const ids = [...new Set(choices.map(item => item.productId))];
  const products = await tx.product.findMany({ where: { id: { in: ids }, businessId }, include: {
    variants: true, variantGroups: { include: { group: { include: { options: true } } } },
  } });
  if (products.length !== ids.length) throw new ApiError(403, 'Produk tidak diizinkan');
  for (const choice of choices) {
    const product = products.find(row => row.id === choice.productId)!;
    if (choice.variantId && (!product.variants.some(variant => variant.id === choice.variantId && variant.status === 'ACTIVE') || product.variantGroups.length)) throw new ApiError(400, 'Variant tidak valid untuk produk paket');
    const options = product.variantGroups.filter(row => row.group.status === 'ACTIVE' && row.group.businessId === businessId).flatMap(row => row.group.options.filter(option => option.status === 'ACTIVE').map(option => option.id));
    if (new Set(choice.fixedOptionIds).size !== choice.fixedOptionIds.length || choice.fixedOptionIds.some(id => !options.includes(id))) throw new ApiError(400, 'Opsi variant paket tidak valid');
    if (choice.fixedOptionIds.length) for (const row of product.variantGroups.filter(row => row.group.status === 'ACTIVE')) {
      const count = row.group.options.filter(option => choice.fixedOptionIds.includes(option.id)).length;
      if (count < (row.group.required ? Math.max(1, row.group.minSelect) : row.group.minSelect) || count > row.group.maxSelect) throw new ApiError(400, `${row.group.name}: opsi tetap tidak memenuhi min/max`);
    }
  }
}

export function registerBundles(api: Router,
  assertTenantOutlet: (req: Request, outletId: string) => Promise<unknown>,
  assertRecipeAvailability: (outlet: Outlet, items: { productId: string; qty: number }[]) => Promise<unknown>,
  stockSnapshots?: (rows: {productId:string;productOutlet:unknown}[],outlet:Outlet) => Promise<Map<string,{isAvailable?:boolean;stockQty?:number|null}>>,
  categoryOrder?: (outletId:string) => Promise<Map<string,number>>) {
  api.get('/pos/bundles', asyncRoute(async (req, res) => {
    const { businessId } = tenantScope(req);
    const query=z.object({outlet_id:z.string().min(1),channel:bundlePreviewInput.shape.channel.optional()}).parse(req.query);
    await assertTenantOutlet(req,query.outlet_id);
    const outlet=await prisma.outlet.findFirst({where:{id:query.outlet_id,businessId,status:'ACTIVE'},include:{defaultInventoryWarehouse:true}});
    if(!outlet)throw new ApiError(403,'Outlet tidak diizinkan');
    const now=new Date();
    const bundles=await prisma.productBundle.findMany({where:{businessId,status:'ACTIVE',availablePOS:true,category:{businessId,status:'ACTIVE'},
      outlets:{some:{outletId:outlet.id,isActive:true}},AND:[{OR:[{startDate:null},{startDate:{lte:now}}]},{OR:[{endDate:null},{endDate:{gte:now}}]}]},include:bundleInclude,orderBy:[{sortOrder:'asc'},{name:'asc'}]});
    const ids=[...new Set(bundles.flatMap(bundle=>bundle.groups.flatMap(group=>group.items.map(item=>item.productId))))];
    const products=await prisma.product.findMany({where:{businessId,id:{in:ids}},include:{categoryRef:true,variants:{where:{status:'ACTIVE'},orderBy:{variantName:'asc'}},outlets:{where:{outletId:outlet.id}},
      variantGroups:{orderBy:{sortOrder:'asc'},include:{group:{include:{options:{where:{status:'ACTIVE'},orderBy:{sortOrder:'asc'},include:{outlets:{where:{outletId:outlet.id}}}}}}}}}});
    const stocks=stockSnapshots?await stockSnapshots(products.map(product=>({productId:product.id,productOutlet:product.outlets[0]})),outlet):new Map<string,{isAvailable?:boolean;stockQty?:number|null}>();
    const order=categoryOrder?await categoryOrder(outlet.id):new Map<string,number>();
    const byId=new Map(products.map(product=>[product.id,product]));
    res.json(bundles.map(bundle=>{
      const groups=bundle.groups.map(group=>({...group,items:group.items.map(item=>{
        const product=byId.get(item.productId),po=product?.outlets[0],stock=stocks.get(item.productId);
        const options=product?.variantGroups.filter(row=>row.group.status==='ACTIVE'&&row.group.businessId===businessId).map(row=>({group:{...row.group,options:row.group.options.filter(option=>!option.outlets[0]||option.outlets[0].status==='ACTIVE').map(option=>({...option,additionalPrice:Number(option.outlets[0]?.additionalPrice??option.additionalPrice)}))}}))||[];
        const variantValid=(!item.variantId||!!product?.variants.some(variant=>variant.id===item.variantId))&&(!item.variantId||!options.length);
        const optionIds=options.flatMap(row=>row.group.options.map(option=>option.id));
        const optionsValid=options.every(row=>row.group.options.length>=(row.group.required?Math.max(1,row.group.minSelect):row.group.minSelect))&&item.fixedOptionIds.every(id=>optionIds.includes(id))&&(!item.fixedOptionIds.length||options.every(row=>{const count=row.group.options.filter(option=>item.fixedOptionIds.includes(option.id)).length;return count>=(row.group.required?Math.max(1,row.group.minSelect):row.group.minSelect)&&count<=row.group.maxSelect;}));
        const isAvailable=item.isActive&&product?.status==='ACTIVE'&&product.categoryRef?.status!=='INACTIVE'&&!!po?.isActive&&po.status==='ACTIVE'&&po.isAvailable&&stock?.isAvailable!==false&&(stock?.stockQty==null||stock.stockQty>=item.qty)&&variantValid&&optionsValid;
        return {id:item.id,productId:item.productId,variantId:item.variantId,fixedOptionIds:item.fixedOptionIds,qty:item.qty,additionalPrice:Number(item.additionalPrice),isDefault:item.isDefault,isActive:item.isActive,isAvailable,
          product:product?{id:product.id,name:product.name,masterBasePrice:Number(product.basePrice),basePrice:Number(po?.outletPrice??product.basePrice),variants:product.variants.map(variant=>({...variant,sellingPrice:Number(variant.sellingPrice)})),variantGroups:options}:null};
      })}));
      const isAvailable=groups.every(group=>group.isFixed?group.items.filter(item=>item.isActive).every(item=>item.isAvailable)&&group.items.some(item=>item.isAvailable):group.items.filter(item=>item.isAvailable).length>=(group.required?Math.max(1,group.minSelect):group.minSelect));
      return {id:bundle.id,name:bundle.name,category:bundle.category.name,categoryRef:{name:bundle.category.name},categories:[{id:bundle.categoryId,name:bundle.category.name,sortOrder:order.get(bundle.categoryId)??bundle.category.sortOrder}],
        basePrice:bundlePriceForChannel(Number(bundle.basePrice),bundle.outlets.find(row=>row.outletId===outlet.id)!,query.channel||'DINE_IN'),baseHpp:0,imageUrl:bundle.imageUrl,isAvailable,stockMode:'UNLIMITED',stockQty:null,variants:[],variantGroups:[],bundle:{groups}};
    }));
  }));
  api.get('/bundles', allow('OWNER', 'SUPERVISOR'), asyncRoute(async (req, res) => {
    const { businessId } = tenantScope(req);
    const query = z.object({ outletId: z.string().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).parse(req.query);
    if (query.outletId) await assertTenantOutlet(req, query.outletId);
    res.json(await prisma.productBundle.findMany({ where: { businessId, status: query.status,
      ...(query.outletId ? { outlets: { some: { outletId: query.outletId } } } : {}) },
      include: bundleInclude, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: 200 }));
  }));
  api.get('/bundles/:id', allow('OWNER', 'SUPERVISOR'), asyncRoute(async (req, res) => {
    const row = await prisma.productBundle.findFirst({ where: { id: String(req.params.id), ...tenantScope(req) }, include: bundleInclude });
    if (!row) throw new ApiError(404, 'Paket tidak ditemukan');
    res.json(row);
  }));
  const save = (update: boolean) => asyncRoute(async (req, res) => {
    const { businessId } = tenantScope(req);
    const body = bundleAdminInput.parse(req.body);
    for (const outlet of body.outlets) await assertTenantOutlet(req, outlet.outletId);
    const result = await prisma.$transaction(async tx => {
      const id = update ? String(req.params.id) : undefined;
      if (id) {
        const existing = await tx.productBundle.findFirst({ where: { id, businessId } });
        if (!existing) throw new ApiError(404, 'Paket tidak ditemukan');
        // Serialize replacement of groups; a half-written configuration is never visible.
        await tx.$queryRaw`SELECT id FROM product_bundles WHERE id = ${id} AND business_id = ${businessId} FOR UPDATE`;
      }
      await validateReferences(tx, businessId, body);
      const { groups, outlets, startDate, endDate, ...fields } = body;
      const data = { ...fields, businessId, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null };
      const row = id ? await tx.productBundle.update({ where: { id }, data }) : await tx.productBundle.create({ data });
      if (id) {
        await tx.productBundleGroup.deleteMany({ where: { bundleId: id } });
        await tx.productBundleOutlet.deleteMany({ where: { bundleId: id } });
      }
      await tx.productBundleOutlet.createMany({ data: outlets.map(outlet => ({ ...outlet, bundleId: row.id })) });
      for (const [sortOrder, group] of groups.entries()) {
        const { items, ...fields } = group;
        await tx.productBundleGroup.create({ data: { ...fields, sortOrder, bundleId: row.id,
          items: { create: items.map((item, index) => ({ ...item, sortOrder: index })) } } });
      }
      await tx.auditLog.create({ data: { businessId, entityType: 'BUNDLE', entityId: row.id,
        action: id ? 'UPDATE_BUNDLE' : 'CREATE_BUNDLE', changedBy: req.user!.id,
        newValue: { name: row.name, status: row.status } } });
      return tx.productBundle.findUniqueOrThrow({ where: { id: row.id }, include: bundleInclude });
    });
    res.status(update ? 200 : 201).json(result);
  });
  api.post('/bundles', allow('OWNER', 'SUPERVISOR'), save(false));
  api.put('/bundles/:id', allow('OWNER', 'SUPERVISOR'), save(true));
  api.delete('/bundles/:id', allow('OWNER', 'SUPERVISOR'), asyncRoute(async (req, res) => {
    const { businessId } = tenantScope(req);
    const id = String(req.params.id);
    await prisma.$transaction(async tx => {
      const result = await tx.productBundle.updateMany({ where: { id, businessId }, data: { status: 'INACTIVE' } });
      if (!result.count) throw new ApiError(404, 'Paket tidak ditemukan');
      await tx.auditLog.create({ data: { businessId, entityType: 'BUNDLE', entityId: id, action: 'DEACTIVATE_BUNDLE', changedBy: req.user!.id } });
    });
    res.json({ success: true });
  }));
  api.post('/bundles/:id/preview', asyncRoute(async (req, res) => {
    const { businessId } = tenantScope(req);
    const input = bundlePreviewInput.parse(req.body);
    await assertTenantOutlet(req, input.outletId);
    const outlet = await prisma.outlet.findFirst({ where: { id: input.outletId, businessId, status: 'ACTIVE' },include:{defaultInventoryWarehouse:true} });
    if (!outlet) throw new ApiError(403, 'Outlet tidak diizinkan');
    const result = await prisma.$transaction(tx => priceBundle(tx, businessId, String(req.params.id), input), { isolationLevel: 'RepeatableRead' });
    await assertRecipeAvailability(outlet, result.components);
    res.json(result);
  }));
}
