import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Request, Router } from 'express';
import { allow, ApiError, asyncRoute, dayRange, prisma, tenantScope } from './lib.js';

const anonymousId = z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const attributionInput = z.object({
  visitorId: anonymousId,
  sessionId: anonymousId,
  source: z.string().trim().max(50).default('direct'),
});
export function normalizeSource(source: string) {
  const value = source.toLowerCase();
  return ['qr', 'whatsapp', 'instagram', 'table', 'flyer', 'direct'].includes(value) ? value : 'other';
}
export function orderAttribution(value: unknown) {
  const parsed = attributionInput.safeParse(value);
  const data = parsed.success ? parsed.data : { visitorId: `foru_web_${randomUUID()}`, sessionId: randomUUID(), source: 'direct' };
  return { ...data, source: normalizeSource(data.source) };
}
export const trackingInput = attributionInput.extend({
  businessSlug: z.string().trim().min(1).max(120),
  outletSlug: z.string().trim().min(1).max(120),
  eventId: anonymousId,
  eventType: z.enum(['PAGE_VIEW', 'ADD_TO_CART']),
  productId: z.string().min(1).max(100).nullable().optional(),
}).strict();

type ResolvedOutlet = { business: { id: string }; outlet: { id: string; businessId: string; customerOrderingEnabled: boolean } };
type Resolver = (businessSlug: string, outletSlug: string) => Promise<ResolvedOutlet>;
export function createAnalyticsRateLimit(max = 180, windowMs = 60_000) {
  const buckets = new Map<string, { count: number; expires: number }>();
  return (key: string, now = Date.now()) => {
    for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10_000) throw new ApiError(429, 'Analytics sedang sibuk');
      bucket = { count: 0, expires: now + windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > max) throw new ApiError(429, 'Terlalu banyak event analytics');
  };
}

export function registerPublicAnalytics(router: Router, resolveOutlet: Resolver) {
  const rateLimit = createAnalyticsRateLimit();
  router.post('/public/web-analytics/events', asyncRoute(async (req, res) => {
    rateLimit(req.ip || 'unknown');
    const data = trackingInput.parse(req.body);
    const { business, outlet } = await resolveOutlet(data.businessSlug, data.outletSlug);
    if (outlet.businessId !== business.id || !outlet.customerOrderingEnabled) throw new ApiError(403, 'Web Order tidak tersedia');
    if (data.productId) {
      const product = await prisma.product.findFirst({ where: {
        id: data.productId, businessId: business.id, status: 'ACTIVE',
        outlets: { some: { outletId: outlet.id, isActive: true, status: 'ACTIVE' } },
      }, select: { id: true } });
      if (!product) throw new ApiError(400, 'Produk tidak tersedia di outlet ini');
    }
    await prisma.webAnalyticsEvent.createMany({ data: [{
      businessId: business.id, outletId: outlet.id, visitorId: data.visitorId,
      sessionId: data.sessionId, eventId: data.eventId, eventType: data.eventType,
      source: normalizeSource(data.source), productId: data.productId,
    }], skipDuplicates: true });
    res.status(204).end();
  }));
}

type AttributedOrder = { id: string; businessId: string; outletId: string; createdAt: Date; webAnalytics: Prisma.JsonValue };
export async function recordOrderAnalytics(order: AttributedOrder) {
  const parsed = attributionInput.safeParse(order.webAnalytics);
  if (!parsed.success) return;
  await prisma.webAnalyticsEvent.upsert({
    where: { orderId: order.id }, update: {},
    create: { ...parsed.data, source: normalizeSource(parsed.data.source), businessId: order.businessId,
      outletId: order.outletId, orderId: order.id, eventType: 'ORDER_CREATED', createdAt: order.createdAt },
  });
}

// Attribution is committed with the sale. Reconcile failed writes and process restarts.
export async function reconcileOrderAnalytics() {
  const orders = await prisma.sale.findMany({ where: {
    orderSource: 'CUSTOMER_WEB', webAnalytics: { not: Prisma.DbNull }, analyticsEvents: { none: { eventType: 'ORDER_CREATED' } },
  }, select: { id: true, businessId: true, outletId: true, createdAt: true, webAnalytics: true }, orderBy: { createdAt: 'asc' }, take: 100 });
  for (const order of orders) await recordOrderAnalytics(order);
}

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Tanggal tidak valid');
export const reportInput = z.object({ outletId: z.string().min(1).max(100).optional(), startDate: dateInput, endDate: dateInput })
  .refine(data => data.startDate <= data.endDate, 'Tanggal akhir harus setelah tanggal awal');

export function analyticsScope(req: Request, outletId?: string) {
  const scope = tenantScope(req);
  return { ...scope, ...(outletId ? { outletId } : {}) };
}
export function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round(numerator / denominator * 10_000) / 100 : 0;
}
type AggregateRow = { kind: string; key: string | null; uniqueVisitors: bigint; pageViews: bigint; addToCart: bigint; orders: bigint };
export function metrics(row?: AggregateRow) {
  const uniqueVisitors = Number(row?.uniqueVisitors || 0), pageViews = Number(row?.pageViews || 0);
  const addToCart = Number(row?.addToCart || 0), orders = Number(row?.orders || 0);
  return { uniqueVisitors, pageViews, addToCart, orders, conversionRate: percentage(orders, uniqueVisitors),
    visitorToCart: percentage(addToCart, uniqueVisitors), cartToOrder: percentage(orders, addToCart) };
}
export function registerAdminAnalytics(router: Router) {
  router.get('/admin/web-analytics', allow('OWNER'), asyncRoute(async (req, res) => {
    const query = reportInput.parse(req.query);
    const scope = analyticsScope(req, query.outletId);
    const outlets = await prisma.outlet.findMany({ where: { businessId: scope.businessId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    if (query.outletId && !outlets.some(outlet => outlet.id === query.outletId)) throw new ApiError(403, 'Outlet tidak diizinkan');
    const start = dayRange(query.startDate).gte, end = dayRange(query.endDate).lt;
    const rows = await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT CASE WHEN GROUPING(outlet_id) = 0 THEN 'outlet' WHEN GROUPING(source) = 0 THEN 'source' ELSE 'total' END AS kind,
        CASE WHEN GROUPING(outlet_id) = 0 THEN outlet_id WHEN GROUPING(source) = 0 THEN source ELSE NULL END AS key,
        COUNT(DISTINCT visitor_id) AS "uniqueVisitors",
        COUNT(*) FILTER (WHERE event_type = 'PAGE_VIEW') AS "pageViews",
        COUNT(*) FILTER (WHERE event_type = 'ADD_TO_CART') AS "addToCart",
        COUNT(*) FILTER (WHERE event_type = 'ORDER_CREATED') AS orders
      FROM web_analytics_events
      WHERE business_id = ${scope.businessId} AND created_at >= ${start} AND created_at < ${end}
        ${scope.outletId ? Prisma.sql`AND outlet_id = ${scope.outletId}` : Prisma.empty}
      GROUP BY GROUPING SETS ((), (outlet_id), (source))
    `);
    res.json({ ...metrics(rows.find(row => row.kind === 'total')), timezone: 'Asia/Jakarta', outlets,
      outletComparison: outlets.filter(outlet => !query.outletId || outlet.id === query.outletId).map(outlet => ({ ...outlet, ...metrics(rows.find(row => row.kind === 'outlet' && row.key === outlet.id)) })),
      trafficSources: rows.filter(row => row.kind === 'source').map(row => ({ source: row.key || 'direct', ...metrics(row) })),
    });
  }));
}
