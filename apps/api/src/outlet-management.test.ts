import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Request} from 'express';
import {assertManagedOutlet,assertOutlet,prisma} from './lib.js';

const request=(role='OWNER',businessId='biz_a')=>({user:{role,businessId,outletIds:[]}} as unknown as Request);

afterEach(()=>vi.restoreAllMocks());

describe('outlet management access',()=>{
  it('allows owners to manage inactive outlets absent from their active outlet list',async()=>{
    const outlet={id:'outlet_a',businessId:'biz_a',status:'INACTIVE'};
    const query=vi.spyOn(prisma.outlet,'findFirst').mockResolvedValue(outlet as never);
    await expect(assertManagedOutlet(request(),'outlet_a')).resolves.toEqual(outlet);
    expect(query).toHaveBeenCalledWith({where:{id:'outlet_a',businessId:'biz_a'}});
    expect(()=>assertOutlet(request(),'outlet_a')).toThrow('Outlet tidak diizinkan');
  });

  it('rejects outlets outside the current business',async()=>{
    vi.spyOn(prisma.outlet,'findFirst').mockResolvedValue(null);
    await expect(assertManagedOutlet(request(),'other_outlet')).rejects.toThrow('Outlet tidak diizinkan');
  });

  it('rejects non-owners and missing business context before querying',async()=>{
    const query=vi.spyOn(prisma.outlet,'findFirst');
    await expect(assertManagedOutlet(request('CASHIER'),'outlet_a')).rejects.toThrow('Anda tidak memiliki akses');
    await expect(assertManagedOutlet(request('OWNER',''),'outlet_a')).rejects.toThrow('Business tidak valid');
    expect(query).not.toHaveBeenCalled();
  });
});
