import { Prisma } from '@prisma/client';
import type { Request, Router } from 'express';
import { z } from 'zod';
import { allow, ApiError, assertOutlet, asyncRoute, prisma, tenantScope } from './lib.js';

const idInput = z.string().trim().min(1).max(100);
const listInput = z.object({
  outletId: idInput.optional(),
  categoryId: idInput.optional(),
  search: z.string().trim().max(100).default(''),
}).strict();
export const sopStepInput = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  instruction: z.string().trim().min(1).max(1000),
  durationMinutes: z.number().int().min(0).max(1440).nullable().optional(),
}).strict();
export const productSopInput = z.object({
  title: z.string().trim().min(2).max(200),
  equipment: z.string().trim().max(5000).nullable().optional(),
  steps: z.array(sopStepInput).max(100),
  servingNotes: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'INACTIVE']),
}).strict().superRefine((value, context) => {
  if (value.status === 'PUBLISHED' && value.steps.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: 'SOP Published wajib memiliki minimal satu langkah.' });
  }
});

const productInclude = {
  categoryRef: { select: { id: true, name: true, sortOrder: true, status: true } },
  sop: true,
  recipes: {
    where: { isActive: true },
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      usageQty: true,
      wastePercent: true,
      usageUnit: { select: { id: true, name: true } },
      item: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.ProductInclude;

function present(product: Prisma.ProductGetPayload<{ include: typeof productInclude }>) {
  const steps = Array.isArray(product.sop?.steps) ? product.sop.steps : [];
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    imageUrl: product.imageUrl,
    status: product.status,
    category: product.categoryRef ? { id: product.categoryRef.id, name: product.categoryRef.name, sortOrder: product.categoryRef.sortOrder } : null,
    categoryName: product.categoryRef?.name || product.category || 'Tanpa Kategori',
    recipe: product.recipes.map(row => ({
      id: row.id,
      ingredientId: row.item.id,
      ingredientCode: row.item.code,
      ingredientName: row.item.name,
      qty: Number(row.usageQty),
      unit: row.usageUnit.name,
      wastePercent: Number(row.wastePercent),
    })),
    sop: product.sop ? { ...product.sop, steps } : null,
  };
}

async function activeOutletFor(req: Request, outletId: string) {
  assertOutlet(req, outletId);
  const outlet = await prisma.outlet.findFirst({ where: { id: outletId, ...tenantScope(req), status: 'ACTIVE' } });
  if (!outlet) throw new ApiError(403, 'Outlet tidak diizinkan');
  return outlet;
}

function productFilters(req: Request, input: z.infer<typeof listInput>) {
  const filters: Prisma.ProductWhereInput[] = [];
  if (input.outletId) filters.push({ outlets: { some: { outletId: input.outletId, isActive: true, status: 'ACTIVE' } } });
  if (input.categoryId) filters.push({ categoryId: input.categoryId });
  if (input.search) filters.push({ OR: [
    { name: { contains: input.search, mode: 'insensitive' } },
    { sku: { contains: input.search, mode: 'insensitive' } },
    { categoryRef: { name: { contains: input.search, mode: 'insensitive' } } },
  ] });
  if (req.user!.role !== 'OWNER') filters.push({ status: 'ACTIVE' }, { OR: [{ categoryId: null }, { categoryRef: { status: 'ACTIVE' } }] }, { sop: { is: { status: 'PUBLISHED' } } });
  return filters;
}

async function productForRead(req: Request, productId: string, outletId?: string) {
  if (req.user!.role !== 'OWNER' && !outletId) throw new ApiError(400, 'Outlet wajib dipilih');
  if (outletId) await activeOutletFor(req, outletId);
  const filters = productFilters(req, { outletId, search: '' });
  const product = await prisma.product.findFirst({ where: { AND: [tenantScope(req), { id: productId }, ...filters] }, include: productInclude });
  if (!product) throw new ApiError(404, 'SOP produk tidak ditemukan');
  return product;
}

export function registerProductSops(router: Router) {
  router.get('/product-sops', asyncRoute(async (req, res) => {
    const input = listInput.parse(req.query);
    if (req.user!.role !== 'OWNER' && !input.outletId) throw new ApiError(400, 'Outlet wajib dipilih');
    if (input.outletId) await activeOutletFor(req, input.outletId);
    const products = await prisma.product.findMany({
      where: { AND: [tenantScope(req), ...productFilters(req, input)] },
      include: productInclude,
      orderBy: [{ categoryRef: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
    res.json({ canManage: req.user!.role === 'OWNER', products: products.map(present) });
  }));

  router.get('/product-sops/:productId', asyncRoute(async (req, res) => {
    const productId = idInput.parse(req.params.productId);
    const query = z.object({ outletId: idInput.optional() }).strict().parse(req.query);
    res.json(present(await productForRead(req, productId, query.outletId)));
  }));

  router.put('/product-sops/:productId', allow('OWNER'), asyncRoute(async (req, res) => {
    const productId = idInput.parse(req.params.productId);
    const input = productSopInput.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: productId, ...tenantScope(req) } });
    if (!product) throw new ApiError(404, 'Produk tidak ditemukan');
    const existing = await prisma.productSop.findFirst({ where: { productId, ...tenantScope(req) } });
    const clean = {
      title: input.title,
      equipment: input.equipment || null,
      steps: input.steps.map((step, index) => ({ id: step.id || `step-${index + 1}`, instruction: step.instruction, durationMinutes: step.durationMinutes ?? null })) as Prisma.InputJsonValue,
      servingNotes: input.servingNotes || null,
      status: input.status,
      updatedBy: req.user!.id,
    };
    const saved = await prisma.$transaction(async tx => {
      const next = existing
        ? await tx.productSop.update({ where: { id: existing.id }, data: { ...clean, version: { increment: 1 } } })
        : await tx.productSop.create({ data: { ...clean, businessId: req.user!.businessId, productId, createdBy: req.user!.id } });
      await tx.auditLog.create({ data: {
        businessId: req.user!.businessId,
        entityType: 'PRODUCT_SOP',
        entityId: next.id,
        action: existing ? 'PRODUCT_SOP_UPDATED' : 'PRODUCT_SOP_CREATED',
        oldValue: existing ? existing as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
        newValue: next as unknown as Prisma.InputJsonValue,
        changedBy: req.user!.id,
      } });
      return next;
    });
    res.json({ ...saved, steps: Array.isArray(saved.steps) ? saved.steps : [] });
  }));
}
