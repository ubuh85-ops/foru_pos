import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bundlePreviewInput, bundleSelectionInput, priceBundle } from './bundle-engine.js';
import { discountAmount, priceCart, type CartLine, type PricedLine } from './discount.js';
import { ApiError, money } from './lib.js';

const common = { productId: z.string().min(1), qty: z.number().int().min(1),
  itemNote: z.string().trim().max(255).optional(), discount: z.object({ type: z.enum(['NOMINAL', 'PERCENTAGE']), value: z.number().nonnegative() }).optional() };
export const posCartItemInput = z.union([
  z.object({ ...common, qty:z.number().int().min(1).max(50), bundleId: z.string().min(1), bundleSelections: z.array(bundleSelectionInput).max(100).default([]) }).strict()
    .refine(row => row.bundleId === row.productId, 'ID paket tidak valid'),
  z.object({ ...common, variantId: z.string().optional(), selectedVariantOptionIds: z.array(z.string()).optional(), addonIds: z.array(z.string()).optional() }).strict(),
]);
export type PosCartItem = z.infer<typeof posCartItemInput>;
export type BundleSnapshot = Awaited<ReturnType<typeof priceBundle>>['selections'];
export type PosPricedLine = PricedLine & { bundleId?: string; bundleSelectionsJson?: BundleSnapshot };

export async function assertCombinedManualStock(db:Prisma.TransactionClient,businessId:string,outletId:string,items:CartLine[]){
  const requested=new Map<string,number>();
  for(const item of items)requested.set(item.productId,(requested.get(item.productId)||0)+item.qty);
  const rows=await db.productOutlet.findMany({where:{outletId,productId:{in:[...requested.keys()]},product:{businessId,status:'ACTIVE'}},include:{product:{select:{name:true}}}});
  const byId=new Map(rows.map(row=>[row.productId,row]));
  for(const [productId,qty] of requested){
    const row=byId.get(productId);
    if(!row||!row.isActive||!row.isAvailable||row.status!=='ACTIVE'||row.stockMode==='MANUAL'&&row.stockQty<qty)throw new ApiError(409,`Stok ${row?.product.name||'isi paket'} tidak mencukupi atau menu tidak tersedia.`);
  }
}

export async function pricePosCart(db: Prisma.TransactionClient, businessId: string, outletId: string, channel: string | undefined, input: PosCartItem[]): Promise<PosPricedLine[]> {
  const items = z.array(posCartItemInput).min(1).max(100).parse(input);
  const normal = items.filter((item): item is Extract<PosCartItem, { variantId?: string }> => !('bundleId' in item));
  const normalLines = normal.length ? await priceCart(normal, outletId, channel, businessId, undefined, db) : [];
  const components: CartLine[] = [...normal];
  const output: PosPricedLine[] = [];
  let normalIndex = 0;
  for (const item of items) {
    if (!('bundleId' in item)) { output.push(normalLines[normalIndex++]!); continue; }
    const quote = await priceBundle(db, businessId, item.bundleId, bundlePreviewInput.parse({ outletId, surface: 'POS', channel: channel || 'DINE_IN', qty: item.qty, selections: item.bundleSelections }));
    components.push(...quote.components);
    const gross = quote.total, disc = discountAmount(gross, item.discount);
    const online = ['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'].includes(quote.channel);
    output.push({ outletId, productId: quote.bundleId, bundleId: quote.bundleId, bundleSelectionsJson: quote.selections,
      productName: quote.bundleName, variantName: quote.selections.map(row => `${row.qty}x ${row.productName} (${row.variantName})`).join(', '),
      categoryId: quote.categoryId, category: quote.category, qty: item.qty, unitPrice: quote.unitPrice, hpp: quote.unitHpp, gross,
      discountType: item.discount?.type, discountValue: item.discount?.value, discountAmount: disc, net: money(gross - disc), itemNote: item.itemNote,
      addons: [], selectedVariants: [], basePrice: quote.masterBasePrice, outletPrice: quote.outletPrice, channel: online ? quote.channel as PricedLine['channel'] : undefined,
      dineInPriceSnapshot: quote.dineInPrice, channelPriceSnapshot: online ? quote.unitPrice : undefined, priceSource: online && quote.dineInPrice !== quote.unitPrice ? 'CHANNEL' : quote.outletPrice === undefined ? 'BASE' : 'OUTLET', baseMarginPercent: quote.dineInPrice ? money((quote.dineInPrice - quote.unitHpp) / quote.dineInPrice * 100) : 0,
      actualMarginPercent: quote.unitPrice ? money((quote.unitPrice - quote.unitHpp) / quote.unitPrice * 100) : 0, variantPriceTotal: quote.additionalPrice,
      baseHpp: quote.unitHpp, variantHppTotal: 0 });
  }
  // Check aggregate manual stock across ordinary products AND every bundle choice.
  if (items.some(item => 'bundleId' in item)) await assertCombinedManualStock(db,businessId,outletId,components);
  return output;
}

type StockParent = { id: string; productId: string | null; productName: string; qty: number; itemType?: string; bundleSelectionsJson?: unknown };
export function stockItemsFromSnapshots(items: StockParent[]) {
  return items.flatMap(item => {
    if (item.itemType !== 'BUNDLE') return item.productId ? [{ id: item.id, productId: item.productId, productName: item.productName, qty: item.qty }] : [];
    const snapshot = z.array(z.object({ productId: z.string().min(1), productName: z.string(), qty: z.number().int().positive() })).min(1).parse(item.bundleSelectionsJson);
    return snapshot.map(component => ({ id: item.id, productId: component.productId, productName: component.productName, qty: component.qty * item.qty }));
  });
}

export async function assertBundleComponentsForPayment(db: Prisma.TransactionClient, businessId: string, outletId: string, items: StockParent[]) {
  const bundleItems = stockItemsFromSnapshots(items.filter(item => item.itemType === 'BUNDLE'));
  if (!bundleItems.length) return;
  const ids = [...new Set(bundleItems.map(item => item.productId))];
  const products = await db.product.findMany({ where: { id: { in: ids }, businessId, status: 'ACTIVE',
    OR: [{ categoryId: null }, { categoryRef: { status: 'ACTIVE' } }], outlets: { some: { outletId, status: 'ACTIVE', isActive: true, isAvailable: true } } },
    include:{variants:{where:{status:'ACTIVE'}},variantGroups:{include:{group:{include:{options:{where:{status:'ACTIVE'},include:{outlets:{where:{outletId}}}}}}}}} });
  if (products.length !== ids.length) throw new ApiError(409, 'Isi paket sudah tidak tersedia. Perbarui atau batalkan open bill.');
  const saved=z.array(z.object({productId:z.string(),variantId:z.string().nullable(),selectedVariants:z.array(z.object({optionId:z.string()}))}));
  for(const parent of items.filter(item=>item.itemType==='BUNDLE'))for(const component of saved.parse(parent.bundleSelectionsJson)){
    const product=products.find(product=>product.id===component.productId)!;
    const options=product.variantGroups.filter(row=>row.group.businessId===businessId&&row.group.status==='ACTIVE').flatMap(row=>row.group.options.filter(option=>!option.outlets[0]||option.outlets[0].status==='ACTIVE').map(option=>option.id));
    if(component.variantId&&!product.variants.some(variant=>variant.id===component.variantId)||component.selectedVariants.some(option=>!options.includes(option.optionId)))throw new ApiError(409,'Variant isi paket sudah tidak tersedia. Perbarui open bill.');
  }
}
