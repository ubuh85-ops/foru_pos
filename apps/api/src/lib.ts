import { PrismaClient, Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

export const prisma = new PrismaClient();
export const asyncRoute = (fn:(req:Request,res:Response,next:NextFunction)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => void fn(req,res,next).catch(next);
export class ApiError extends Error { constructor(public status:number, message:string){ super(message); } }
export function auth(req:Request,res:Response,next:NextFunction){
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  if(!token) return res.status(401).json({message:'Silakan login terlebih dahulu'});
  try { req.user=jwt.verify(token,process.env.JWT_SECRET||'dev-secret') as Request['user']; next(); }
  catch { res.status(401).json({message:'Sesi tidak valid atau telah berakhir'}); }
}
export const allow=(...roles:Role[]) => (req:Request,res:Response,next:NextFunction) => roles.includes(req.user!.role)?next():res.status(403).json({message:'Anda tidak memiliki akses'});
export function assertOutlet(req:Request,outletId:string){ if(req.user!.role!=='OWNER'&&!req.user!.outletIds.includes(outletId)) throw new ApiError(403,'Outlet tidak diizinkan'); }
export const money=(n:unknown)=>Math.round((Number(n)||0)*100)/100;
export const dayRange=(date?:string)=>{ const start=date?new Date(`${date}T00:00:00+07:00`):new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'})+'T00:00:00+07:00'); const end=new Date(start); end.setDate(end.getDate()+1); return {gte:start,lt:end}; };
