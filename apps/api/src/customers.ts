import type { Prisma } from '@prisma/client';

export function normalizeCustomerPhone(value: string): string {
  let digits = value.trim().replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  if (digits.length < 8 || digits.length > 15) throw new Error('Nomor WhatsApp tidak valid');
  return `+${digits}`;
}

export function isValidCustomerPhone(value: string): boolean {
  try {
    normalizeCustomerPhone(value);
    return true;
  } catch {
    return false;
  }
}

export function customerIdentity(businessId: string, phone: string) {
  return { businessId, phoneNormalized: normalizeCustomerPhone(phone) };
}

export function customerTenantWhere(businessId: string, outletIds?: string[]): Prisma.CustomerWhereInput {
  if (!businessId) throw new Error('Business tidak valid');
  return { businessId, ...(outletIds ? { sales: { some: { businessId, outletId: { in: outletIds } } } } : {}) };
}

export function customerSaleWhere(businessId: string, customerId?: string, outletIds?: string[]): Prisma.SaleWhereInput {
  if (!businessId) throw new Error('Business tidak valid');
  return { businessId, ...(customerId ? { customerId } : {}), ...(outletIds ? { outletId: { in: outletIds } } : {}) };
}

type WebOrderCustomerInput = {
  businessId: string;
  customerName: string;
  customerPhone: string;
  orderedAt?: Date;
};

export async function upsertWebOrderCustomer(tx: Prisma.TransactionClient, input: WebOrderCustomerInput) {
  const orderedAt = input.orderedAt ?? new Date();
  const identity = customerIdentity(input.businessId, input.customerPhone);
  return tx.customer.upsert({
    where: { businessId_phoneNormalized: identity },
    create: {
      ...identity,
      name: input.customerName.trim(),
      phoneDisplay: input.customerPhone.trim(),
      source: 'CUSTOMER_WEB',
      firstOrderAt: orderedAt,
      lastOrderAt: orderedAt
    },
    update: {
      name: input.customerName.trim(),
      phoneDisplay: input.customerPhone.trim(),
      lastOrderAt: orderedAt,
      status: 'ACTIVE'
    }
  });
}
