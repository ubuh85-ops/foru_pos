import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';
import { z } from 'zod';
import { ApiError, prisma } from './lib.js';
import { dateInput, defaults, progress, registerChecklists, today } from './checklists.js';
vi.mock('./lib.js', async original => ({
  ...await original<typeof import('./lib.js')>(),
  prisma: {
    outlet: { findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    dailyChecklist: { updateMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    dailyChecklistItem: { update: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    checklistTemplateItem: { findFirst: vi.fn(), delete: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
let server: Server, base: string;
const outlet = { id: 'outlet-a', businessId: 'business-a', timezone: 'Asia/Jakarta', status: 'ACTIVE', checklistReviewRequired: true, checklistInitialized: true };
const daily = () => ({ id: 'daily-a', date: new Date(today(outlet.timezone)), businessId: 'business-a', outletId: 'outlet-a', reviewStatus: 'NOT_REVIEWED', reviewRequired: true, items: [{ id: 'item-a', title: 'Bersih', section: 'OPENING', sortOrder: 0, status: 'PENDING', completedAt: null, completedBy: null }], reviewer: null });
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'user-a', businessId: 'business-a', membershipId: 'member-a', role: req.headers['x-role'] === 'OWNER' ? 'OWNER' : req.headers['x-role'] === 'CASHIER' ? 'CASHIER' : 'SUPERVISOR', outletIds: ['outlet-a'], inventoryPermissions: [], assignedWarehouseId: null }; next(); });
  registerChecklists(app);
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error instanceof ApiError ? error.status : 500).json({ message: String(error) });
  app.use(errors);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address'); base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation((async (work: unknown) => typeof work === 'function' ? work(prisma) : Promise.all(work as Promise<unknown>[])) as never);
  vi.mocked(prisma.checklistTemplateItem.findMany).mockResolvedValue([]);
  vi.mocked(prisma.outlet.findFirst).mockResolvedValue(outlet as never);
  vi.mocked(prisma.outlet.findUniqueOrThrow).mockResolvedValue(outlet as never);
  vi.mocked(prisma.outlet.findMany).mockResolvedValue([outlet] as never);
  vi.mocked(prisma.dailyChecklist.findFirst).mockResolvedValue(daily() as never);
  vi.mocked(prisma.dailyChecklist.findUnique).mockResolvedValue(daily() as never);
  vi.mocked(prisma.dailyChecklist.update).mockResolvedValue(daily() as never);
});
const request = (path: string, method = 'GET', body?: unknown, role = 'SUPERVISOR') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-role': role }, ...(body ? { body: JSON.stringify(body) } : {}) });
const root = '/checklists/outlet-a/daily/daily-a';
describe('Checklist access and lifecycle', () => {
  it('denies unassigned outlets before any database lookup', async () => {
    expect((await request('/checklists/outlet-b/daily')).status).toBe(403);
    expect(prisma.outlet.findFirst).not.toHaveBeenCalled();
  });
  it('filters outlet lookup and monitoring by the current tenant', async () => {
    await request('/checklists/outlet-a/daily');
    expect(prisma.outlet.findFirst).toHaveBeenCalledWith({ where: { id: 'outlet-a', businessId: 'business-a' } });
    await request('/checklists');
    expect(prisma.outlet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: 'business-a', status: 'ACTIVE', id: { in: ['outlet-a'] } } }));
  });
  it('blocks cashier reviews and supervisor configuration', async () => {
    expect((await request(`${root}/review`, 'POST', { confirmed: true }, 'CASHIER')).status).toBe(403);
    expect((await request('/checklists/outlet-a/templates')).status).toBe(403);
  });
  it('requires explicit acknowledgement for incomplete review and stores its pending count', async () => {
    expect((await request(`${root}/review`, 'POST', { confirmed: true })).status).toBe(409);
    expect(prisma.dailyChecklist.update).not.toHaveBeenCalled();
    expect((await request(`${root}/review`, 'POST', { confirmed: true, acceptIncomplete: true, note: 'Restock besok' })).status).toBe(200);
    expect(prisma.dailyChecklist.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewedBy: 'user-a', reviewNote: 'Restock besok', pendingAtReview: 1, reviewStatus: 'REVIEWED' }) }));
  });
  it('rejects forged completion attribution and missing review confirmation', async () => {
    expect((await request(`${root}/items/item-a`, 'PATCH', { status: 'DONE', completedBy: 'other' })).status).toBe(400);
    expect((await request(`${root}/review`, 'POST', { confirmed: false })).status).toBe(400);
  });
  it('uses the authenticated user and resets review when an item changes', async () => {
    expect((await request(`${root}/items/item-a`, 'PATCH', { status: 'DONE' }, 'CASHIER')).status).toBe(200);
    expect(prisma.dailyChecklistItem.update).toHaveBeenCalledWith({ where: { id: 'item-a' }, data: { status: 'DONE', completedBy: 'user-a', completedAt: expect.any(Date) } });
    expect(prisma.dailyChecklist.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewStatus: 'NOT_REVIEWED', reviewedBy: null }) }));
  });
  it('clears attribution on uncheck and ignores duplicate ticks', async () => {
    vi.mocked(prisma.dailyChecklist.findFirst).mockResolvedValue({ ...daily(), items: [{ ...daily().items[0], status: 'DONE' }] } as never);
    await request(`${root}/items/item-a`, 'PATCH', { status: 'DONE' });
    expect(prisma.dailyChecklistItem.update).not.toHaveBeenCalled();
    await request(`${root}/items/item-a`, 'PATCH', { status: 'PENDING' });
    expect(prisma.dailyChecklistItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PENDING', completedBy: null, completedAt: null } }));
  });
  it('rejects item IDs outside the selected checklist and historic edits', async () => {
    expect((await request(`${root}/items/other`, 'PATCH', { status: 'DONE' })).status).toBe(404);
    vi.mocked(prisma.dailyChecklist.findFirst).mockResolvedValue({ ...daily(), date: new Date('2020-01-01') } as never);
    expect((await request(`${root}/items/item-a`, 'PATCH', { status: 'DONE' })).status).toBe(409);
    expect((await request(`${root}/review`, 'POST', { confirmed: true, acceptIncomplete: true })).status).toBe(409);
  });
  it('does not generate historical checklists', async () => {
    vi.mocked(prisma.dailyChecklist.findUnique).mockResolvedValue(null);
    const res = await request('/checklists/outlet-a/daily?date=2020-01-01');
    expect((await res.json()).daily).toBeNull(); expect(prisma.dailyChecklist.create).not.toHaveBeenCalled();
  });
  it('copies active template snapshots under an outlet lock', async () => {
    vi.mocked(prisma.dailyChecklist.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.checklistTemplateItem.findMany).mockResolvedValue([{ id: 'template-a', title: 'Snapshot', section: 'OPENING', sortOrder: 2 }] as never);
    vi.mocked(prisma.dailyChecklist.create).mockResolvedValue(daily() as never);
    expect((await request('/checklists/outlet-a/daily')).status).toBe(200);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.checklistTemplateItem.findMany).toHaveBeenCalledWith({ where: { businessId: 'business-a', outletId: 'outlet-a', active: true } });
    expect(prisma.dailyChecklist.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ items: { create: [{ templateItemId: 'template-a', title: 'Snapshot', section: 'OPENING', sortOrder: 2 }] } }) }));
    expect(prisma.checklistTemplateItem.createMany).not.toHaveBeenCalled();
  });
  it('initializes all 32 defaults only for an uninitialized outlet', async () => {
    vi.mocked(prisma.outlet.findUniqueOrThrow).mockResolvedValue({ ...outlet, checklistInitialized: false } as never);
    vi.mocked(prisma.checklistTemplateItem.findMany).mockResolvedValue([]);
    expect((await request('/checklists/outlet-a/templates', 'GET', undefined, 'OWNER')).status).toBe(200);
    expect(vi.mocked(prisma.checklistTemplateItem.createMany).mock.calls[0]?.[0]?.data).toHaveLength(32);
  });
  it('deactivates templates within tenant and outlet scope without changing daily snapshots', async () => {
    vi.mocked(prisma.checklistTemplateItem.updateMany).mockResolvedValue({ count: 1 });
    expect((await request('/checklists/outlet-a/templates/template-a', 'PUT', { title: 'Updated', section: 'CLOSING', sortOrder: 1, active: false }, 'OWNER')).status).toBe(200);
    expect(prisma.checklistTemplateItem.updateMany).toHaveBeenCalledWith({ where: { id: 'template-a', businessId: 'business-a', outletId: 'outlet-a' }, data: { title: 'Updated', section: 'CLOSING', sortOrder: 1, active: false } });
    expect(prisma.dailyChecklist.update).not.toHaveBeenCalled();
  });
});
it('validates actual dates, outlet timezone day boundaries and progress', () => {
  expect(dateInput.safeParse('2026-02-30').success).toBe(false);
  expect(today('Asia/Jakarta', new Date('2026-09-16T17:00:00Z'))).toBe('2026-09-17');
  expect(today('Asia/Makassar', new Date('2026-09-16T16:00:00Z'))).toBe('2026-09-17');
  expect(defaults.OPENING).toHaveLength(10); expect(defaults.OPERATIONAL).toHaveLength(7); expect(defaults.CLOSING).toHaveLength(15);
  expect(progress([{ section: 'OPENING', status: 'DONE' }, { section: 'OPENING', status: 'PENDING' }])[0]).toEqual({ section: 'OPENING', done: 1, total: 2, percent: 50 });
  expect(progress([]).every(section => section.percent === 0)).toBe(true);
});

