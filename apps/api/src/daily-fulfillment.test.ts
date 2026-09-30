import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { fulfillDailyItems, fulfillmentInput } from './daily-menu.js';

function fixture(){
  const items=[
    {id:'a',saleId:'sale',serviceDate:new Date('2026-10-05'),dailyMenuScheduleId:'schedule',fulfillmentStatus:'PENDING',fulfilledAt:null as Date|null},
    {id:'b',saleId:'sale',serviceDate:new Date('2026-10-05'),dailyMenuScheduleId:'schedule',fulfillmentStatus:'PENDING',fulfilledAt:null as Date|null},
    {id:'c',saleId:'sale',serviceDate:new Date('2026-10-07'),dailyMenuScheduleId:'later',fulfillmentStatus:'PENDING',fulfilledAt:null as Date|null},
    {id:'d',saleId:'other-sale',serviceDate:new Date('2026-10-05'),dailyMenuScheduleId:'schedule',fulfillmentStatus:'PENDING',fulfilledAt:null as Date|null}
  ];
  const tx={saleItem:{updateMany:async({where,data}:{where:Prisma.SaleItemWhereInput;data:{fulfillmentStatus:string;fulfilledAt:Date|null}})=>{
    const matches=items.filter(item=>item.saleId===where.saleId&&item.serviceDate.getTime()===(where.serviceDate as Date).getTime()&&(!where.id||item.id===where.id)&&(!where.fulfillmentStatus||item.fulfillmentStatus===where.fulfillmentStatus));
    matches.forEach(item=>Object.assign(item,data));return {count:matches.length};
  }}} as unknown as Prisma.TransactionClient;
  return {items,tx};
}
const input={serviceDate:'2026-10-05',itemId:'a',status:'READY' as const,expectedStatus:'PENDING' as const};
describe('per-item packing status',()=>{
  it('updates only the selected item; siblings and other dates/orders stay unchanged',async()=>{
    const {items,tx}=fixture();await fulfillDailyItems(tx,'sale',input);
    expect(items.map(item=>item.fulfillmentStatus)).toEqual(['READY','PENDING','PENDING','PENDING']);
  });
  it('rejects stale status instead of overwriting another operator',async()=>{
    const {items,tx}=fixture();await fulfillDailyItems(tx,'sale',input);
    await expect(fulfillDailyItems(tx,'sale',{...input,status:'COMPLETED'})).rejects.toMatchObject({status:409});
    expect(items[0]!.fulfillmentStatus).toBe('READY');
  });
  it('cannot update an item belonging to another order or date',async()=>{
    const {items,tx}=fixture();
    await expect(fulfillDailyItems(tx,'sale',{...input,itemId:'d'})).rejects.toMatchObject({status:409});
    await expect(fulfillDailyItems(tx,'sale',{...input,itemId:'c'})).rejects.toMatchObject({status:409});
    expect(items.every(item=>item.fulfillmentStatus==='PENDING')).toBe(true);
  });
  it('records handover time and clears it when corrected back to packing',async()=>{
    const {items,tx}=fixture();await fulfillDailyItems(tx,'sale',{...input,status:'COMPLETED'});
    expect(items[0]!.fulfilledAt).toBeInstanceOf(Date);
    await fulfillDailyItems(tx,'sale',{...input,expectedStatus:'COMPLETED'});
    expect(items[0]!.fulfilledAt).toBeNull();
  });
  it('rejects unknown dropdown statuses',()=>expect(fulfillmentInput.safeParse({...input,status:'UNKNOWN'}).success).toBe(false));
});
