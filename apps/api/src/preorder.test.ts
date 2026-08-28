import { describe, expect, it } from 'vitest';
import { validatePublicSchedule, type PreOrderOutlet } from './preorder.js';

const outlet:PreOrderOutlet={preOrderEnabled:true,preOrderMinLeadMinutes:60,preOrderMaxDaysAhead:14,preOrderSlotMinutes:30,customerOrderOpenTime:'08:00',customerOrderCloseTime:'21:00',customerOrderOperatingDays:[1,2,3,4,5,6],timezone:'Asia/Jakarta'};
const now=new Date('2026-08-24T02:30:00.000Z'); // Senin 09:30 WIB

describe('validatePublicSchedule',()=>{
  it('accepts a slot at the minimum lead time',()=>expect(validatePublicSchedule({isPreOrder:true,scheduledAt:'2026-08-24T10:30:00+07:00'},outlet,now)?.toISOString()).toBe('2026-08-24T03:30:00.000Z'));
  it('rejects a slot before minimum lead time',()=>expect(()=>validatePublicSchedule({isPreOrder:true,scheduledAt:'2026-08-24T10:00:00+07:00'},outlet,now)).toThrow(/minimal 60 menit/));
  it('rejects closed days and slots outside operating hours',()=>{
    expect(()=>validatePublicSchedule({isPreOrder:true,scheduledAt:'2026-08-30T10:30:00+07:00'},outlet,now)).toThrow(/Outlet tutup/);
    expect(()=>validatePublicSchedule({isPreOrder:true,scheduledAt:'2026-08-24T21:00:00+07:00'},outlet,now)).toThrow(/di luar slot/);
  });
  it('does not allow schedules for an immediate order',()=>expect(()=>validatePublicSchedule({isPreOrder:false,scheduledAt:'2026-08-24T10:30:00+07:00'},outlet,now)).toThrow(/hanya boleh/));
});
