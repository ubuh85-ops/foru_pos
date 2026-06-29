import type { Coupon, CouponCategory, CouponOutlet, CouponProduct } from '@prisma/client';
import { ApiError, money, prisma } from './lib.js';

export type DiscountInput={type?:'NOMINAL'|'PERCENTAGE';value?:number};
export type CartLine={productId:string;variantId?:string;selectedVariantOptionIds?:string[];qty:number;discount?:DiscountInput;addonIds?:string[];itemNote?:string};
export type PricedLine={outletId:string;productId:string;variantId?:string;productName:string;variantName:string;category:string;qty:number;unitPrice:number;hpp:number;gross:number;discountType?:'NOMINAL'|'PERCENTAGE';discountValue?:number;discountAmount:number;net:number;itemNote?:string;addons:{id:string;name:string;price:number;hpp:number}[];selectedVariants:{groupId:string;groupName:string;optionId:string;optionName:string;additionalPrice:number;hpp:number}[];basePrice:number;outletPrice?:number;variantPriceTotal:number;baseHpp:number;outletHpp?:number;variantHppTotal:number};
type LoadedCoupon=Coupon&{outlets:CouponOutlet[];products:CouponProduct[];categories:CouponCategory[]};

export function discountAmount(base:number,input?:DiscountInput){
  if(!input?.type||!input.value) return 0;
  if(input.value<0) throw new ApiError(400,'Nilai diskon tidak boleh negatif');
  if(input.type==='PERCENTAGE'&&input.value>100) throw new ApiError(400,'Diskon persentase maksimal 100%');
  return money(Math.min(base,input.type==='PERCENTAGE'?base*input.value/100:input.value));
}
export async function priceCart(items:CartLine[],outletId:string):Promise<PricedLine[]>{
  if(!items.length) throw new ApiError(400,'Cart masih kosong');
  return Promise.all(items.map(async line=>{
    if(!Number.isInteger(line.qty)||line.qty<1) throw new ApiError(400,'Qty produk tidak valid');
    const itemNote=line.itemNote?.trim();
    if(itemNote&&itemNote.length>255) throw new ApiError(400,'Catatan item maksimal 255 karakter');
    const product=await prisma.product.findFirst({
      where:{id:line.productId,status:'ACTIVE',OR:[{outlets:{some:{outletId,isAvailable:true,status:'ACTIVE'}}},{outlets:{none:{outletId}}}]},
      include:{
        categoryRef:true,
        addons:true,
        outlets:{where:{outletId}},
        variants:{where:{status:'ACTIVE'},orderBy:{variantName:'asc'}},
        variantGroups:{
          orderBy:{sortOrder:'asc'},
          include:{group:{include:{options:{where:{status:'ACTIVE'},orderBy:{sortOrder:'asc'},include:{outlets:{where:{outletId}}}}}}}
        }
      }
    });
    if(!product) throw new ApiError(400,'Produk tidak tersedia di outlet ini');
    const productOutlet=product.outlets[0];
    if(productOutlet&&(!productOutlet.isAvailable||productOutlet.status!=='ACTIVE')) throw new ApiError(400,'Produk tidak aktif di outlet ini');
    const selectedAddons=product.addons.filter(a=>line.addonIds?.includes(a.id)&&a.status==='ACTIVE');
    if((line.addonIds?.length||0)!==selectedAddons.length) throw new ApiError(400,'Add-on tidak valid');
    const optionIds=[...new Set(line.selectedVariantOptionIds||[])];
    const selectedVariants:PricedLine['selectedVariants']=[];
    let basePrice=Number(product.basePrice), baseHpp=Number(product.baseHpp), outletPrice=productOutlet?.outletPrice===null||!productOutlet?undefined:Number(productOutlet.outletPrice), outletHpp=productOutlet?.outletHpp===null||!productOutlet?undefined:Number(productOutlet.outletHpp), variantName='Base', variantId=line.variantId;
    if(product.variantGroups.length){
      const seen=new Set<string>();
      for(const attached of product.variantGroups){
        const group=attached.group;
        if(group.status!=='ACTIVE') continue;
        const availableOptions=group.options.filter(o=>!o.outlets[0]||o.outlets[0].status==='ACTIVE');
        const picks=availableOptions.filter(o=>optionIds.includes(o.id));
        picks.forEach(o=>seen.add(o.id));
        const min=group.required?Math.max(group.minSelect,1):group.minSelect;
        if(picks.length<min) throw new ApiError(400,`${group.name}: Minimal pilih ${min} opsi.`);
        if(picks.length>group.maxSelect) throw new ApiError(400,`${group.name}: Maksimal pilih ${group.maxSelect} opsi.`);
        selectedVariants.push(...picks.map(o=>({groupId:group.id,groupName:group.name,optionId:o.id,optionName:o.name,additionalPrice:o.outlets[0]?.additionalPrice===null||!o.outlets[0]?Number(o.additionalPrice):Number(o.outlets[0].additionalPrice),hpp:o.outlets[0]?.hpp===null||!o.outlets[0]?Number(o.hpp):Number(o.outlets[0].hpp)})));
      }
      if(optionIds.some(id=>!seen.has(id))) throw new ApiError(400,'Pilihan variant tidak valid untuk produk ini');
      variantName=selectedVariants.length?selectedVariants.map(v=>v.optionName).join(', '):'Base';
    } else {
      const variant=line.variantId?product.variants.find(v=>v.id===line.variantId):product.variants[0];
      if(!variant) throw new ApiError(400,'Produk atau varian tidak tersedia');
      variantId=variant.id; variantName=variant.variantName;
    }
    const variantPriceTotal=selectedVariants.reduce((s,v)=>s+v.additionalPrice,0);
    const variantHppTotal=selectedVariants.reduce((s,v)=>s+v.hpp,0);
    const effectiveBasePrice=outletPrice??basePrice, effectiveBaseHpp=outletHpp??baseHpp;
    const unit=effectiveBasePrice+variantPriceTotal+selectedAddons.reduce((s,a)=>s+Number(a.price),0);
    const hpp=effectiveBaseHpp+variantHppTotal+selectedAddons.reduce((s,a)=>s+Number(a.hpp),0);
    const gross=money(unit*line.qty), disc=discountAmount(gross,line.discount);
    return {outletId,productId:line.productId,variantId,productName:product.name,variantName,category:product.categoryRef?.name||product.category,qty:line.qty,unitPrice:money(unit),hpp:money(hpp),gross,discountType:line.discount?.type,discountValue:line.discount?.value,discountAmount:disc,net:money(gross-disc),itemNote:itemNote||undefined,addons:selectedAddons.map(a=>({id:a.id,name:a.addonName,price:Number(a.price),hpp:Number(a.hpp)})),selectedVariants,basePrice:money(basePrice),outletPrice:outletPrice===undefined?undefined:money(outletPrice),variantPriceTotal:money(variantPriceTotal),baseHpp:money(baseHpp),outletHpp:outletHpp===undefined?undefined:money(outletHpp),variantHppTotal:money(variantHppTotal)};
  }));
}
export async function validateCoupon(code:string,outletId:string,lines:PricedLine[],customerKey?:string){
  const coupon=await prisma.coupon.findUnique({where:{couponCode:code.trim().toUpperCase()},include:{outlets:true,products:true,categories:true}}) as LoadedCoupon|null;
  if(!coupon) throw new ApiError(404,'Kode kupon tidak ditemukan');
  const now=new Date();
  if(coupon.status!=='ACTIVE') throw new ApiError(400,'Kupon tidak aktif');
  if(now<coupon.startDate) throw new ApiError(400,'Periode kupon belum dimulai');
  if(now>coupon.endDate) throw new ApiError(400,'Kupon sudah kedaluwarsa');
  if(coupon.usageLimit!==null&&coupon.usedCount>=coupon.usageLimit) throw new ApiError(400,'Kuota penggunaan kupon telah habis');
  if(coupon.outlets.length&&!coupon.outlets.some(x=>x.outletId===outletId)) throw new ApiError(400,'Kupon tidak berlaku di outlet ini');
  const afterProduct=money(lines.reduce((s,l)=>s+l.net,0));
  if(afterProduct<Number(coupon.minimumTransactionAmount)) throw new ApiError(400,`Minimum transaksi kupon Rp${Number(coupon.minimumTransactionAmount).toLocaleString('id-ID')}`);
  let eligible=lines;
  if(coupon.products.length||coupon.categories.length) eligible=lines.filter(l=>coupon.products.some(p=>p.productId===l.productId)||coupon.categories.some(c=>c.category===l.category));
  if(!eligible.length) throw new ApiError(400,'Tidak ada produk yang memenuhi syarat kupon');
  const base=money(eligible.reduce((s,l)=>s+l.net,0));
  let amount=coupon.discountType==='PERCENTAGE'?base*Number(coupon.discountValue)/100:Number(coupon.discountValue);
  if(coupon.maxDiscountAmount!==null) amount=Math.min(amount,Number(coupon.maxDiscountAmount));
  return {coupon,discountAmount:money(Math.min(base,amount)),eligibleAmount:base,customerKey};
}