describe('Template additions and deletion', () => {
  const template = { id: 'new-template', title: 'New work', section: 'OPENING', sortOrder: 5, active: true };
  it('backfills missing active items on opening today and invalidates the review', async () => {
    vi.mocked(prisma.checklistTemplateItem.findMany).mockResolvedValue([template] as never);
    expect((await request('/checklists/outlet-a/daily')).status).toBe(200);
    expect(prisma.dailyChecklistItem.createMany).toHaveBeenCalledWith({ data: [{ dailyChecklistId: 'daily-a', templateItemId: 'new-template', title: 'New work', section: 'OPENING', sortOrder: 5 }], skipDuplicates: true });
    expect(prisma.dailyChecklist.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewStatus: 'NOT_REVIEWED' }) }));
  });
  it('adds a new template to an already generated day in the same transaction', async () => {
    vi.mocked(prisma.checklistTemplateItem.create).mockResolvedValue(template as never);
    vi.mocked(prisma.checklistTemplateItem.findMany).mockResolvedValue([template] as never);
    const { id, ...body } = template;
    expect((await request('/checklists/outlet-a/templates', 'POST', body, 'OWNER')).status).toBe(201);
    expect(prisma.dailyChecklistItem.createMany).toHaveBeenCalledOnce();
  });
  it('does not duplicate completed items or change historical snapshots', async () => {
    vi.mocked(prisma.checklistTemplateItem.findMany).mockResolvedValue([template] as never);
    vi.mocked(prisma.dailyChecklist.findUnique).mockResolvedValue({ ...daily(), items: [{ ...daily().items[0], templateItemId: template.id, status: 'DONE' }] } as never);
    await request('/checklists/outlet-a/daily');
    expect(prisma.dailyChecklistItem.createMany).not.toHaveBeenCalled();
    vi.mocked(prisma.dailyChecklist.findUnique).mockResolvedValue({ ...daily(), date: new Date('2020-01-01') } as never);
    await request('/checklists/outlet-a/daily?date=2020-01-01');
    expect(prisma.dailyChecklistItem.createMany).not.toHaveBeenCalled();
    expect(prisma.dailyChecklist.update).not.toHaveBeenCalled();
  });
  it('deletes the template and only its current-day item, retaining historical snapshots', async () => {
    vi.mocked(prisma.checklistTemplateItem.findFirst).mockResolvedValue(template as never);
    vi.mocked(prisma.dailyChecklistItem.deleteMany).mockResolvedValue({ count: 1 });
    expect((await request('/checklists/outlet-a/templates/new-template', 'DELETE', undefined, 'OWNER')).status).toBe(200);
    expect(prisma.checklistTemplateItem.findFirst).toHaveBeenCalledWith({ where: { id: 'new-template', businessId: 'business-a', outletId: 'outlet-a' } });
    expect(prisma.dailyChecklistItem.deleteMany).toHaveBeenCalledWith({ where: { dailyChecklistId: 'daily-a', templateItemId: 'new-template' } });
    expect(prisma.checklistTemplateItem.delete).toHaveBeenCalledWith({ where: { id: 'new-template' } });
    expect(prisma.dailyChecklist.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewStatus: 'NOT_REVIEWED' }) }));
  });
  it('denies deletion by non-owners or for other outlets and unknown templates', async () => {
    expect((await request('/checklists/outlet-a/templates/new-template', 'DELETE')).status).toBe(403);
    expect((await request('/checklists/outlet-b/templates/new-template', 'DELETE', undefined, 'OWNER')).status).toBe(403);
    vi.mocked(prisma.checklistTemplateItem.findFirst).mockResolvedValue(null);
    expect((await request('/checklists/outlet-a/templates/new-template', 'DELETE', undefined, 'OWNER')).status).toBe(404);
    expect(prisma.checklistTemplateItem.delete).not.toHaveBeenCalled();
  });
});

