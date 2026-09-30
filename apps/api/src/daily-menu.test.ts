import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyMenuSchedule, Outlet, Prisma } from '@prisma/client';
import { assertOrderMode, dailyTotals, dateWindow, releaseDailyQuota, requestedSchedules, serviceDateInput, validateDailyItem } from './daily-menu.js';
import { priceCart } from './discount.js';

const outlet={id:'outlet',businessId:'tenant',timezone:'Asia/Jakarta',preorderDisplayDays:14,preOrderEnabled:true,webOrderMode:'NORMAL_AND_PREORDER'} as Outlet;
const now=new Date('2026-10-01T17:30:00Z'); // Already October 2 in the outlet.
const item={productId:'tea',qty:1,serviceDate:'2026-10-05',dailyMenuScheduleId:'a'};
const row={id:'a',outletId:'outlet',productId:'tea',scheduleDate:new Date('2026-10-05T00:00:00Z'),quota:50,soldQty:49,isAvailable:true,priceOverride:null,sortOrder:0,cutoffAt:new Date('2026-10-04T11:00:00Z'),createdAt:now,updatedAt:now} as DailyMenuSchedule;
afterEach(()=>vi.useRealTimers());
describe('daily menu rules',()=>{
  it('validates real calendar dates, including leap years',()=>{
    expect(serviceDateInput.safeParse('2026-02-30').success).toBe(false);
    expect(serviceDateInput.safeParse('2026-02-29').success).toBe(false);
    expect(serviceDateInput.safeParse('2028-02-29').success).toBe(true);
  });
  it('uses the outlet date and an exclusive display horizon',()=>{
    const window=dateWindow(outlet,now);
    expect(window.from.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(()=>validateDailyItem({...row,scheduleDate:window.to},outlet,{...item,serviceDate:'2026-10-16'},1,now)).toThrow('tidak tersedia');
  });
  it('allows a single drink, unlimited quota, and no cutoff',()=>{
    expect(()=>validateDailyItem({...row,quota:null,cutoffAt:null,soldQty:9999},outlet,item,50,now)).not.toThrow();
    expect([...requestedSchedules([item])]).toEqual([['a',1]]);
  });
  it.each([
    ['missing',undefined,item],
    ['another outlet',{...row,outletId:'other'},item],
    ['another product',row,{...item,productId:'snack'}],
    ['another date',row,{...item,serviceDate:'2026-10-07'}],
    ['disabled',{...row,isAvailable:false},item],
    ['cutoff boundary',{...row,cutoffAt:now},item],
    ['cutoff passed',{...row,cutoffAt:new Date(now.getTime()-1)},item],
    ['past date',{...row,scheduleDate:new Date('2026-10-01')},{...item,serviceDate:'2026-10-01'}]
  ])('rejects %s',(reason,schedule,line)=>expect(()=>validateDailyItem(schedule,outlet,line,1,now)).toThrow('tidak tersedia'));
  it('counts duplicate variant lines against the same quota',()=>{
    const requested=requestedSchedules([item,{...item,variantId:'large'}]);
    expect(requested.get('a')).toBe(2);
    expect(()=>validateDailyItem(row,outlet,item,requested.get('a')!,now)).toThrow('Kuota');
    expect(()=>validateDailyItem(row,outlet,item,1,now)).not.toThrow();
  });
  it('keeps separate dates independent and requires every item date',()=>{
    expect(requestedSchedules([item,{...item,serviceDate:'2026-10-07',dailyMenuScheduleId:'b',qty:2}]).size).toBe(2);
    expect(()=>requestedSchedules([{...item,serviceDate:undefined}])).toThrow();
    expect(()=>requestedSchedules([{...item,qty:0}])).toThrow();
  });
  it('enforces all three modes and the enable switch',()=>{
    expect(()=>assertOrderMode({...outlet,webOrderMode:'NORMAL_ONLY'},'NORMAL')).not.toThrow();
    expect(()=>assertOrderMode({...outlet,webOrderMode:'NORMAL_ONLY'},'PREORDER')).toThrow();
    expect(()=>assertOrderMode({...outlet,webOrderMode:'PREORDER_ONLY'},'NORMAL')).toThrow();
    expect(()=>assertOrderMode({...outlet,webOrderMode:'PREORDER_ONLY'},'PREORDER')).not.toThrow();
    expect(()=>assertOrderMode({...outlet,preOrderEnabled:false},'PREORDER')).toThrow();
  });
});

function fixture(){
  const po={isActive:true,isAvailable:false,status:'ACTIVE',stockMode:'MANUAL',stockQty:0,outletPrice:7000,outletHpp:2000};
  const product={id:'tea',name:'Tea',status:'ACTIVE',basePrice:8000,baseHpp:3000,category:'Drink',categoryId:null,categoryRef:null,categoryAssignments:[],outlets:[po],channelPrices:[],variants:[{id:'large',variantName:'Large',sellingPrice:9000,status:'ACTIVE'}],variantGroups:[],addons:[{id:'addon',addonName:'Extra',price:2000,hpp:300,status:'ACTIVE'}]};
  const tx={product:{findMany:vi.fn().mockResolvedValue([product]),findFirst:vi.fn().mockResolvedValue(product)},dailyMenuSchedule:{findMany:vi.fn().mockResolvedValue([{...row,priceOverride:5000,soldQty:0,product:{name:'Tea'}},{...row,id:'b',scheduleDate:new Date('2026-10-07'),soldQty:0,product:{name:'Tea'}}])},$queryRaw:vi.fn().mockResolvedValue([]),$executeRaw:vi.fn().mockResolvedValue(1)};
  return {tx,db:tx as unknown as Prisma.TransactionClient,product};
}
describe('daily checkout pricing and reservations',()=>{
  it('loads trusted outlet price/HPP, preserves variants and add-ons, and prices each date independently',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);
    const {db,tx}=fixture();
    const totals=await dailyTotals(db,outlet,[{...item,variantId:'large',addonIds:['addon']},{...item,variantId:'large',addonIds:['addon'],qty:2,serviceDate:'2026-10-07',dailyMenuScheduleId:'b'}],undefined,true);
    expect(totals.gross).toBe(28000);expect(totals.totalHpp).toBe(6900);
    expect(totals.lines.map(line=>[line.serviceDate.toISOString().slice(0,10),line.dailyMenuScheduleId])).toEqual([['2026-10-05','a'],['2026-10-07','b']]);
    expect(tx.$queryRaw.mock.calls.map(call=>call[1])).toEqual(['a','b']);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it('fails if the atomic quota update loses availability after pricing',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const {db,tx}=fixture();tx.$executeRaw.mockResolvedValue(0);
    await expect(dailyTotals(db,outlet,[item],undefined,true)).rejects.toThrow('kuota habis');
  });
  it('preview never reserves quota',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const {db,tx}=fixture();await dailyTotals(db,outlet,[item]);expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects an invalid variant even when supplied directly by a client',async()=>{
    const {db}=fixture();await expect(priceCart([{...item,variantId:'forged'}],outlet.id,'DINE_IN',outlet.businessId,{db,dailyPrices:[null]})).rejects.toThrow('Variant tidak valid');
  });
  it('releases combined schedule quantities once on repeated cancellation',async()=>{
    const tx={sale:{updateMany:vi.fn().mockResolvedValueOnce({count:1}).mockResolvedValue({count:0})},saleItem:{findMany:vi.fn().mockResolvedValue([{dailyMenuScheduleId:'a',qty:1},{dailyMenuScheduleId:'a',qty:2}])},dailyMenuSchedule:{update:vi.fn().mockResolvedValue({})}};
    await releaseDailyQuota(tx as unknown as Prisma.TransactionClient,'sale');await releaseDailyQuota(tx as unknown as Prisma.TransactionClient,'sale');
    expect(tx.dailyMenuSchedule.update).toHaveBeenCalledExactlyOnceWith({where:{id:'a'},data:{soldQty:{decrement:3}}});
  });
});
