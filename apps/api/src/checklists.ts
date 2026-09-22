import { Prisma } from '@prisma/client';
import type { Request, Router } from 'express';
import { z } from 'zod';
import { allow, ApiError, assertOutlet, asyncRoute, prisma, tenantScope } from './lib.js';

export const sections = ['OPENING', 'OPERATIONAL', 'CLOSING'] as const;
export const defaults = {
  OPENING: ['Outlet dibuka tepat waktu', 'Area outlet bersih', 'Area produksi bersih', 'Peralatan produksi siap', 'POS dan printer siap', 'Bahan baku utama tersedia', 'Cup dan packaging tersedia', 'Cek menu yang habis', 'Update menu Sold Out', 'Buka shift kasir'],
  OPERATIONAL: ['Semua transaksi masuk POS', 'Pesanan Web Order diproses', 'Produk dibuat sesuai standar', 'Area kerja tetap bersih', 'Cek stok yang mulai menipis', 'Catat produk gagal / waste', 'Restock jika diperlukan'],
  CLOSING: ['Cek stok bahan utama', 'Catat stok habis / menipis', 'Siapkan kebutuhan restock besok', 'Bersihkan alat produksi', 'Bersihkan area outlet', 'Simpan bahan dengan benar', 'Buang sampah', 'Semua transaksi sudah masuk POS', 'Hitung cash', 'Cocokkan cash dengan POS', 'Pastikan expense sudah tercatat', 'Closing shift POS', 'Matikan peralatan', 'Cek gas dan listrik', 'Kunci outlet'],
};
export const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Tanggal tidak valid');
const idInput = z.string().min(1).max(100);
const templateInput = z.object({ title: z.string().trim().min(1).max(250), section: z.enum(sections), sortOrder: z.number().int().min(0).max(10000), active: z.boolean().default(true) }).strict();
const reorderInput = z.object({ items: z.array(z.object({ id: idInput, section: z.enum(sections), sortOrder: z.number().int().min(0).max(10000) }).strict()).min(1).max(500) }).strict();
export const reviewInput = z.object({ confirmed: z.literal(true), acceptIncomplete: z.boolean().default(false), note: z.string().trim().max(2000).default('') }).strict();
export function today(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function progress(items: { section: string; status: string }[]) {
  return sections.map(section => {
    const rows = items.filter(item => item.section === section), done = rows.filter(item => item.status === 'DONE').length;
    return { section, done, total: rows.length, percent: rows.length ? Math.round(done / rows.length * 100) : 0 };
  });
}
const include = { items: { orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }], include: { completer: { select: { name: true } } } }, reviewer: { select: { name: true } } } satisfies Prisma.DailyChecklistInclude;
type Daily = Prisma.DailyChecklistGetPayload<{ include: typeof include }>;
const present = (daily: Daily) => ({ ...daily, date: daily.date.toISOString().slice(0, 10), progress: progress(daily.items) });
async function outletFor(req: Request) {
  const id = idInput.parse(req.params.outletId);
  assertOutlet(req, id);
  const outlet = await prisma.outlet.findFirst({ where: { id, ...tenantScope(req) } });
  if (!outlet) throw new ApiError(404, 'Outlet tidak ditemukan');
  if (outlet.status !== 'ACTIVE') throw new ApiError(403, 'Checklist hanya tersedia untuk outlet aktif');
  return outlet;
}
// Serialize generation, template changes, ticks and reviews for the same outlet.
async function locked<T>(outletId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM outlets WHERE id = ${outletId} FOR UPDATE`;
    return work(tx);
  });
}
async function initialize(tx: Prisma.TransactionClient, businessId: string, outletId: string) {
  const outlet = await tx.outlet.findUniqueOrThrow({ where: { id: outletId } });
  if (outlet.checklistInitialized) return;
  await tx.checklistTemplateItem.createMany({ data: sections.flatMap(section => defaults[section].map((title, sortOrder) => ({ businessId, outletId, title, section, sortOrder }))) });
  await tx.outlet.update({ where: { id: outletId }, data: { checklistInitialized: true } });
}
const resetReview = { reviewStatus: 'NOT_REVIEWED' as const, reviewedBy: null, reviewedAt: null, reviewNote: null, pendingAtReview: null };
async function syncToday(tx: Prisma.TransactionClient, outlet: { id: string; businessId: string; timezone: string }, existing?: Daily) {
  const daily = existing ?? await tx.dailyChecklist.findUnique({ where: { businessId_outletId_date: { businessId: outlet.businessId, outletId: outlet.id, date: new Date(today(outlet.timezone)) } }, include });
  if (!daily) return null;
  const templates = await tx.checklistTemplateItem.findMany({ where: { businessId: outlet.businessId, outletId: outlet.id, active: true } });
  const known = new Set(daily.items.map(item => item.templateItemId));
  const missing = templates.filter(item => !known.has(item.id));
  if (!missing.length) return daily;
  await tx.dailyChecklistItem.createMany({ data: missing.map(({ id, title, section, sortOrder }) => ({ dailyChecklistId: daily.id, templateItemId: id, title, section, sortOrder })), skipDuplicates: true });
  return tx.dailyChecklist.update({ where: { id: daily.id }, data: { ...resetReview, updatedAt: new Date() }, include });
}
export function registerChecklists(router: Router) {
  router.get('/checklists/:outletId/settings', allow('OWNER'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req);
    res.json({ reviewRequired: outlet.checklistReviewRequired });
  }));
  router.put('/checklists/:outletId/settings', allow('OWNER'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req);
    const input = z.object({ reviewRequired: z.boolean() }).strict().parse(req.body);
    await locked(outlet.id, async tx => {
      await tx.outlet.update({ where: { id: outlet.id }, data: { checklistReviewRequired: input.reviewRequired } });
      await tx.dailyChecklist.updateMany({ where: { businessId: outlet.businessId, outletId: outlet.id, date: new Date(today(outlet.timezone)) }, data: { reviewRequired: input.reviewRequired } });
    });
    res.json(input);
  }));
  router.get('/checklists', asyncRoute(async (req, res) => {
    const input = z.object({ date: dateInput.optional() }).strict().parse(req.query);
    const outlets = await prisma.outlet.findMany({ where: { ...tenantScope(req), status: 'ACTIVE', id: { in: req.user!.outletIds } }, orderBy: { name: 'asc' } });
    const rows = await Promise.all(outlets.map(async outlet => {
      const date = input.date || today(outlet.timezone);
      const daily = await prisma.dailyChecklist.findUnique({ where: { businessId_outletId_date: { businessId: outlet.businessId, outletId: outlet.id, date: new Date(date) } }, include });
      return { outletId: outlet.id, name: outlet.name, date, reviewRequired: outlet.checklistReviewRequired, daily: daily ? present(daily) : null };
    }));
    res.json({ canReview: req.user!.role === 'OWNER' || req.user!.role === 'SUPERVISOR', canConfigure: req.user!.role === 'OWNER', rows });
  }));
  router.get('/checklists/:outletId/history', asyncRoute(async (req, res) => {
    const outlet = await outletFor(req);
    const { page } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().parse(req.query);
    const where = { businessId: outlet.businessId, outletId: outlet.id };
    const [rows, total] = await prisma.$transaction([prisma.dailyChecklist.findMany({ where, include, orderBy: { date: 'desc' }, skip: (page - 1) * 30, take: 30 }), prisma.dailyChecklist.count({ where })]);
    res.json({ rows: rows.map(present), total, page });
  }));
  router.get('/checklists/:outletId/daily', asyncRoute(async (req, res) => {
    const outlet = await outletFor(req);
    const input = z.object({ date: dateInput.optional() }).strict().parse(req.query);
    const current = today(outlet.timezone), date = input.date || current;
    const daily = await locked(outlet.id, async tx => {
      const where = { businessId_outletId_date: { businessId: outlet.businessId, outletId: outlet.id, date: new Date(date) } };
      const existing = await tx.dailyChecklist.findUnique({ where, include });
      if (existing) return date === current ? syncToday(tx, outlet, existing) : existing;
      if (date !== current) return null;
      await initialize(tx, outlet.businessId, outlet.id);
      const templates = await tx.checklistTemplateItem.findMany({ where: { businessId: outlet.businessId, outletId: outlet.id, active: true } });
      return tx.dailyChecklist.create({ data: { businessId: outlet.businessId, outletId: outlet.id, date: new Date(date), reviewRequired: outlet.checklistReviewRequired, items: { create: templates.map(({ id, title, section, sortOrder }) => ({ templateItemId: id, title, section, sortOrder })) } }, include });
    });
    res.json({ daily: daily ? present(daily) : null, today: current });
  }));
  router.patch('/checklists/:outletId/daily/:dailyId/items/:itemId', asyncRoute(async (req, res) => {
    const outlet = await outletFor(req);
    const { status } = z.object({ status: z.enum(['PENDING', 'DONE']) }).strict().parse(req.body);
    const dailyId = idInput.parse(req.params.dailyId), itemId = idInput.parse(req.params.itemId);
    const daily = await locked(outlet.id, async tx => {
      const row = await tx.dailyChecklist.findFirst({ where: { id: dailyId, businessId: outlet.businessId, outletId: outlet.id }, include });
      if (!row || !row.items.some(item => item.id === itemId)) throw new ApiError(404, 'Checklist tidak ditemukan');
      if (row.date.toISOString().slice(0, 10) !== today(outlet.timezone)) throw new ApiError(409, 'History hanya dapat dilihat');
      if (row.items.find(item => item.id === itemId)!.status === status) return row;
      await tx.dailyChecklistItem.update({ where: { id: itemId }, data: { status, completedBy: status === 'DONE' ? req.user!.id : null, completedAt: status === 'DONE' ? new Date() : null } });
      // Any change after a review requires a fresh review of the updated checklist.
      return tx.dailyChecklist.update({ where: { id: dailyId }, data: { reviewStatus: 'NOT_REVIEWED', reviewedBy: null, reviewedAt: null, reviewNote: null, pendingAtReview: null, updatedAt: new Date() }, include });
    });
    res.json(present(daily));
  }));
  router.post('/checklists/:outletId/daily/:dailyId/review', allow('OWNER', 'SUPERVISOR'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req), input = reviewInput.parse(req.body), dailyId = idInput.parse(req.params.dailyId);
    const daily = await locked(outlet.id, async tx => {
      const row = await tx.dailyChecklist.findFirst({ where: { id: dailyId, businessId: outlet.businessId, outletId: outlet.id }, include });
      if (!row) throw new ApiError(404, 'Checklist tidak ditemukan');
      if (row.date.toISOString().slice(0, 10) !== today(outlet.timezone)) throw new ApiError(409, 'History hanya dapat dilihat');
      if (!row.reviewRequired) throw new ApiError(409, 'Review tidak diwajibkan untuk outlet ini');
      const pending = row.items.filter(item => item.status === 'PENDING').length;
      if (pending && !input.acceptIncomplete) throw new ApiError(409, `${pending} pekerjaan belum selesai. Konfirmasi review checklist belum lengkap.`);
      return tx.dailyChecklist.update({ where: { id: dailyId }, data: { reviewStatus: 'REVIEWED', reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: input.note, pendingAtReview: pending }, include });
    });
    res.json(present(daily));
  }));
  router.get('/checklists/:outletId/templates', allow('OWNER'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req);
    const rows = await locked(outlet.id, async tx => {
      await initialize(tx, outlet.businessId, outlet.id);
      return tx.checklistTemplateItem.findMany({ where: { businessId: outlet.businessId, outletId: outlet.id }, orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] });
    });
    res.json(rows);
  }));
  router.post('/checklists/:outletId/templates', allow('OWNER'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req), input = templateInput.parse(req.body);
    const row = await locked(outlet.id, async tx => {
      await initialize(tx, outlet.businessId, outlet.id);
      const created = await tx.checklistTemplateItem.create({ data: { ...input, businessId: outlet.businessId, outletId: outlet.id } });
      await syncToday(tx, outlet);
      return created;
    });
    res.status(201).json(row);
  }));
  router.post('/checklists/:outletId/templates/reorder', allow('OWNER'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req), input = reorderInput.parse(req.body);
    const ids = input.items.map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new ApiError(400, 'Item urutan tidak boleh duplikat');
    const rows = await locked(outlet.id, async tx => {
      await initialize(tx, outlet.businessId, outlet.id);
      const existing = await tx.checklistTemplateItem.findMany({ where: { businessId: outlet.businessId, outletId: outlet.id } });
      const existingIds = new Set(existing.map(item => item.id));
      if (existing.length !== input.items.length || input.items.some(item => !existingIds.has(item.id))) throw new ApiError(400, 'Daftar item checklist tidak lengkap');
      await Promise.all(input.items.map(item => tx.checklistTemplateItem.updateMany({
        where: { id: item.id, businessId: outlet.businessId, outletId: outlet.id },
        data: { section: item.section, sortOrder: item.sortOrder },
      })));
      const daily = await tx.dailyChecklist.findUnique({ where: { businessId_outletId_date: { businessId: outlet.businessId, outletId: outlet.id, date: new Date(today(outlet.timezone)) } } });
      if (daily) {
        await Promise.all(input.items.map(item => tx.dailyChecklistItem.updateMany({ where: { dailyChecklistId: daily.id, templateItemId: item.id }, data: { section: item.section, sortOrder: item.sortOrder } })));
        await tx.dailyChecklist.update({ where: { id: daily.id }, data: { ...resetReview, updatedAt: new Date() } });
      }
      return tx.checklistTemplateItem.findMany({ where: { businessId: outlet.businessId, outletId: outlet.id }, orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] });
    });
    res.json(rows);
  }));
  router.put('/checklists/:outletId/templates/:itemId', allow('OWNER'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req), input = templateInput.parse(req.body), id = idInput.parse(req.params.itemId);
    await locked(outlet.id, async tx => {
      const result = await tx.checklistTemplateItem.updateMany({ where: { id, businessId: outlet.businessId, outletId: outlet.id }, data: input });
      if (!result.count) throw new ApiError(404, 'Item tidak ditemukan');
      await syncToday(tx, outlet);
    });
    res.json({ ok: true });
  }));
  router.delete('/checklists/:outletId/templates/:itemId', allow('OWNER'), asyncRoute(async (req, res) => {
    const outlet = await outletFor(req), id = idInput.parse(req.params.itemId);
    await locked(outlet.id, async tx => {
      const template = await tx.checklistTemplateItem.findFirst({ where: { id, businessId: outlet.businessId, outletId: outlet.id } });
      if (!template) throw new ApiError(404, 'Item tidak ditemukan');
      const daily = await tx.dailyChecklist.findUnique({ where: { businessId_outletId_date: { businessId: outlet.businessId, outletId: outlet.id, date: new Date(today(outlet.timezone)) } } });
      if (daily) {
        const removed = await tx.dailyChecklistItem.deleteMany({ where: { dailyChecklistId: daily.id, templateItemId: id } });
        if (removed.count) await tx.dailyChecklist.update({ where: { id: daily.id }, data: { ...resetReview, updatedAt: new Date() } });
      }
      // Historical snapshots survive: the optional template FK is set to null.
      await tx.checklistTemplateItem.delete({ where: { id } });
    });
    res.json({ ok: true });
  }));
}
