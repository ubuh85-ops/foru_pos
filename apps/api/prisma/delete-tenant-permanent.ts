import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Args = {
  code?: string;
  confirm?: string;
  execute: boolean;
};

function readArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { execute: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--code') {
      result.code = args[index + 1];
      index += 1;
    } else if (arg === '--confirm') {
      result.confirm = args[index + 1];
      index += 1;
    } else if (arg === '--execute') {
      result.execute = true;
    }
  }

  return result;
}

async function main() {
  const args = readArgs();
  const code = args.code?.trim();

  if (!code) {
    throw new Error('Tenant code wajib diisi. Contoh: --code TEST_CAFE');
  }

  if (code.toUpperCase() === 'FORU') {
    throw new Error('Tenant FORU dilindungi dan tidak boleh dihapus lewat script ini.');
  }

  const business = await prisma.business.findUnique({
    where: { code },
    include: {
      memberships: {
        select: { userId: true }
      }
    }
  });

  if (!business) {
    console.log(`Tenant ${code} tidak ditemukan. Tidak ada data yang dihapus.`);
    return;
  }

  const [
    outlets,
    users,
    products,
    categories,
    sales,
    cashSessions,
    inventoryItems,
    warehouses,
    stockTransfers,
    coupons
  ] = await Promise.all([
    prisma.outlet.count({ where: { businessId: business.id } }),
    prisma.businessMembership.count({ where: { businessId: business.id } }),
    prisma.product.count({ where: { businessId: business.id } }),
    prisma.category.count({ where: { businessId: business.id } }),
    prisma.sale.count({ where: { businessId: business.id } }),
    prisma.cashSession.count({ where: { businessId: business.id } }),
    prisma.inventoryItem.count({ where: { businessId: business.id } }),
    prisma.inventoryWarehouse.count({ where: { businessId: business.id } }),
    prisma.stockTransfer.count({ where: { businessId: business.id } }),
    prisma.coupon.count({ where: { businessId: business.id } })
  ]);

  console.log('Tenant permanent delete preview');
  console.table([
    { item: 'Business', count: 1 },
    { item: 'Membership/User terkait', count: users },
    { item: 'Outlet', count: outlets },
    { item: 'Product', count: products },
    { item: 'Category', count: categories },
    { item: 'Sales/Orders', count: sales },
    { item: 'Cash Sessions', count: cashSessions },
    { item: 'Inventory Items', count: inventoryItems },
    { item: 'Warehouses', count: warehouses },
    { item: 'Stock Transfers', count: stockTransfers },
    { item: 'Coupons', count: coupons }
  ]);

  if (!args.execute) {
    console.log('');
    console.log('DRY RUN saja. Tidak ada data yang dihapus.');
    console.log(`Untuk hapus permanen jalankan ulang dengan: --execute --confirm ${code}`);
    return;
  }

  if (args.confirm !== code) {
    throw new Error(`Konfirmasi salah. Gunakan: --execute --confirm ${code}`);
  }

  const memberUserIds = business.memberships.map(row => row.userId);

  const salesRows = await prisma.sale.findMany({
    where: { businessId: business.id },
    select: { id: true }
  });
  const cashSessionRows = await prisma.cashSession.findMany({
    where: { businessId: business.id },
    select: { id: true }
  });
  const stockTransferRows = await prisma.stockTransfer.findMany({
    where: { businessId: business.id },
    select: { id: true }
  });

  const entityIds = [
    ...salesRows.map(row => row.id),
    ...cashSessionRows.map(row => row.id),
    ...stockTransferRows.map(row => row.id)
  ];

  await prisma.$transaction(
    async tx => {
      if (entityIds.length > 0) {
        await tx.idempotencyKey.deleteMany({
          where: { entityId: { in: entityIds } }
        });
      }

      await tx.couponUsage.deleteMany({
        where: {
          OR: [
            { sale: { businessId: business.id } },
            { coupon: { businessId: business.id } }
          ]
        }
      });
      await tx.couponOutlet.deleteMany({ where: { coupon: { businessId: business.id } } });
      await tx.couponProduct.deleteMany({ where: { coupon: { businessId: business.id } } });
      await tx.couponCategory.deleteMany({ where: { coupon: { businessId: business.id } } });
      await tx.coupon.deleteMany({ where: { businessId: business.id } });

      await tx.printerLog.deleteMany({ where: { businessId: business.id } });
      await tx.auditLog.deleteMany({ where: { businessId: business.id } });

      await tx.saleItemAddon.deleteMany({
        where: {
          OR: [
            { saleItem: { sale: { businessId: business.id } } },
            { addon: { product: { businessId: business.id } } }
          ]
        }
      });
      await tx.saleItem.deleteMany({ where: { sale: { businessId: business.id } } });
      await tx.sale.deleteMany({ where: { businessId: business.id } });
      await tx.expense.deleteMany({ where: { businessId: business.id } });
      await tx.cashSession.deleteMany({ where: { businessId: business.id } });

      await tx.stockTransferItem.deleteMany({
        where: { transfer: { businessId: business.id } }
      });
      await tx.stockTransfer.deleteMany({ where: { businessId: business.id } });

      await tx.inventoryMovement.deleteMany({ where: { businessId: business.id } });
      await tx.inventoryAlertLog.deleteMany({
        where: { item: { businessId: business.id } }
      });
      await tx.inventoryStock.deleteMany({
        where: {
          OR: [
            { item: { businessId: business.id } },
            { warehouse: { businessId: business.id } }
          ]
        }
      });
      await tx.productRecipe.deleteMany({
        where: {
          OR: [
            { product: { businessId: business.id } },
            { item: { businessId: business.id } }
          ]
        }
      });
      await tx.inventoryUnitConversion.deleteMany({
        where: { item: { businessId: business.id } }
      });

      await tx.variantOptionOutlet.deleteMany({
        where: {
          OR: [
            { outlet: { businessId: business.id } },
            { option: { group: { businessId: business.id } } }
          ]
        }
      });
      await tx.productChannelPrice.deleteMany({
        where: {
          OR: [
            { product: { businessId: business.id } },
            { outlet: { businessId: business.id } }
          ]
        }
      });
      await tx.productOutlet.deleteMany({
        where: {
          OR: [
            { product: { businessId: business.id } },
            { outlet: { businessId: business.id } }
          ]
        }
      });
      await tx.productVariantGroup.deleteMany({
        where: {
          OR: [
            { product: { businessId: business.id } },
            { group: { businessId: business.id } }
          ]
        }
      });
      await tx.productAddon.deleteMany({ where: { product: { businessId: business.id } } });
      await tx.productVariant.deleteMany({ where: { product: { businessId: business.id } } });
      await tx.product.deleteMany({ where: { businessId: business.id } });
      await tx.variantGroup.deleteMany({ where: { businessId: business.id } });

      await tx.outlet.updateMany({
        where: { businessId: business.id },
        data: { inventoryWarehouseId: null }
      });
      await tx.user.updateMany({
        where: { assignedWarehouse: { businessId: business.id } },
        data: { assignedWarehouseId: null }
      });
      await tx.inventoryWarehouse.deleteMany({ where: { businessId: business.id } });
      await tx.inventoryItem.deleteMany({ where: { businessId: business.id } });
      await tx.inventoryCategory.deleteMany({ where: { businessId: business.id } });
      await tx.inventoryUnit.deleteMany({ where: { businessId: business.id } });
      await tx.expenseCategory.deleteMany({ where: { businessId: business.id } });
      await tx.category.deleteMany({ where: { businessId: business.id } });

      await tx.printer.deleteMany({ where: { businessId: business.id } });
      await tx.userOutlet.deleteMany({
        where: {
          OR: [
            { outlet: { businessId: business.id } },
            { userId: { in: memberUserIds } }
          ]
        }
      });
      await tx.outlet.deleteMany({ where: { businessId: business.id } });
      await tx.businessMembership.deleteMany({ where: { businessId: business.id } });
      await tx.business.delete({ where: { id: business.id } });

      if (memberUserIds.length > 0) {
        await tx.user.deleteMany({
          where: {
            id: { in: memberUserIds },
            memberships: { none: {} }
          }
        });
      }
    },
    { timeout: 120_000 }
  );

  console.log(`Tenant ${code} berhasil dihapus permanen.`);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
