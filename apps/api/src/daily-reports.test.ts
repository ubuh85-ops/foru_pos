import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';
import { PaymentMethod, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError, prisma } from './lib.js';
import { registerDailyReports } from './daily-reports.js';

vi.mock('./lib.js', async importOriginal => ({
  ...await importOriginal<typeof import('./lib.js')>(),
  prisma: {
    outlet: { findMany: vi.fn() },
    sale: { findMany: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  },
}));
let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'owner_a', businessId: 'biz_a', membershipId: 'member_a', role: req.headers['x-role'] === 'CASHIER' ? 'CASHIER' : req.headers['x-role'] === 'SUPERVISOR' ? 'SUPERVISOR' : 'OWNER', outletIds: ['outlet_a'], inventoryPermissions: [], assignedWarehouseId: null };
    next();
  });
  registerDailyReports(app);
  app.get('/reports/daily', (_req, res) => res.json({ legacy: true }));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    res.status(error instanceof z.ZodError ? 400 : error instanceof ApiError ? error.status : 500).json({ error: String(error) });
  };
  app.use(errors);
  await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.outlet.findMany).mockResolvedValue([{ id: 'outlet_a', name: 'Outlet A' }] as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
  vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
  vi.mocked(prisma.sale.count).mockResolvedValue(0);
});
const report = '/reports/daily?month=9&year=2026&type=revenue';
const detail = '/reports/daily/transactions?date=2026-09-04';

describe('daily report authorization and input', () => {
  it.each(['CASHIER', 'SUPERVISOR'])('denies %s before any database query', async role => {
    for (const path of [report, detail]) expect((await fetch(base + path, { headers: { 'x-role': role } })).status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });
  it.each([report, detail])('rejects foreign outlet for %s', async path => {
    expect((await fetch(base + path + '&outletId=foreign_outlet')).status).toBe(403);
    expect(prisma.outlet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 'biz_a' }) }));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });
  it.each(['month=0&year=2026', 'month=13&year=2026', 'month=9.5&year=2026', 'month=9&year=oops', 'month=9&year=2026&type=unknown'])('rejects invalid %s', async query => {
    expect((await fetch(`${base}/reports/daily?${query}`)).status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('keeps legacy daily report requests available', async () => {
    expect(await (await fetch(`${base}/reports/daily?date=2026-09-04`)).json()).toEqual({ legacy: true });
  });
});

describe('daily database aggregation', () => {
  it.each([[2026, 2, 28], [2028, 2, 29], [2026, 9, 30], [2026, 12, 31]])('fills every day of %i-%i', async (year, month, days) => {
    const response = await fetch(`${base}/reports/daily?month=${month}&year=${year}&type=revenue`);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.rows).toHaveLength(days);
    expect(result.rows[0]).toMatchObject({ date: `${year}-${String(month).padStart(2, '0')}-01`, totalRevenue: 0, orderCount: 0, averageOrderValue: 0 });
    expect(result.rows[days - 1].date).toBe(`${year}-${String(month).padStart(2, '0')}-${days}`);
    expect(result.totals).toMatchObject({ totalRevenue: 0, orderCount: 0, averageOrderValue: 0 });
    expect(result.topPaymentMethod).toBeNull();
    expect(result.paymentMethods.map((method: { id: string }) => method.id)).toEqual(expect.arrayContaining(Object.values(PaymentMethod)));
  });
  it('uses weighted AOV and reconciles method totals including missing legacy method', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { date: '2026-09-02', paymentMethod: 'CASH', total: new Prisma.Decimal('50000'), count: 1n },
      { date: '2026-09-02', paymentMethod: 'QRIS', total: '101500', count: 7n },
      { date: '2026-09-03', paymentMethod: null, total: 51150, count: 3n },
    ]);
    const result = await (await fetch(base + report.replace('revenue', 'payment-method'))).json();
    expect(result.rows[1]).toMatchObject({ totalRevenue: 151500, orderCount: 8, averageOrderValue: 18937.5, payments: { CASH: 50000, QRIS: 101500 } });
    expect(result.rows[2].payments.OTHER).toBe(51150);
    expect(result.totals).toMatchObject({ totalRevenue: 202650, orderCount: 11 });
    expect(result.totals.averageOrderValue).toBeCloseTo(202650 / 11, 2);
    expect(Object.values(result.totals.payments).reduce<number>((sum, value) => sum + Number(value), 0)).toBe(result.totals.totalRevenue);
    expect(result.topPaymentMethod).toMatchObject({ id: 'QRIS', amount: 101500 });
    expect(result.topPaymentMethod.percentage).toBeCloseTo(101500 / 202650 * 100, 2);
  });
  it('binds session tenant, selected outlet, and half-open WIB month boundaries in PAID aggregation', async () => {
    expect((await fetch(base + report + '&outletId=outlet_a')).status).toBe(200);
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as Prisma.Sql;
    expect(sql.values).toEqual(expect.arrayContaining(['biz_a', 'outlet_a', new Date('2026-08-31T17:00:00Z'), new Date('2026-09-30T17:00:00Z')]));
    expect(sql.sql).toMatch(/status\s*=\s*'PAID'/);
    expect(sql.sql).toContain('GROUP BY');
    expect(sql.sql).toContain('SUM(');
    expect(sql.sql).toContain('grand_total');
    expect(sql.sql).toContain('created_at >=');
    expect(sql.sql).toContain('created_at <');
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });
  it('cannot authorize a forged businessId query parameter', async () => {
    const response = await fetch(base + report + '&businessId=foreign_business');
    expect([200, 400]).toContain(response.status);
    for (const [query] of vi.mocked(prisma.$queryRaw).mock.calls) {
      expect((query as Prisma.Sql).values).toContain('biz_a');
      expect((query as Prisma.Sql).values).not.toContain('foreign_business');
    }
  });
});

