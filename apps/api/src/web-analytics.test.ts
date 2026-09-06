import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError, prisma } from './lib.js';
import { createAnalyticsRateLimit, metrics, orderAttribution, recordOrderAnalytics, reconcileOrderAnalytics, registerAdminAnalytics, registerPublicAnalytics, reportInput, trackingInput } from './web-analytics.js';

vi.mock('./lib.js', async importOriginal => ({
  ...await importOriginal<typeof import('./lib.js')>(),
  prisma: { product: { findFirst: vi.fn() }, outlet: { findMany: vi.fn() }, sale: { findMany: vi.fn() }, webAnalyticsEvent: { createMany: vi.fn(), upsert: vi.fn() }, $queryRaw: vi.fn() },
}));
const attribution = { visitorId: 'visitor_12345678', sessionId: 'session_12345678', source: 'qr' };
const event = { ...attribution, businessSlug: 'business-a', outletSlug: 'outlet-a', eventId: 'event_12345678', eventType: 'PAGE_VIEW' };
const resolve = vi.fn(async () => ({ business: { id: 'biz_a' }, outlet: { id: 'outlet_a', businessId: 'biz_a', customerOrderingEnabled: true } }));
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  const publicRouter = express.Router(); registerPublicAnalytics(publicRouter, resolve); app.use(publicRouter);
  app.use((req, _res, next) => { req.user = { id: 'user_a', businessId: 'biz_a', membershipId: 'member_a', role: req.headers['x-role'] === 'CASHIER' ? 'CASHIER' : 'OWNER', outletIds: ['outlet_a'], inventoryPermissions: [], assignedWarehouseId: null }; next(); });
  const adminRouter = express.Router(); registerAdminAnalytics(adminRouter); app.use(adminRouter);
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => { res.status(error instanceof z.ZodError ? 400 : error instanceof ApiError ? error.status : 500).json({ error: 'test' }); };
  app.use(errors);
  await new Promise<void>((done, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : done()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); });
