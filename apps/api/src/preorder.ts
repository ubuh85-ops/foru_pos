import { ApiError } from './lib.js';

export type PreOrderRequest = { isPreOrder:boolean; scheduledAt?:string|null };
export type PreOrderOutlet = {
  preOrderEnabled:boolean;
  preOrderMinLeadMinutes:number;
  preOrderMaxDaysAhead:number;
  preOrderSlotMinutes:number;
  customerOrderOpenTime:string;
  customerOrderCloseTime:string;
  customerOrderOperatingDays:number[];
  timezone:string;
};

function zonedParts(date:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date);
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return {date:`${get('year')}-${get('month')}-${get('day')}`,minutes:Number(get('hour'))*60+Number(get('minute')),weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'))};
}
const hmMinutes=(value:string)=>{const [h=0,m=0]=value.split(':').map(Number);return h*60+m;};

export function validatePublicSchedule(d:PreOrderRequest,outlet:PreOrderOutlet,now=new Date()){
  if(!d.isPreOrder){if(d.scheduledAt)throw new ApiError(400,'Jadwal hanya boleh diisi untuk Pre-Order');return null;}
  if(!outlet.preOrderEnabled)throw new ApiError(400,'Pre-Order tidak tersedia di outlet ini');
  if(!d.scheduledAt)throw new ApiError(400,'Tanggal dan jam Pre-Order wajib dipilih');
  const scheduledAt=new Date(d.scheduledAt);
  if(Number.isNaN(scheduledAt.getTime()))throw new ApiError(400,'Jadwal Pre-Order tidak valid');
  if(scheduledAt.getTime()<now.getTime()+outlet.preOrderMinLeadMinutes*60_000)throw new ApiError(400,`Jadwal minimal ${outlet.preOrderMinLeadMinutes} menit dari sekarang`);
  const local=zonedParts(scheduledAt,outlet.timezone),today=zonedParts(now,outlet.timezone),maxLocal=zonedParts(new Date(now.getTime()+outlet.preOrderMaxDaysAhead*86_400_000),outlet.timezone);
  if(local.date<today.date||local.date>maxLocal.date)throw new ApiError(400,`Tanggal Pre-Order maksimal ${outlet.preOrderMaxDaysAhead} hari ke depan`);
  if(!outlet.customerOrderOperatingDays.includes(local.weekday))throw new ApiError(400,'Outlet tutup pada tanggal yang dipilih. Silakan pilih tanggal lain.');
  const open=hmMinutes(outlet.customerOrderOpenTime),close=hmMinutes(outlet.customerOrderCloseTime);
  if(local.minutes<open||local.minutes>=close||(local.minutes-open)%outlet.preOrderSlotMinutes!==0)throw new ApiError(400,'Jam Pre-Order di luar slot operasional outlet');
  return scheduledAt;
}