describe('daily transaction drilldown', () => {
  it.each(['2026-02-30', 'invalid', '2026-9-4'])('rejects invalid date %s', async date => {
    expect((await fetch(`${base}/reports/daily/transactions?date=${date}`)).status).toBe(400);
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });
  it('queries only paid tenant/day/outlet sales with bounded pagination and matching count', async () => {
    expect((await fetch(base + detail + '&outletId=outlet_a&page=2&pageSize=10')).status).toBe(200);
    const args = vi.mocked(prisma.sale.findMany).mock.calls[0]?.[0];
    expect(args).toMatchObject({ where: { businessId: 'biz_a', outletId: 'outlet_a', status: 'PAID', createdAt: { gte: new Date('2026-09-03T17:00:00Z'), lt: new Date('2026-09-04T17:00:00Z') } }, skip: 10, take: 10 });
    expect(prisma.sale.count).toHaveBeenCalledWith({ where: args?.where });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
  it('returns detail fields and page count, preserving legacy order identity and nullable cashier', async () => {
    vi.mocked(prisma.sale.count).mockResolvedValue(26);
    vi.mocked(prisma.sale.findMany).mockResolvedValue([{
      id: 'sale_a', createdAt: new Date('2026-09-04T01:15:00Z'), orderNumber: null, transactionNumber: 'TRX-1',
      customerName: 'Walk In', orderType: 'TAKEAWAY', paymentMethod: null, grandTotal: new Prisma.Decimal('151500'),
      cashier: null, outlet: { name: 'Outlet A' },
    }] as never);
    const result = await (await fetch(base + detail)).json();
    expect(result).toMatchObject({ page: 1, pageSize: 25, total: 26, totalPages: 2, transactions: [{
      id: 'sale_a', createdAt: '2026-09-04T01:15:00.000Z', transactionNumber: 'TRX-1', customerName: 'Walk In',
      orderType: 'TAKEAWAY', paymentMethod: 'OTHER', total: 151500, cashierName: '—', outletName: 'Outlet A',
    }] });
  });
  it.each(['page=0', 'page=-1', 'pageSize=10000'])('rejects invalid pagination %s', async query => {
    expect((await fetch(base + detail + '&' + query)).status).toBe(400);
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });
});
