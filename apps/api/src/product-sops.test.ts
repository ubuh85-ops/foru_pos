import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';
import { z } from 'zod';
import { ApiError, prisma } from './lib.js';
import { productSopInput, registerProductSops } from './product-sops.js';

vi.mock('./lib.js', async original => ({
  ...await original<typeof import('./lib.js')>(),
  prisma: {
    outlet: { findFirst: vi.fn() },
    product: { findFirst: vi.fn(), findMany: vi.fn() },
    productSop: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

let server: Server, base: string;
const outlet = { id: 'outlet-a', businessId: 'business-a', status: 'ACTIVE' };
const product = {
  id: 'product-a', businessId: 'business-a', sku: 'SKU-A', name: 'Kopi A', category: 'Coffee', categoryId: 'category-a', imageUrl: null, status: 'ACTIVE',
  categoryRef: { id: 'category-a', name: 'Coffee', sortOrder: 1, status: 'ACTIVE' }, recipes: [], sop: null,
};
const publishedSop = { id: 'sop-a', businessId: 'business-a', productId: 'product-a', title: 'SOP Kopi A', equipment: null, steps: [{ id: 'one', instruction: 'Aduk' }], servingNotes: null, status: 'PUBLISHED', version: 1, createdBy: 'user-a', updatedBy: 'user-a', createdAt: new Date(), updatedAt: new Date() };

beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-role'] === 'OWNER' ? 'OWNER' : req.headers['x-role'] === 'SUPERVISOR' ? 'SUPERVISOR' : 'CASHIER';
    req.user = { id: 'user-a', businessId: 'business-a', membershipId: 'member-a', role, outletIds: ['outlet-a'], inventoryPermissions: [], assignedWarehouseId: null };
    next();
  });
  registerProductSops(app);
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error instanceof ApiError ? error.status : 500).json({ message: error instanceof Error ? error.message : String(error) });
  app.use(errors);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address'); base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation((async (work: unknown) => typeof work === 'function' ? (work as (tx: typeof prisma) => Promise<unknown>)(prisma) : Promise.all(work as Promise<unknown>[])) as never);
  vi.mocked(prisma.outlet.findFirst).mockResolvedValue(outlet as never);
  vi.mocked(prisma.product.findMany).mockResolvedValue([product] as never);
  vi.mocked(prisma.product.findFirst).mockResolvedValue(product as never);
  vi.mocked(prisma.productSop.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.productSop.create).mockResolvedValue(publishedSop as never);
  vi.mocked(prisma.productSop.update).mockResolvedValue({ ...publishedSop, version: 2 } as never);
});
const request = (path: string, method = 'GET', body?: unknown, role = 'CASHIER') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-role': role }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe('Product SOP tenant access', () => {
  it('requires an assigned active outlet for cashier reads', async () => {
    expect((await request('/product-sops')).status).toBe(400);
    expect((await request('/product-sops?outletId=outlet-b')).status).toBe(403);
    expect(prisma.outlet.findFirst).not.toHaveBeenCalled();
  });

  it('scopes cashier products to tenant, outlet, active product and published SOP', async () => {
    expect((await request('/product-sops?outletId=outlet-a')).status).toBe(200);
    expect(prisma.outlet.findFirst).toHaveBeenCalledWith({ where: { id: 'outlet-a', businessId: 'business-a', status: 'ACTIVE' } });
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([
      { businessId: 'business-a' },
      { outlets: { some: { outletId: 'outlet-a', isActive: true, status: 'ACTIVE' } } },
      { status: 'ACTIVE' },
      { sop: { is: { status: 'PUBLISHED' } } },
    ]) } }));
  });

  it('lets owners see products without SOP while preserving tenant scope', async () => {
    const response = await request('/product-sops', 'GET', undefined, 'OWNER');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canManage: true, products: [{ id: 'product-a', sop: null }] });
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ businessId: 'business-a' }] } }));
  });

  it('blocks non-owner writes and cross-tenant product IDs', async () => {
    const body = { title: 'SOP Kopi', steps: [{ instruction: 'Aduk' }], status: 'PUBLISHED' };
    expect((await request('/product-sops/product-a', 'PUT', body)).status).toBe(403);
    vi.mocked(prisma.product.findFirst).mockResolvedValueOnce(null);
    expect((await request('/product-sops/product-b', 'PUT', body, 'OWNER')).status).toBe(404);
    expect(prisma.productSop.create).not.toHaveBeenCalled();
  });

  it('stores authenticated tenant/user attribution and audit data', async () => {
    const body = { title: 'SOP Kopi', equipment: 'Gelas', steps: [{ id: 'one', instruction: 'Aduk', durationMinutes: 2 }], servingNotes: 'Sajikan', status: 'PUBLISHED' };
    expect((await request('/product-sops/product-a', 'PUT', body, 'OWNER')).status).toBe(200);
    expect(prisma.productSop.create).toHaveBeenCalledWith({ data: expect.objectContaining({ businessId: 'business-a', productId: 'product-a', createdBy: 'user-a', updatedBy: 'user-a' }) });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ businessId: 'business-a', entityType: 'PRODUCT_SOP', changedBy: 'user-a' }) });
  });
});

it('requires steps before publishing', () => {
  expect(productSopInput.safeParse({ title: 'SOP Kopi', steps: [], status: 'PUBLISHED' }).success).toBe(false);
  expect(productSopInput.safeParse({ title: 'SOP Kopi', steps: [], status: 'DRAFT' }).success).toBe(true);
});
