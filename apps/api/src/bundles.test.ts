import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, Router, RequestHandler } from 'express';
import type { Outlet } from '@prisma/client';
import { registerBundles } from './bundles.js';
import * as engine from './bundle-engine.js';
import { ApiError, prisma } from './lib.js';

afterEach(() => vi.restoreAllMocks());
function apiFixture(role: 'OWNER' | 'CASHIER' = 'OWNER', businessId = 'A') {
  const routes = new Map<string, RequestHandler[]>();
  const router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method,
    (path: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${path}`, handlers),
  ])) as unknown as Router;
  const assertOutlet = vi.fn().mockResolvedValue(undefined);
  const assertRecipe = vi.fn().mockResolvedValue(undefined);
  registerBundles(router, assertOutlet, assertRecipe);
  async function call(method: string, path: string, body: unknown = {}, params = { id: 'bundle-B' }) {
    const request = { body, params, query: {}, user: { id: 'user', role, businessId, membershipId: 'membership', outletIds: ['out'], inventoryPermissions: [] } } as unknown as Request;
    let status = 200;
    return new Promise<{ status: number; data?: unknown; error?: unknown }>(resolve => {
      const response = { status(code: number) { status = code; return this; }, json(data: unknown) { resolve({ status, data }); } } as Response;
      const handlers = routes.get(`${method} ${path}`)!;
      let index = 0;
      const next = (error?: unknown): void => {
        if (error) { resolve({ status: error instanceof ApiError ? error.status : 400, error }); return; }
        handlers[index++]!(request, response, next);
      };
      next();
    });
  }
  return { call, assertOutlet, assertRecipe };
}
describe('bundle API authorization and recipe integration', () => {
  it('prevents cashiers from creating master bundles', async () => {
    const fixture = apiFixture('CASHIER');
    expect((await fixture.call('post', '/bundles')).status).toBe(403);
  });
  it('scopes detail to business A and returns 404 for a business B bundle', async () => {
    const lookup = vi.spyOn(prisma.productBundle, 'findFirst').mockResolvedValue(null);
    const fixture = apiFixture();
    expect((await fixture.call('get', '/bundles/:id')).status).toBe(404);
    expect(lookup).toHaveBeenCalledWith({ where: { id: 'bundle-B', businessId: 'A' }, include: engine.bundleInclude });
  });
  it('rejects foreign outlet access before pricing', async () => {
    const price = vi.spyOn(engine, 'priceBundle');
    const fixture = apiFixture(); fixture.assertOutlet.mockRejectedValue(new ApiError(403, 'Outlet tidak diizinkan'));
    expect((await fixture.call('post', '/bundles/:id/preview', { outletId: 'out-B' })).status).toBe(403);
    expect(price).not.toHaveBeenCalled();
  });
  it('passes the actual outlet and underlying quantities to the recipe validator', async () => {
    const outlet = { id: 'out', businessId: 'A', status: 'ACTIVE' } as Outlet;
    vi.spyOn(prisma.outlet, 'findFirst').mockResolvedValue(outlet);
    const quote = { components: [{ productId: 'coffee', qty: 6 }] } as Awaited<ReturnType<typeof engine.priceBundle>>;
    vi.spyOn(engine, 'priceBundle').mockResolvedValue(quote);
    // Run the transaction callback without a database; pricing is independently tested.
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: unknown) =>
      (callback as (tx: unknown) => Promise<unknown>)({}) as never);
    const fixture = apiFixture('CASHIER');
    expect((await fixture.call('post', '/bundles/:id/preview', { outletId: 'out', qty: 3 })).status).toBe(200);
    expect(fixture.assertRecipe).toHaveBeenCalledWith(outlet, quote.components);
  });
  it('rejects stock errors from recipe validation instead of returning a successful quote', async () => {
    vi.spyOn(prisma.outlet, 'findFirst').mockResolvedValue({ id: 'out', businessId: 'A' } as Outlet);
    vi.spyOn(engine, 'priceBundle').mockResolvedValue({ components: [] } as unknown as Awaited<ReturnType<typeof engine.priceBundle>>);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: unknown) =>
      (callback as (tx: unknown) => Promise<unknown>)({}) as never);
    const fixture = apiFixture(); fixture.assertRecipe.mockRejectedValue(new ApiError(409, 'Stok tidak mencukupi'));
    expect((await fixture.call('post', '/bundles/:id/preview', { outletId: 'out' })).status).toBe(409);
  });
});
