import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from './lib.js';
import { nextSaleNumber } from './sale-numbers.js';

vi.mock('./lib.js', async importOriginal => ({
  ...await importOriginal<typeof import('./lib.js')>(),
  prisma: {
    outlet: { findUniqueOrThrow: vi.fn() },
    sale: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.outlet.findUniqueOrThrow).mockResolvedValue({ code: 'FORU' } as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ value: 1n }]);
});
const now = new Date('2026-09-07T03:00:00Z');
const lastSql = () => vi.mocked(prisma.$queryRaw).mock.calls.at(-1)?.[0] as Prisma.Sql;

describe('atomic sale number allocation', () => {
  it('formats the allocated value and uses WIB date across UTC midnight', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ value: 42n }]);
    expect(await nextSaleNumber('TRX', 'outlet_a', 'transactionNumber', new Date('2026-09-06T17:00:00Z'))).toBe('TRX-FORU-20260907-0042');
    expect(prisma.outlet.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'outlet_a' } }));
    expect(prisma.sale.count).not.toHaveBeenCalled();
  });
  it('retains the previous WIB day immediately before its midnight', async () => {
    expect(await nextSaleNumber('ORD', 'outlet_a', 'orderNumber', new Date('2026-09-06T16:59:59.999Z'))).toBe('ORD-FORU-20260906-0001');
  });
  it('does not truncate counter values beyond four digits', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ value: 10001n }]);
    expect(await nextSaleNumber('TRX', 'outlet_a', 'transactionNumber', now)).toBe('TRX-FORU-20260907-10001');
  });
  it.each([['ORD', 'orderNumber', 'order_number'], ['TRX', 'transactionNumber', 'transaction_number']] as const)('initializes %s from the highest existing suffix across all creation dates', async (prefix, field, column) => {
    await nextSaleNumber(prefix, 'outlet_a', field, now);
    const sql = lastSql();
    expect(sql.sql).toContain(column);
    expect(sql.sql).toMatch(/MAX\s*\(/i);
    expect(sql.sql).not.toMatch(/created_at|paid_at|COUNT\s*\(/i);
    expect(sql.values).toContain(`${prefix}-FORU-20260907-`);
    expect(prisma.sale.count).not.toHaveBeenCalled();
  });
  it('allocates with one atomic insert/update rather than a read then write', async () => {
    await nextSaleNumber('TRX', 'outlet_a', 'transactionNumber', now);
    const sql = lastSql();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(sql.sql).toMatch(/INSERT INTO/i);
    expect(sql.sql).toMatch(/ON CONFLICT/i);
    expect(sql.sql).toMatch(/DO UPDATE/i);
    expect(sql.sql).toMatch(/\+\s*1/);
    expect(sql.sql).toMatch(/RETURNING/i);
  });
  it('parameterizes an unusual outlet code and prefix instead of interpolating into SQL text', async () => {
    const code = "A'; DROP TABLE sales; --";
    const prefix = "T'RX";
    vi.mocked(prisma.outlet.findUniqueOrThrow).mockResolvedValue({ code } as never);
    await nextSaleNumber(prefix, 'outlet_a', 'transactionNumber', now);
    const sql = lastSql();
    expect(sql.sql).not.toContain(code);
    expect(sql.sql).not.toContain(prefix);
    expect(sql.values).toContain(`${prefix}-${code}-20260907-`);
  });
  it.each([{ rows: [] }, { rows: [{ value: 0n }] }, { rows: [{ value: -1n }] }])('fails closed when the allocator returns no valid reservation (case $' + '#)', async ({ rows }) => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(rows);
    await expect(nextSaleNumber('TRX', 'outlet_a', 'transactionNumber', now)).rejects.toThrow('Nomor transaksi tidak dapat dialokasikan');
  });
  it('shares the namespace when two outlets have the same visible code, matching globally unique sale numbers', async () => {
    await nextSaleNumber('TRX', 'outlet_a', 'transactionNumber', now);
    const first = lastSql();
    await nextSaleNumber('TRX', 'outlet_b', 'transactionNumber', now);
    expect(lastSql().values).toEqual(first.values);
  });
});
