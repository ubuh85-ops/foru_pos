import { PaymentMethod, Prisma } from '@prisma/client';
import type { Request, Router } from 'express';
import { z } from 'zod';
import { allow, ApiError, asyncRoute, money, prisma, tenantScope } from './lib.js';

const outletInput = z.string().trim().min(1).max(100).optional();
export const dailyReportInput = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(9999),
  type: z.enum(['revenue', 'payment-method']).default('revenue'),
  outletId: outletInput,
}).strict();
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Tanggal tidak valid');
export const dailyTransactionsInput = z.object({
  date: dateInput, outletId: outletInput,
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

// Match existing sales reports: creation date in WIB, PAID grandTotal before channel fees.
export function monthRange(year: number, month: number) {
  return { gte: new Date(Date.UTC(year, month - 1, 1) - 7 * 3_600_000), lt: new Date(Date.UTC(year, month, 1) - 7 * 3_600_000) };
}
export function dailyReportScope(req: Request, outletId?: string) {
  return { ...tenantScope(req), ...(outletId ? { outletId } : {}) };
}
type GroupedRow = { date: string; paymentMethod: string | null; total: Prisma.Decimal | number | string; count: bigint | number };
const paymentLabel = (id: string) => id === 'OTHER' ? 'Lainnya' : id === 'CASH' ? 'Cash' : id;
export function buildDailyReport(input: Pick<z.infer<typeof dailyReportInput>, 'month' | 'year' | 'type'>, grouped: GroupedRow[]) {
  const ids: string[] = Object.values(PaymentMethod);
  for (const group of grouped) {
    const id = group.paymentMethod || 'OTHER';
    if (!ids.includes(id)) ids.push(id);
  }
  const paymentMethods = ids.map(id => ({ id, label: paymentLabel(id) }));
  const emptyPayments = () => Object.fromEntries(ids.map(id => [id, 0]));
  const rows = Array.from({ length: new Date(Date.UTC(input.year, input.month, 0)).getUTCDate() }, (_, index) => ({
    date: `${input.year}-${String(input.month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
    totalRevenue: 0, orderCount: 0, averageOrderValue: 0, payments: emptyPayments(),
  }));
  const byDate = new Map(rows.map(row => [row.date, row]));
  for (const group of grouped) {
    const row = byDate.get(group.date);
    if (!row) continue;
    const amount = Number(group.total), id = group.paymentMethod || 'OTHER';
    row.totalRevenue = money(row.totalRevenue + amount);
    row.orderCount += Number(group.count);
    row.payments[id] = money((row.payments[id] ?? 0) + amount);
  }
  const totals = { totalRevenue: 0, orderCount: 0, averageOrderValue: 0, payments: emptyPayments() };
  for (const row of rows) {
    row.averageOrderValue = row.orderCount ? money(row.totalRevenue / row.orderCount) : 0;
    totals.totalRevenue = money(totals.totalRevenue + row.totalRevenue);
    totals.orderCount += row.orderCount;
    for (const id of ids) totals.payments[id] = money((totals.payments[id] ?? 0) + (row.payments[id] ?? 0));
  }
  totals.averageOrderValue = totals.orderCount ? money(totals.totalRevenue / totals.orderCount) : 0;
  const top = paymentMethods.reduce<(typeof paymentMethods)[number] | null>((best, method) =>
    (totals.payments[method.id] ?? 0) > (best ? totals.payments[best.id] ?? 0 : 0) ? method : best, null);
  return { ...input, timeZone: 'Asia/Jakarta', dateBasis: 'createdAt', paymentMethods, rows, totals,
    topPaymentMethod: top ? { ...top, amount: totals.payments[top.id] ?? 0, percentage: totals.totalRevenue ? money((totals.payments[top.id] ?? 0) / totals.totalRevenue * 100) : 0 } : null };
}
async function reportOutlets(req: Request, outletId?: string) {
  const outlets = await prisma.outlet.findMany({ where: tenantScope(req), select: { id: true, name: true }, orderBy: { name: 'asc' } });
  if (outletId && !outlets.some(outlet => outlet.id === outletId)) throw new ApiError(403, 'Outlet tidak diizinkan');
  return outlets;
}
export function registerDailyReports(router: Router) {
  router.get('/reports/daily', allow('OWNER'), asyncRoute(async (req, res, next) => {
    // Preserve the existing single-day endpoint used by other reports.
    if (req.query.month === undefined && req.query.year === undefined) return next();
    const input = dailyReportInput.parse(req.query);
    const scope = dailyReportScope(req, input.outletId);
    const outlets = await reportOutlets(req, input.outletId);
    const range = monthRange(input.year, input.month);
    const grouped = await prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
      SELECT to_char(created_at + interval '7 hours', 'YYYY-MM-DD') AS date,
             payment_method::text AS "paymentMethod", SUM(grand_total) AS total, COUNT(*) AS count
      FROM sales
      WHERE business_id = ${scope.businessId} AND status = 'PAID'
        AND created_at >= ${range.gte} AND created_at < ${range.lt}
        ${input.outletId ? Prisma.sql`AND outlet_id = ${input.outletId}` : Prisma.empty}
      GROUP BY 1, 2 ORDER BY 1, 2
    `);
    res.json({ ...buildDailyReport({ month: input.month, year: input.year, type: input.type }, grouped), outlets });
  }));
  router.get('/reports/daily/transactions', allow('OWNER'), asyncRoute(async (req, res) => {
    const input = dailyTransactionsInput.parse(req.query);
    const scope = dailyReportScope(req, input.outletId);
    await reportOutlets(req, input.outletId);
    const start = new Date(`${input.date}T00:00:00+07:00`);
    const where: Prisma.SaleWhereInput = { ...scope, status: 'PAID', createdAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } };
    const [sales, total] = await prisma.$transaction([
      prisma.sale.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        select: { id: true, createdAt: true, orderNumber: true, transactionNumber: true, customerName: true, orderType: true,
          paymentMethod: true, grandTotal: true, cashier: { select: { name: true } }, outlet: { select: { name: true } } } }),
      prisma.sale.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    res.json({ date: input.date, page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize),
      transactions: sales.map(sale => ({ id: sale.id, createdAt: sale.createdAt, orderNumber: sale.orderNumber,
        transactionNumber: sale.transactionNumber, customerName: sale.customerName, orderType: sale.orderType,
        paymentMethod: sale.paymentMethod || 'OTHER', total: Number(sale.grandTotal), cashierName: sale.cashier?.name || '—', outletName: sale.outlet.name })) });
  }));
}