beforeEach(() => {
  vi.clearAllMocks();
  resolve.mockResolvedValue({ business: { id: 'biz_a' }, outlet: { id: 'outlet_a', businessId: 'biz_a', customerOrderingEnabled: true } });
  vi.mocked(prisma.product.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.outlet.findMany).mockResolvedValue([{ id: 'outlet_a', name: 'Outlet A' }] as never);
  vi.mocked(prisma.webAnalyticsEvent.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.webAnalyticsEvent.upsert).mockResolvedValue({} as never);
});
const post = (body: unknown) => fetch(`${base}/public/web-analytics/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('public analytics isolation and validation', () => {
  it('resolves tenant on server and writes only anonymous fields', async () => {
    expect((await post(event)).status).toBe(204);
    expect(resolve).toHaveBeenCalledWith('business-a', 'outlet-a');
    expect(prisma.webAnalyticsEvent.createMany).toHaveBeenCalledWith({ data: [{ businessId: 'biz_a', outletId: 'outlet_a', ...attribution, eventId: event.eventId, eventType: 'PAGE_VIEW', productId: undefined }], skipDuplicates: true });
  });
  it.each([{ businessId: 'biz_b' }, { outletId: 'outlet_b' }, { orderId: 'order_b' }, { eventType: 'ORDER_CREATED' }, { visitorId: '' }])('rejects forged fields %j', async fields => {
    expect((await post({ ...event, ...fields })).status).toBe(400);
    expect(prisma.webAnalyticsEvent.createMany).not.toHaveBeenCalled();
  });
  it('rejects mismatched tenant even if a resolver returns it', async () => {
    resolve.mockResolvedValue({ business: { id: 'biz_a' }, outlet: { id: 'outlet_b', businessId: 'biz_b', customerOrderingEnabled: true } });
    expect((await post(event)).status).toBe(403);
    expect(prisma.webAnalyticsEvent.createMany).not.toHaveBeenCalled();
  });
  it('rejects disabled Web Order', async () => {
    resolve.mockResolvedValue({ business: { id: 'biz_a' }, outlet: { id: 'outlet_a', businessId: 'biz_a', customerOrderingEnabled: false } });
    expect((await post(event)).status).toBe(403);
  });
  it('rejects a product outside the tenant/outlet', async () => {
    expect((await post({ ...event, eventType: 'ADD_TO_CART', productId: 'product_b' })).status).toBe(400);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'product_b', businessId: 'biz_a', status: 'ACTIVE', outlets: { some: { outletId: 'outlet_a', isActive: true, status: 'ACTIVE' } } } }));
    expect(prisma.webAnalyticsEvent.createMany).not.toHaveBeenCalled();
  });
  it('normalizes unknown sources and limits input length', () => {
    expect(orderAttribution({ ...attribution, source: 'unexpected' }).source).toBe('other');
    expect(trackingInput.safeParse({ ...event, source: 'x'.repeat(51) }).success).toBe(false);
  });
  it('bounds bursts independently of visitor-controlled IDs and expires buckets', () => {
    const limit = createAnalyticsRateLimit(2, 100);
    limit('ip', 0); limit('ip', 1);
    expect(() => limit('ip', 2)).toThrow(ApiError);
    expect(() => limit('ip', 100)).not.toThrow();
  });
});

describe('durable order attribution', () => {
  const order = { id: 'order_a', businessId: 'biz_a', outletId: 'outlet_a', createdAt: new Date('2026-09-01T00:00:00Z'), webAnalytics: attribution };
  it('uses the committed order ID as a unique key and preserves creation time', async () => {
    await recordOrderAnalytics(order); await recordOrderAnalytics(order);
    for (const [input] of vi.mocked(prisma.webAnalyticsEvent.upsert).mock.calls) {
      expect(input.where).toEqual({ orderId: 'order_a' }); expect(input.update).toEqual({});
      expect(input.create).toMatchObject({ ...attribution, orderId: 'order_a', businessId: 'biz_a', outletId: 'outlet_a', eventType: 'ORDER_CREATED', createdAt: order.createdAt });
    }
  });
  it('recovers pending events after a failed write', async () => {
    vi.mocked(prisma.webAnalyticsEvent.upsert).mockRejectedValueOnce(new Error('offline'));
    await expect(recordOrderAnalytics(order)).rejects.toThrow('offline');
    vi.mocked(prisma.sale.findMany).mockResolvedValue([order] as never);
    await reconcileOrderAnalytics();
    expect(prisma.sale.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orderSource: 'CUSTOMER_WEB', webAnalytics: { not: Prisma.DbNull }, analyticsEvents: { none: { eventType: 'ORDER_CREATED' } } }, take: 100 }));
    expect(prisma.webAnalyticsEvent.upsert).toHaveBeenCalledTimes(2);
  });
  it('malformed optional metadata never prevents order attribution', () => {
    expect(orderAttribution({ visitorId: '<bad>' })).toMatchObject({ source: 'direct' });
    expect(orderAttribution(null).visitorId).toMatch(/^foru_web_/);
  });
});

describe('owner reports', () => {
  const reportPath = '/admin/web-analytics?startDate=2026-09-01&endDate=2026-09-30';
  it('denies cashier access', async () => {
    expect((await fetch(base + reportPath, { headers: { 'x-role': 'CASHIER' } })).status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('denies an outlet from another business before aggregation', async () => {
    expect((await fetch(base + reportPath + '&outletId=outlet_b')).status).toBe(403);
    expect(prisma.outlet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: 'biz_a' } }));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('uses tenant-bound SQL, inclusive WIB dates, and serializes counts and empty outlets', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ kind: 'total', key: null, uniqueVisitors: 3n, pageViews: 5n, addToCart: 2n, orders: 1n }]);
    const response = await fetch(base + reportPath); expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ uniqueVisitors: 3, pageViews: 5, orders: 1, conversionRate: 33.33, outletComparison: [{ id: 'outlet_a', uniqueVisitors: 0 }] });
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as Prisma.Sql;
    expect(sql.values).toEqual(['biz_a', new Date('2026-08-31T17:00:00Z'), new Date('2026-09-30T17:00:00Z')]);
    expect(sql.sql).toContain('COUNT(DISTINCT visitor_id)');
  });
  it('filters the selected outlet with a parameter', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    expect((await fetch(base + reportPath + '&outletId=outlet_a')).status).toBe(200);
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as Prisma.Sql;
    expect(sql.values).toContain('outlet_a');
  });
  it.each([['2026-02-30', '2026-03-01'], ['2026-09-02', '2026-09-01'], ['garbage', '2026-09-01']])('rejects invalid range %s to %s', (startDate, endDate) => {
    expect(reportInput.safeParse({ startDate, endDate }).success).toBe(false);
  });
  it('handles zero denominators', () => {
    expect(metrics()).toEqual({ uniqueVisitors: 0, pageViews: 0, addToCart: 0, orders: 0, conversionRate: 0, visitorToCart: 0, cartToOrder: 0 });
  });
});
