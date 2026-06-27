import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const db=new PrismaClient();
async function main(){
  const [lrt,huis]=await Promise.all([
    db.outlet.upsert({where:{code:'LRT'},update:{},create:{code:'LRT',name:'FORU LRT'}}),
    db.outlet.upsert({where:{code:'HUIS'},update:{},create:{code:'HUIS',name:'FORU HUIS'}})
  ]);
  const owner=await db.user.upsert({where:{username:'owner'},update:{},create:{name:'Owner FORU',username:'owner',passwordHash:await bcrypt.hash('owner123',10),role:'OWNER'}});
  const cashier=await db.user.upsert({where:{username:'kasir'},update:{},create:{name:'Kasir FORU',username:'kasir',passwordHash:await bcrypt.hash('kasir123',10),role:'CASHIER'}});
  const lrtCashier=await db.user.upsert({where:{username:'ltrkasir'},update:{name:'Kasir LRT',passwordHash:await bcrypt.hash('lrtkasir',10),role:'CASHIER'},create:{name:'Kasir LRT',username:'ltrkasir',passwordHash:await bcrypt.hash('lrtkasir',10),role:'CASHIER'}});
  for(const outlet of [lrt,huis])await db.userOutlet.upsert({where:{userId_outletId:{userId:owner.id,outletId:outlet.id}},update:{},create:{userId:owner.id,outletId:outlet.id}});
  await db.userOutlet.upsert({where:{userId_outletId:{userId:cashier.id,outletId:lrt.id}},update:{},create:{userId:cashier.id,outletId:lrt.id}});
  await db.userOutlet.upsert({where:{userId_outletId:{userId:lrtCashier.id,outletId:lrt.id}},update:{},create:{userId:lrtCashier.id,outletId:lrt.id}});
  const spicy=await db.variantGroup.upsert({where:{id:'vg_level_pedas'},update:{},create:{id:'vg_level_pedas',name:'Level Pedas',required:true,minSelect:1,maxSelect:1,options:{create:[{name:'Original',sortOrder:1},{name:'Spicy',sortOrder:2},{name:'Extra Spicy',additionalPrice:1000,hpp:200,sortOrder:3}]}}});
  const topping=await db.variantGroup.upsert({where:{id:'vg_topping'},update:{},create:{id:'vg_topping',name:'Topping',required:false,minSelect:0,maxSelect:3,options:{create:[{name:'Extra Chicken',additionalPrice:8000,hpp:4000,sortOrder:1},{name:'Extra Cheese',additionalPrice:3000,hpp:1200,sortOrder:2},{name:'Extra Sauce',additionalPrice:2000,hpp:600,sortOrder:3}]}}});
  const size=await db.variantGroup.upsert({where:{id:'vg_size'},update:{},create:{id:'vg_size',name:'Size',required:true,minSelect:1,maxSelect:1,options:{create:[{name:'Regular',sortOrder:1},{name:'Large',additionalPrice:2000,hpp:500,sortOrder:2},{name:'Jumbo',additionalPrice:5000,hpp:1200,sortOrder:3}]}}});
  const temp=await db.variantGroup.upsert({where:{id:'vg_temperature'},update:{},create:{id:'vg_temperature',name:'Temperature',required:true,minSelect:1,maxSelect:1,options:{create:[{name:'Ice',sortOrder:1},{name:'Hot',sortOrder:2}]}}});
  const _defaultVariantGroups=[spicy.id,topping.id,size.id,temp.id];
  void _defaultVariantGroups;
  const productSeeds=[
    {name:'royal chocolate',categoryName:'Choco Varian',unit:'Gelas',basePrice:15000,baseHpp:5500},
    {name:'Choco Oreo',categoryName:'Choco Varian',unit:'Gelas',basePrice:18000,baseHpp:7000},
    {name:'tiramisu chocolate',categoryName:'Choco Varian',unit:'Gelas',basePrice:17000,baseHpp:9000},
    {name:'Matcha latte',categoryName:'Matcha Varian',unit:'Gelas',basePrice:15000,baseHpp:5200},
    {name:'strawberry matcha',categoryName:'Matcha Varian',unit:'Gelas',basePrice:18000,baseHpp:5300},
    {name:'Avocado Coffee',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:7300},
    {name:'Iced Americano',categoryName:'Iced Coffe',unit:'Gelas',basePrice:15000,baseHpp:3300},
    {name:'Caffe Latte',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:5600},
    {name:'Iced Cappucino',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:5600},
    {name:'foru signature',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:7000},
    {name:'Caramel Latte',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:8200},
    {name:'Kopi Susu Aren',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:6700},
    {name:'Hazelnut Latte',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:8200},
    {name:'Tiramisu Latte',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:8200},
    {name:'Butterscotch Latte',categoryName:'Iced Coffe',unit:'Gelas',basePrice:17000,baseHpp:8200},
    {name:'Butterscotch sea salt latte',categoryName:'Iced Coffe',unit:'Gelas',basePrice:23000,baseHpp:10000},
    {name:'Hot Cappucino',categoryName:'Hot Coffe',unit:'Gelas',basePrice:15000,baseHpp:5600},
    {name:'Hot Americano',categoryName:'Hot Coffe',unit:'Gelas',basePrice:12000,baseHpp:3000},
    {name:'Hot Latte',categoryName:'Hot Coffe',unit:'Gelas',basePrice:17000,baseHpp:5600},
    {name:'Hot Coklat',categoryName:'Hot Coffe',unit:'Gelas',basePrice:17000,baseHpp:5000},
    {name:'leci yakult',categoryName:'Yakult Varian',unit:'Gelas',basePrice:15000,baseHpp:6400},
    {name:'manggo yakult',categoryName:'Yakult Varian',unit:'Gelas',basePrice:15000,baseHpp:6400},
    {name:'jeruk yakult',categoryName:'Yakult Varian',unit:'Gelas',basePrice:15000,baseHpp:6400},
    {name:'Teh Solo',categoryName:'Teh Varian',unit:'Gelas',basePrice:5000,baseHpp:2250},
    {name:'Lemon Tea',categoryName:'Teh Varian',unit:'Gelas',basePrice:10000,baseHpp:2400},
    {name:'Leci Tea',categoryName:'Teh Varian',unit:'Gelas',basePrice:10000,baseHpp:2400},
    {name:'Burger Lurah',categoryName:'Burger Pejabat',unit:'Porsi',basePrice:13000,baseHpp:5000},
    {name:'burger bupati',categoryName:'Burger Pejabat',unit:'Porsi',basePrice:20000,baseHpp:9200},
    {name:'burger camat',categoryName:'Burger Pejabat',unit:'Porsi',basePrice:17000,baseHpp:7500},
    {name:'burger presiden',categoryName:'Burger Pejabat',unit:'Porsi',basePrice:33000,baseHpp:15000},
    {name:'burger gubernur',categoryName:'Burger Pejabat',unit:'Porsi',basePrice:25000,baseHpp:11400},
    {name:'Roti Bakar Rakyat - Choco Cruncy',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:17000,baseHpp:6800},
    {name:'Roti Bakar Rakyat - Choco Cruncy Puff Pastry',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:20000,baseHpp:8000},
    {name:'Roti Bakar Rakyat - Tiramisu Crunchy',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:17000,baseHpp:6800},
    {name:'Roti Bakar Rakyat - Tiramisu puff Pastry',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:20000,baseHpp:8000},
    {name:'Roti Bakar Rakyat - Choco Cheese',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:17000,baseHpp:7500},
    {name:'Roti Bakar Rakyat - Choco Cheese puff pastry',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:20000,baseHpp:8700},
    {name:'Roti Bakar Rakyat - Cheese Milk',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:17000,baseHpp:6500},
    {name:'Roti Bakar Rakyat - Cheese Milk puff pastry',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:20000,baseHpp:8000},
    {name:'Roti Bakar Rakyat - Matcha Crunchy',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:17000,baseHpp:6800},
    {name:'Roti Bakar Rakyat - Matcha Crunchy puff Pastry',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:20000,baseHpp:8000},
    {name:'Roti Bakar Rakyat - Strawberry Jam',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:15000,baseHpp:6800},
    {name:'Roti Bakar Rakyat - Messes Milk',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:15000,baseHpp:6500},
    {name:'Roti Bakar Rakyat - Blueberry Jam',categoryName:'Roti Bakar Rakyat',unit:'Porsi',basePrice:15000,baseHpp:6800},
    {name:'Amercan Breakfast - Classic',categoryName:'American Breakfast',unit:'Porsi',basePrice:18000,baseHpp:8500},
    {name:'Amercan Breakfast - Super star',categoryName:'American Breakfast',unit:'Porsi',basePrice:28000,baseHpp:14000},
    {name:'Telor',categoryName:'Add On',unit:'Porsi',basePrice:5000,baseHpp:1600},
    {name:'Keju',categoryName:'Add On',unit:'Porsi',basePrice:5000,baseHpp:1900},
    {name:'Sosis',categoryName:'Add On',unit:'Porsi',basePrice:2500,baseHpp:1400},
    {name:'Beef Slice',categoryName:'Add On',unit:'Porsi',basePrice:7000,baseHpp:3600}
  ];
  const categoryByName=new Map<string,{id:string;name:string}>();
  for(const categoryName of Array.from(new Set(productSeeds.map((p)=>p.categoryName)))){
    const category=await db.category.upsert({where:{name:categoryName},update:{status:'ACTIVE'},create:{name:categoryName,sortOrder:categoryByName.size+1,status:'ACTIVE'}});
    categoryByName.set(categoryName,{id:category.id,name:category.name});
  }
  for(const p of productSeeds){
    const category=categoryByName.get(p.categoryName);
    if(!category)throw new Error(`Category not found for product ${p.name}`);
    let product=await db.product.findFirst({where:{name:p.name}});
    const productData={name:p.name,category:category.name,categoryId:category.id,basePrice:p.basePrice,baseHpp:p.baseHpp,description:`Satuan: ${p.unit}`,status:'ACTIVE' as const};
    if(!product)product=await db.product.create({data:{...productData,variants:{create:{variantName:'Base',sellingPrice:p.basePrice,hpp:p.baseHpp,status:'ACTIVE'}}}});
    else product=await db.product.update({where:{id:product.id},data:productData});
    const baseVariant=await db.productVariant.findFirst({where:{productId:product.id,variantName:'Base'}});
    if(baseVariant)await db.productVariant.update({where:{id:baseVariant.id},data:{sellingPrice:p.basePrice,hpp:p.baseHpp,status:'ACTIVE'}});
    else await db.productVariant.create({data:{productId:product.id,variantName:'Base',sellingPrice:p.basePrice,hpp:p.baseHpp,status:'ACTIVE'}});
    for(const outlet of [lrt,huis])await db.productOutlet.upsert({where:{productId_outletId:{productId:product.id,outletId:outlet.id}},update:{isAvailable:true,isActive:true,status:'ACTIVE',outletPrice:null,outletHpp:null},create:{productId:product.id,outletId:outlet.id,isAvailable:true,isActive:true,status:'ACTIVE',outletPrice:null,outletHpp:null}});
  }
  for(const outlet of [lrt,huis]){const existing=await db.printer.findFirst({where:{outletId:outlet.id,printerName:'Browser Print'}});if(existing)await db.printer.update({where:{id:existing.id},data:{connectionType:'BROWSER',paperSize:'MM58',isCustomerReceipt:true,isKitchenPrinter:true,status:'ACTIVE'}});else await db.printer.create({data:{outletId:outlet.id,printerName:'Browser Print',printerType:'THERMAL',connectionType:'BROWSER',paperSize:'MM58',isCustomerReceipt:true,isKitchenPrinter:true,status:'ACTIVE'}});}
  await db.coupon.upsert({where:{couponCode:'FORUHEMAT'},update:{},create:{couponCode:'FORUHEMAT',couponName:'Hemat 10%',discountType:'PERCENTAGE',discountValue:10,maxDiscountAmount:10000,minimumTransactionAmount:50000,startDate:new Date('2026-01-01T00:00:00+07:00'),endDate:new Date('2027-12-31T23:59:59+07:00'),usageLimit:1000,status:'ACTIVE'}});
  console.log({owner:owner.username,cashier:cashier.username,lrtCashier:lrtCashier.username,outlets:[lrt.code,huis.code]});
}
main().finally(()=>db.$disconnect());
