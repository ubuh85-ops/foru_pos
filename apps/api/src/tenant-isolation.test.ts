import {describe,expect,it} from 'vitest';
import {ApiError,assertOutlet,tenantAnd,tenantScope} from './lib.js';

describe('tenant isolation helpers',()=>{
  it('uses strict tenant scope without legacy null fallback',()=>{
    expect(tenantScope({user:{businessId:'biz_a'}} as any)).toEqual({businessId:'biz_a'});
  });

  it('rejects requests without active business context',()=>{
    expect(()=>tenantScope({user:{}} as any)).toThrow(ApiError);
  });

  it('rejects outlet access outside token outlet list',()=>{
    expect(()=>assertOutlet({user:{outletIds:['outlet_a']}} as any,'outlet_b')).toThrow(ApiError);
  });

  it('builds tenant-scoped compound filters for duplicate checks',()=>{
    expect(tenantAnd({user:{businessId:'biz_a'}} as any,{sku:'SKU-001'})).toEqual({
      AND:[{businessId:'biz_a'},{sku:'SKU-001'}]
    });
  });
});
