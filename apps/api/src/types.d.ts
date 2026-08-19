import type { Role } from '@prisma/client';
declare global { namespace Express { interface Request { user?: { id:string; businessId:string; membershipId:string; role:Role; outletIds:string[]; inventoryPermissions:string[]; assignedWarehouseId?: string | null } } } }
export {};
