import { PrismaClient, Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

export const prisma = new PrismaClient();
export const asyncRoute = (fn:(req:Request,res:Response,next:NextFunction)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => void fn(req,res,next).catch(next);
export class ApiError extends Error { constructor(public status:number, message:string){ super(message); } }
export const DASHBOARD_PERMISSION = 'dashboard.view';
export const INVENTORY_PERMISSIONS = [
  'inventory.view',
  'inventory.stock_in',
  'inventory.stock_out',
  'inventory.adjustment',
  'inventory.opname',
  'inventory.transfer',
  'inventory.report',
  'inventory.warehouse',
  'inventory.item_management'
] as const;
export const DEFAULT_USER_PERMISSIONS = [DASHBOARD_PERMISSION, ...INVENTORY_PERMISSIONS] as const;
export const defaultInventoryPermissions=(role:Role)=>role==='OWNER'||role==='SUPERVISOR'?[...DEFAULT_USER_PERMISSIONS]:[];
export const FORU_BUSINESS_CODE = 'FORU';
export async function defaultBusinessForUser(userId:string, preferredBusinessId?:string){
  const membership = await prisma.businessMembership.findFirst({
    where:{
      userId,
      status:'ACTIVE',
      ...(preferredBusinessId ? { businessId: preferredBusinessId } : {})
    },
    include:{business:true},
    orderBy:{createdAt:'asc'}
  });
  if(membership?.business?.status==='ACTIVE') return membership;
  if(preferredBusinessId) return null;
  return prisma.businessMembership.findFirst({
    where:{userId,status:'ACTIVE',business:{status:'ACTIVE'}},
    include:{business:true},
    orderBy:{createdAt:'asc'}
  });
}
export async function auth(req:Request,res:Response,next:NextFunction){
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  if(!token) return res.status(401).json({message:'Silakan login terlebih dahulu'});
  try {
    const decoded=jwt.verify(token,process.env.JWT_SECRET||'dev-secret') as any;
    const user=await prisma.user.findUnique({where:{id:decoded.id},include:{outlets:{include:{outlet:true}}}});
    if(!user||user.status!=='ACTIVE') return res.status(401).json({message:'Sesi tidak valid atau telah berakhir'});
    const membership=await defaultBusinessForUser(user.id,decoded.businessId);
    if(!membership) return res.status(401).json({message:'Akses bisnis tidak ditemukan'});
    const role=membership.role;
    const outletIds=role==='OWNER'
      ? (await prisma.outlet.findMany({where:{status:'ACTIVE',OR:[{businessId:membership.businessId},{businessId:null}]},select:{id:true}})).map(x=>x.id)
      : user.outlets
        .filter(x=>x.status==='ACTIVE'&&x.outlet.status==='ACTIVE'&&(x.outlet.businessId===membership.businessId||x.outlet.businessId===null))
        .map(x=>x.outletId);
    req.user={id:user.id,businessId:membership.businessId,membershipId:membership.id,role,outletIds,inventoryPermissions:user.inventoryPermissions.length?user.inventoryPermissions:defaultInventoryPermissions(role),assignedWarehouseId:user.assignedWarehouseId};
    next();
  }
  catch { res.status(401).json({message:'Sesi tidak valid atau telah berakhir'}); }
}
export const allow=(...roles:Role[]) => (req:Request,res:Response,next:NextFunction) => roles.includes(req.user!.role)?next():res.status(403).json({message:'Anda tidak memiliki akses'});
export const hasPermission=(req:Request,permission:string)=>req.user!.role==='OWNER'||req.user!.inventoryPermissions.includes(permission);
export const requirePermission=(permission:string)=>(req:Request,res:Response,next:NextFunction)=>hasPermission(req,permission)?next():res.status(403).json({message:"You don't have permission."});
export function assertOutlet(req:Request,outletId:string){ if(!req.user!.outletIds.includes(outletId)) throw new ApiError(403,'Outlet tidak diizinkan'); }
export function tenantScope(req:Request){ return {OR:[{businessId:req.user!.businessId},{businessId:null}]}; }
export function tenantAnd(req:Request,...clauses:any[]){ return {AND:[tenantScope(req),...clauses.filter(Boolean)]}; }
export const money=(n:unknown)=>Math.round((Number(n)||0)*100)/100;
export const dayRange=(date?:string)=>{ const start=date?new Date(`${date}T00:00:00+07:00`):new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'})+'T00:00:00+07:00'); const end=new Date(start); end.setDate(end.getDate()+1); return {gte:start,lt:end}; };