describe('Per-outlet review and active outlets', () => {
  it('blocks all checklist access for inactive outlets', async () => {
    vi.mocked(prisma.outlet.findFirst).mockResolvedValue({ ...outlet, status: 'INACTIVE' } as never);
    for (const path of ['/daily', '/history', '/templates', '/settings']) {
      expect((await request('/checklists/outlet-a' + path, 'GET', undefined, 'OWNER')).status).toBe(403);
    }
    expect(prisma.dailyChecklist.create).not.toHaveBeenCalled();
  });
  it('allows only owners to configure review and only updates the selected outlet and today', async () => {
    expect((await request('/checklists/outlet-a/settings', 'PUT', { reviewRequired: false })).status).toBe(403);
    expect((await request('/checklists/outlet-a/settings', 'PUT', { reviewRequired: false }, 'OWNER')).status).toBe(200);
    expect(prisma.outlet.update).toHaveBeenCalledWith({ where: { id: 'outlet-a' }, data: { checklistReviewRequired: false } });
    expect(prisma.dailyChecklist.updateMany).toHaveBeenCalledWith({ where: { businessId: 'business-a', outletId: 'outlet-a', date: new Date(today(outlet.timezone)) }, data: { reviewRequired: false } });
  });
  it('rejects review when not required and validates configuration', async () => {
    vi.mocked(prisma.dailyChecklist.findFirst).mockResolvedValue({ ...daily(), reviewRequired: false } as never);
    expect((await request(root + '/review', 'POST', { confirmed: true, acceptIncomplete: true })).status).toBe(409);
    expect((await request('/checklists/outlet-a/settings', 'PUT', { reviewRequired: 'false' }, 'OWNER')).status).toBe(400);
    expect(prisma.dailyChecklist.update).not.toHaveBeenCalled();
  });
  it('generates the selected outlet templates with its review policy', async () => {
    vi.mocked(prisma.outlet.findFirst).mockResolvedValue({ ...outlet, checklistReviewRequired: false } as never);
    vi.mocked(prisma.dailyChecklist.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.dailyChecklist.create).mockResolvedValue({ ...daily(), reviewRequired: false } as never);
    vi.mocked(prisma.checklistTemplateItem.findMany).mockResolvedValue([{ id: 'only-outlet-a', title: 'Outlet A only', section: 'OPENING', sortOrder: 0 }] as never);
    expect((await request('/checklists/outlet-a/daily')).status).toBe(200);
    expect(prisma.checklistTemplateItem.findMany).toHaveBeenCalledWith({ where: { businessId: 'business-a', outletId: 'outlet-a', active: true } });
    expect(prisma.dailyChecklist.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ outletId: 'outlet-a', reviewRequired: false, items: { create: [{ templateItemId: 'only-outlet-a', title: 'Outlet A only', section: 'OPENING', sortOrder: 0 }] } }) }));
  });
});
