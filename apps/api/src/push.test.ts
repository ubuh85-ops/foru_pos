import { describe, expect, it } from 'vitest';
import { customerWebOrderPushContent } from './push.js';

const base = {
  id: 'order-1', businessId: 'business-1', outletId: 'outlet-1', orderNumber: 'ORD-001', customerName: 'Budi',
  orderType: 'TAKE_AWAY', scheduledAt: null, grandTotal: 25000, outlet: { name: 'FORU Mozz', timezone: 'Asia/Jakarta' }
};

describe('customer web order push', () => {
  it('routes immediate orders to order detail', () => {
    expect(customerWebOrderPushContent({ ...base, isPreOrder: false }).data.route).toBe('/orders/order-1');
  });

  it('routes pre-orders to the recap page', () => {
    expect(customerWebOrderPushContent({ ...base, isPreOrder: true, scheduledAt: new Date('2026-08-30T03:00:00Z') }).data.route).toBe('/orders/preorder-recap');
  });
});
