import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('test123456', 10);
  const cashierPasswordHash = await bcrypt.hash('cashier123456', 10);
  const supervisorPasswordHash = await bcrypt.hash('supervisor123456', 10);
  const supervisorInventoryPermissions = [
    'dashboard.view',
    'inventory.view',
    'inventory.stock_in',
    'inventory.stock_out',
    'inventory.adjustment',
    'inventory.opname',
    'inventory.transfer',
    'inventory.report',
    'inventory.warehouse',
    'inventory.item_management'
  ];
  const cashierInventoryPermissions = [
    'inventory.view',
    'inventory.stock_in',
    'inventory.stock_out',
    'inventory.adjustment',
    'inventory.opname'
  ];

  const business = await prisma.business.upsert({
    where: { code: 'TEST_CAFE' },
    update: {
      name: 'TEST CAFE',
      status: 'ACTIVE'
    },
    create: {
      code: 'TEST_CAFE',
      name: 'TEST CAFE',
      status: 'ACTIVE'
    }
  });

  const owner = await prisma.user.upsert({
    where: { username: 'owner_test' },
    update: {
      name: 'Owner TEST CAFE',
      passwordHash,
      role: 'OWNER',
      status: 'ACTIVE'
    },
    create: {
      name: 'Owner TEST CAFE',
      username: 'owner_test',
      passwordHash,
      role: 'OWNER',
      status: 'ACTIVE'
    }
  });

  await prisma.businessMembership.upsert({
    where: {
      businessId_userId: {
        businessId: business.id,
        userId: owner.id
      }
    },
    update: {
      role: 'OWNER',
      status: 'ACTIVE'
    },
    create: {
      businessId: business.id,
      userId: owner.id,
      role: 'OWNER',
      status: 'ACTIVE'
    }
  });

  const outlet = await prisma.outlet.upsert({
    where: {
      businessId_code: {
        businessId: business.id,
        code: 'TEST-01'
      }
    },
    update: {
      name: 'TEST CAFE 01',
      businessId: business.id,
      status: 'ACTIVE'
    },
    create: {
      code: 'TEST-01',
      name: 'TEST CAFE 01',
      businessId: business.id,
      status: 'ACTIVE'
    }
  });

  const warehouse = await prisma.inventoryWarehouse.upsert({
    where: {
      businessId_code: {
        businessId: business.id,
        code: 'TEST-WH-01'
      }
    },
    update: {
      name: 'TEST CAFE 01 Warehouse',
      businessId: business.id,
      outletId: outlet.id,
      type: 'OUTLET',
      status: 'ACTIVE'
    },
    create: {
      code: 'TEST-WH-01',
      name: 'TEST CAFE 01 Warehouse',
      businessId: business.id,
      outletId: outlet.id,
      type: 'OUTLET',
      status: 'ACTIVE'
    }
  });

  await prisma.outlet.update({
    where: { id: outlet.id },
    data: { inventoryWarehouseId: warehouse.id }
  });

  const cashier = await prisma.user.upsert({
    where: { username: 'cashier_test' },
    update: {
      name: 'Cashier TEST CAFE',
      passwordHash: cashierPasswordHash,
      role: 'CASHIER',
      status: 'ACTIVE',
      inventoryPermissions: cashierInventoryPermissions,
      assignedWarehouseId: warehouse.id
    },
    create: {
      name: 'Cashier TEST CAFE',
      username: 'cashier_test',
      passwordHash: cashierPasswordHash,
      role: 'CASHIER',
      status: 'ACTIVE',
      inventoryPermissions: cashierInventoryPermissions,
      assignedWarehouseId: warehouse.id
    }
  });

  const supervisor = await prisma.user.upsert({
    where: { username: 'supervisor_test' },
    update: {
      name: 'Supervisor TEST CAFE',
      passwordHash: supervisorPasswordHash,
      role: 'SUPERVISOR',
      status: 'ACTIVE',
      inventoryPermissions: supervisorInventoryPermissions,
      assignedWarehouseId: null
    },
    create: {
      name: 'Supervisor TEST CAFE',
      username: 'supervisor_test',
      passwordHash: supervisorPasswordHash,
      role: 'SUPERVISOR',
      status: 'ACTIVE',
      inventoryPermissions: supervisorInventoryPermissions
    }
  });

  for (const user of [
    { row: cashier, role: 'CASHIER' as const },
    { row: supervisor, role: 'SUPERVISOR' as const }
  ]) {
    await prisma.businessMembership.upsert({
      where: {
        businessId_userId: {
          businessId: business.id,
          userId: user.row.id
        }
      },
      update: {
        role: user.role,
        status: 'ACTIVE'
      },
      create: {
        businessId: business.id,
        userId: user.row.id,
        role: user.role,
        status: 'ACTIVE'
      }
    });

    await prisma.userOutlet.upsert({
      where: {
        userId_outletId: {
          userId: user.row.id,
          outletId: outlet.id
        }
      },
      update: { status: 'ACTIVE' },
      create: {
        userId: user.row.id,
        outletId: outlet.id,
        status: 'ACTIVE'
      }
    });
  }

  const existingCategory = await prisma.category.findFirst({
    where: {
      businessId: { not: business.id },
      name: 'TEST CATEGORY'
    }
  });
  if (existingCategory) {
    throw new Error('Kategori TEST CATEGORY sudah dipakai business lain. Gunakan nama kategori test yang berbeda.');
  }

  const category = await prisma.category.upsert({
    where: {
      businessId_name: {
        businessId: business.id,
        name: 'TEST CATEGORY'
      }
    },
    update: {
      businessId: business.id,
      status: 'ACTIVE'
    },
    create: {
      name: 'TEST CATEGORY',
      businessId: business.id,
      status: 'ACTIVE'
    }
  });

  const product = await prisma.product.upsert({
    where: {
      businessId_sku: {
        businessId: business.id,
        sku: 'TEST-TENANT-B-001'
      }
    },
    update: {
      name: 'Kopi Test Tenant B',
      category: category.name,
      categoryId: category.id,
      basePrice: 10000,
      baseHpp: 4000,
      businessId: business.id,
      status: 'ACTIVE'
    },
    create: {
      sku: 'TEST-TENANT-B-001',
      name: 'Kopi Test Tenant B',
      category: category.name,
      categoryId: category.id,
      basePrice: 10000,
      baseHpp: 4000,
      businessId: business.id,
      status: 'ACTIVE'
    }
  });

  const baseVariant = await prisma.productVariant.findFirst({
    where: {
      productId: product.id,
      variantName: 'Base'
    }
  });

  if (baseVariant) {
    await prisma.productVariant.update({
      where: { id: baseVariant.id },
      data: {
        sellingPrice: 10000,
        hpp: 4000,
        status: 'ACTIVE'
      }
    });
  } else {
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        variantName: 'Base',
        sellingPrice: 10000,
        hpp: 4000,
        status: 'ACTIVE'
      }
    });
  }

  await prisma.productOutlet.upsert({
    where: {
      productId_outletId: {
        productId: product.id,
        outletId: outlet.id
      }
    },
    update: {
      isActive: true,
      isAvailable: true,
      status: 'ACTIVE',
      outletPrice: null,
      outletHpp: null
    },
    create: {
      productId: product.id,
      outletId: outlet.id,
      isActive: true,
      isAvailable: true,
      status: 'ACTIVE'
    }
  });

  console.log('TEST CAFE tenant seed completed');
  console.table([
    { type: 'business', id: business.id, code: business.code, name: business.name },
    { type: 'user', id: owner.id, code: owner.username, name: owner.name },
    { type: 'outlet', id: outlet.id, code: outlet.code, name: outlet.name },
    { type: 'warehouse', id: warehouse.id, code: warehouse.code, name: warehouse.name },
    { type: 'user', id: cashier.id, code: cashier.username, name: cashier.name },
    { type: 'user', id: supervisor.id, code: supervisor.username, name: supervisor.name },
    { type: 'category', id: category.id, code: category.name, name: category.name },
    { type: 'product', id: product.id, code: product.sku, name: product.name }
  ]);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
