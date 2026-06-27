import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const productSeeds = [
  { name: 'royal chocolate', categoryName: 'Choco Varian', unit: 'Gelas', basePrice: 15000, baseHpp: 5500 },
  { name: 'Choco Oreo', categoryName: 'Choco Varian', unit: 'Gelas', basePrice: 18000, baseHpp: 7000 },
  { name: 'tiramisu chocolate', categoryName: 'Choco Varian', unit: 'Gelas', basePrice: 17000, baseHpp: 9000 },
  { name: 'Matcha latte', categoryName: 'Matcha Varian', unit: 'Gelas', basePrice: 15000, baseHpp: 5200 },
  { name: 'strawberry matcha', categoryName: 'Matcha Varian', unit: 'Gelas', basePrice: 18000, baseHpp: 5300 },
  { name: 'Avocado Coffee', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 7300 },
  { name: 'Iced Americano', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 15000, baseHpp: 3300 },
  { name: 'Caffe Latte', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 5600 },
  { name: 'Iced Cappucino', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 5600 },
  { name: 'foru signature', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 7000 },
  { name: 'Caramel Latte', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 8200 },
  { name: 'Kopi Susu Aren', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 6700 },
  { name: 'Hazelnut Latte', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 8200 },
  { name: 'Tiramisu Latte', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 8200 },
  { name: 'Butterscotch Latte', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 8200 },
  { name: 'Butterscotch sea salt latte', categoryName: 'Iced Coffe', unit: 'Gelas', basePrice: 23000, baseHpp: 10000 },
  { name: 'Hot Cappucino', categoryName: 'Hot Coffe', unit: 'Gelas', basePrice: 15000, baseHpp: 5600 },
  { name: 'Hot Americano', categoryName: 'Hot Coffe', unit: 'Gelas', basePrice: 12000, baseHpp: 3000 },
  { name: 'Hot Latte', categoryName: 'Hot Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 5600 },
  { name: 'Hot Coklat', categoryName: 'Hot Coffe', unit: 'Gelas', basePrice: 17000, baseHpp: 5000 },
  { name: 'leci yakult', categoryName: 'Yakult Varian', unit: 'Gelas', basePrice: 15000, baseHpp: 6400 },
  { name: 'manggo yakult', categoryName: 'Yakult Varian', unit: 'Gelas', basePrice: 15000, baseHpp: 6400 },
  { name: 'jeruk yakult', categoryName: 'Yakult Varian', unit: 'Gelas', basePrice: 15000, baseHpp: 6400 },
  { name: 'Teh Solo', categoryName: 'Teh Varian', unit: 'Gelas', basePrice: 5000, baseHpp: 2250 },
  { name: 'Lemon Tea', categoryName: 'Teh Varian', unit: 'Gelas', basePrice: 10000, baseHpp: 2400 },
  { name: 'Leci Tea', categoryName: 'Teh Varian', unit: 'Gelas', basePrice: 10000, baseHpp: 2400 },
  { name: 'Burger Lurah', categoryName: 'Burger Pejabat', unit: 'Porsi', basePrice: 13000, baseHpp: 5000 },
  { name: 'burger bupati', categoryName: 'Burger Pejabat', unit: 'Porsi', basePrice: 20000, baseHpp: 9200 },
  { name: 'burger camat', categoryName: 'Burger Pejabat', unit: 'Porsi', basePrice: 17000, baseHpp: 7500 },
  { name: 'burger presiden', categoryName: 'Burger Pejabat', unit: 'Porsi', basePrice: 33000, baseHpp: 15000 },
  { name: 'burger gubernur', categoryName: 'Burger Pejabat', unit: 'Porsi', basePrice: 25000, baseHpp: 11400 },
  { name: 'Roti Bakar Rakyat - Choco Cruncy', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 17000, baseHpp: 6800 },
  { name: 'Roti Bakar Rakyat - Choco Cruncy Puff Pastry', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 20000, baseHpp: 8000 },
  { name: 'Roti Bakar Rakyat - Tiramisu Crunchy', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 17000, baseHpp: 6800 },
  { name: 'Roti Bakar Rakyat - Tiramisu puff Pastry', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 20000, baseHpp: 8000 },
  { name: 'Roti Bakar Rakyat - Choco Cheese', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 17000, baseHpp: 7500 },
  { name: 'Roti Bakar Rakyat - Choco Cheese puff pastry', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 20000, baseHpp: 8700 },
  { name: 'Roti Bakar Rakyat - Cheese Milk', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 17000, baseHpp: 6500 },
  { name: 'Roti Bakar Rakyat - Cheese Milk puff pastry', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 20000, baseHpp: 8000 },
  { name: 'Roti Bakar Rakyat - Matcha Crunchy', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 17000, baseHpp: 6800 },
  { name: 'Roti Bakar Rakyat - Matcha Crunchy puff Pastry', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 20000, baseHpp: 8000 },
  { name: 'Roti Bakar Rakyat - Strawberry Jam', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 15000, baseHpp: 6800 },
  { name: 'Roti Bakar Rakyat - Messes Milk', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 15000, baseHpp: 6500 },
  { name: 'Roti Bakar Rakyat - Blueberry Jam', categoryName: 'Roti Bakar Rakyat', unit: 'Porsi', basePrice: 15000, baseHpp: 6800 },
  { name: 'Amercan Breakfast - Classic', categoryName: 'American Breakfast', unit: 'Porsi', basePrice: 18000, baseHpp: 8500 },
  { name: 'Amercan Breakfast - Super star', categoryName: 'American Breakfast', unit: 'Porsi', basePrice: 28000, baseHpp: 14000 },
  { name: 'Telor', categoryName: 'Add On', unit: 'Porsi', basePrice: 5000, baseHpp: 1600 },
  { name: 'Keju', categoryName: 'Add On', unit: 'Porsi', basePrice: 5000, baseHpp: 1900 },
  { name: 'Sosis', categoryName: 'Add On', unit: 'Porsi', basePrice: 2500, baseHpp: 1400 },
  { name: 'Beef Slice', categoryName: 'Add On', unit: 'Porsi', basePrice: 7000, baseHpp: 3600 },
];

async function main() {
  const outlets = await db.outlet.findMany({
    where: { code: { in: ['LRT', 'HUIS'] } },
    select: { id: true, code: true },
  });

  if (outlets.length === 0) {
    throw new Error('Outlet LRT/HUIS belum ada. Jalankan seed outlet dulu sebelum seed produk.');
  }

  const categoryByName = new Map<string, { id: string; name: string }>();

  for (const categoryName of Array.from(new Set(productSeeds.map((product) => product.categoryName)))) {
    const category = await db.category.upsert({
      where: { name: categoryName },
      update: { status: 'ACTIVE' },
      create: { name: categoryName, sortOrder: categoryByName.size + 1, status: 'ACTIVE' },
    });
    categoryByName.set(categoryName, { id: category.id, name: category.name });
  }

  let created = 0;
  let updated = 0;

  for (const seed of productSeeds) {
    const category = categoryByName.get(seed.categoryName);
    if (!category) throw new Error(`Category not found for product ${seed.name}`);

    const existingProduct = await db.product.findFirst({ where: { name: seed.name } });
    const productData = {
      name: seed.name,
      category: category.name,
      categoryId: category.id,
      basePrice: seed.basePrice,
      baseHpp: seed.baseHpp,
      description: `Satuan: ${seed.unit}`,
      status: 'ACTIVE' as const,
    };

    const product = existingProduct
      ? await db.product.update({ where: { id: existingProduct.id }, data: productData })
      : await db.product.create({
          data: {
            ...productData,
            variants: {
              create: {
                variantName: 'Base',
                sellingPrice: seed.basePrice,
                hpp: seed.baseHpp,
                status: 'ACTIVE',
              },
            },
          },
        });

    if (existingProduct) updated += 1;
    else created += 1;

    const baseVariant = await db.productVariant.findFirst({
      where: { productId: product.id, variantName: 'Base' },
    });

    if (baseVariant) {
      await db.productVariant.update({
        where: { id: baseVariant.id },
        data: { sellingPrice: seed.basePrice, hpp: seed.baseHpp, status: 'ACTIVE' },
      });
    } else {
      await db.productVariant.create({
        data: {
          productId: product.id,
          variantName: 'Base',
          sellingPrice: seed.basePrice,
          hpp: seed.baseHpp,
          status: 'ACTIVE',
        },
      });
    }

    for (const outlet of outlets) {
      await db.productOutlet.upsert({
        where: { productId_outletId: { productId: product.id, outletId: outlet.id } },
        update: {
          isAvailable: true,
          isActive: true,
          status: 'ACTIVE',
          outletPrice: null,
          outletHpp: null,
        },
        create: {
          productId: product.id,
          outletId: outlet.id,
          isAvailable: true,
          isActive: true,
          status: 'ACTIVE',
          outletPrice: null,
          outletHpp: null,
        },
      });
    }
  }

  console.log({
    products: productSeeds.length,
    created,
    updated,
    outlets: outlets.map((outlet) => outlet.code),
  });
}

main().finally(() => db.$disconnect());
