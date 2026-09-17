import { describe, expect, it, vi } from 'vitest';
import { customerIdentity, customerSaleWhere, customerTenantWhere, isValidCustomerPhone, normalizeCustomerPhone, upsertWebOrderCustomer } from './customers.js';

describe('customer master', () => {
  it.each([
    ['0812 3456-7890', '+6281234567890'],
    ['6281234567890', '+6281234567890'],
    ['+62 812-3456-7890', '+6281234567890'],
    ['81234567890', '+6281234567890']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCustomerPhone(input)).toBe(expected);
  });

  it('rejects phone numbers outside the supported international length', () => {
    expect(isValidCustomerPhone('123')).toBe(false);
    expect(isValidCustomerPhone('+1234567890123456')).toBe(false);
  });

  it('keeps the same phone isolated by business', () => {
    expect(customerIdentity('business-a', '081234567890')).toEqual({
      businessId: 'business-a',
      phoneNormalized: '+6281234567890'
    });
    expect(customerIdentity('business-b', '081234567890')).toEqual({
      businessId: 'business-b',
      phoneNormalized: '+6281234567890'
    });
  });

  it('scopes customer lists and history to tenant and assigned outlets', () => {
    expect(customerTenantWhere('business-a', ['outlet-a'])).toEqual({businessId:'business-a',sales:{some:{businessId:'business-a',outletId:{in:['outlet-a']}}}});
    expect(customerSaleWhere('business-a','customer-a',['outlet-a'])).toEqual({businessId:'business-a',customerId:'customer-a',outletId:{in:['outlet-a']}});
    expect(customerSaleWhere('business-b','customer-a',['outlet-b'])).not.toEqual(customerSaleWhere('business-a','customer-a',['outlet-a']));
  });

  it('upserts a web customer using the tenant compound key', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'customer-1' });
    const tx = { customer: { upsert } } as any;
    await upsertWebOrderCustomer(tx, {
      businessId: 'business-a',
      customerName: ' Budi ',
      customerPhone: '0812-3456-7890',
      orderedAt: new Date('2026-09-16T01:00:00.000Z')
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        businessId_phoneNormalized: {
          businessId: 'business-a',
          phoneNormalized: '+6281234567890'
        }
      },
      create: expect.objectContaining({ name: 'Budi' }),
      update: expect.objectContaining({ name: 'Budi', status: 'ACTIVE' })
    }));
  });
});
