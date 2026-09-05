import { FormEvent, useEffect, useState } from 'react';
import { Copy, Edit, Plus } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../api';
import { toast } from '../toast';

type Outlet = {
  id?: string;
  code?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
  status?: string;
  inventoryWarehouseId?: string | null;
  blockSaleWhenIngredientOutOfStock?: boolean;
  allowSaleWithoutRecipe?: boolean;
  autoPrintReceipt?: boolean;
  autoPrintKitchen?: boolean;
  autoPrintCustomerItemList?: boolean;
  customerOrderingEnabled?: boolean;
  customerOrderingSlug?: string | null;
  acceptingCustomerOrders?: boolean;
  customerOrderAllowDineIn?: boolean;
  customerOrderAllowTakeAway?: boolean;
  customerOrderAllowDelivery?: boolean;
  customerOrderRequestPhone?: boolean;
  customerOrderSoundEnabled?: boolean;
  preOrderEnabled?: boolean;
  preOrderMinLeadMinutes?: number;
  preOrderMaxDaysAhead?: number;
  preOrderSlotMinutes?: number;
  customerOrderOpenTime?: string;
  customerOrderCloseTime?: string;
  customerOrderOperatingDays?: number[];
  timezone?: string;
  defaultInventoryWarehouse?: { id: string; name: string } | null;
};

type Warehouse = {
  id: string;
  name: string;
  code?: string;
  outlet?: { name: string } | null;
};

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Err = ({ value }: { value: string }) => value ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{value}</div> : null;
const publicSlug = (value = '') => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const CUSTOMER_ORDER_ORIGIN = 'https://foru.web.id';

function businessSlug() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return publicSlug(user?.business?.code || user?.business?.name || 'foru') || 'foru';
  } catch {
    return 'foru';
  }
}

function customerOrderUrl(outlet: Outlet) {
  const outletSlug = publicSlug(outlet.customerOrderingSlug || outlet.code || outlet.name || '');
  return `${CUSTOMER_ORDER_ORIGIN}/order/${businessSlug()}/${outletSlug || 'outlet'}`;
}

async function copyText(value: string) {
  await navigator.clipboard?.writeText(value);
  toast.success('Link berhasil disalin.');
}

async function downloadQr(outlet: Outlet) {
  const url = customerOrderUrl(outlet);
  const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `customer-order-${publicSlug(outlet.code || outlet.name || 'outlet')}.png`;
  a.click();
  toast.success('QR berhasil dibuat.');
}

export default function OutletPage() {
  const [data, setData] = useState<Outlet[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [edit, setEdit] = useState<Outlet | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => api<Outlet[]>('/outlets').then(setData);

  useEffect(() => {
    load().catch(e => setError((e as Error).message));
    api<Warehouse[]>('/inventory/warehouses?status=ACTIVE').then(setWarehouses).catch(() => setWarehouses([]));
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const f = new FormData(e.currentTarget);
      const body = {
        code: String(f.get('code') || '').trim(),
        name: String(f.get('name') || '').trim(),
        address: f.get('address') || null,
        phone: f.get('phone') || null,
        status: f.get('status') || 'ACTIVE',
        inventoryWarehouseId: f.get('inventoryWarehouseId') || null,
        blockSaleWhenIngredientOutOfStock: f.get('blockSaleWhenIngredientOutOfStock') === 'on',
        allowSaleWithoutRecipe: f.get('allowSaleWithoutRecipe') === 'on',
        autoPrintReceipt: f.get('autoPrintReceipt') === 'on',
        autoPrintKitchen: f.get('autoPrintKitchen') === 'on',
        autoPrintCustomerItemList: f.get('autoPrintCustomerItemList') === 'on',
        customerOrderingEnabled: f.get('customerOrderingEnabled') === 'on',
        customerOrderingSlug: String(f.get('customerOrderingSlug') || '').trim() || null,
        customerOrderAllowDineIn: f.get('customerOrderAllowDineIn') === 'on',
        customerOrderAllowTakeAway: f.get('customerOrderAllowTakeAway') === 'on',
        customerOrderAllowDelivery: f.get('customerOrderAllowDelivery') === 'on',
        customerOrderRequestPhone: f.get('customerOrderRequestPhone') === 'on',
        customerOrderSoundEnabled: f.get('customerOrderSoundEnabled') === 'on',
        preOrderEnabled: f.get('preOrderEnabled') === 'on',
        preOrderMinLeadMinutes: Number(f.get('preOrderMinLeadMinutes') || 60),
        preOrderMaxDaysAhead: Number(f.get('preOrderMaxDaysAhead') || 14),
        preOrderSlotMinutes: Number(f.get('preOrderSlotMinutes') || 30),
        customerOrderOpenTime: String(f.get('customerOrderOpenTime') || '08:00'),
        customerOrderCloseTime: String(f.get('customerOrderCloseTime') || '21:00'),
        customerOrderOperatingDays: [0,1,2,3,4,5,6].filter(day=>f.get(`operatingDay${day}`)==='on'),
        timezone: String(f.get('timezone') || 'Asia/Jakarta')
      };
      await api(edit?.id ? `/outlets/${edit.id}` : '/outlets', {
        method: edit?.id ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      setEdit(null);
      await load();
      toast.success('Outlet berhasil disimpan.');
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><h2 className="text-3xl font-black">Master outlet</h2><p className="text-slate-500">Kelola lokasi operasional dan warehouse inventory outlet.</p></div>
      <button onClick={() => setEdit({ blockSaleWhenIngredientOutOfStock: true, allowSaleWithoutRecipe: true, autoPrintReceipt: false, autoPrintKitchen: false, autoPrintCustomerItemList: false, customerOrderingEnabled: false, acceptingCustomerOrders: true, customerOrderAllowDineIn: true, customerOrderAllowTakeAway: true, customerOrderAllowDelivery:false, customerOrderRequestPhone: true, customerOrderSoundEnabled: false, preOrderEnabled:true, preOrderMinLeadMinutes:60, preOrderMaxDaysAhead:14, preOrderSlotMinutes:30, customerOrderOpenTime:'08:00', customerOrderCloseTime:'21:00', customerOrderOperatingDays:[0,1,2,3,4,5,6], timezone:'Asia/Jakarta', status: 'ACTIVE' })} className="btn-primary"><Plus size={18} /> Tambah</button>
    </div>
    <Err value={error} />
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map(o => <div className="card p-5" key={o.id}>
        <div className="mb-5 flex justify-between">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 font-black text-brand-700">{o.code}</span>
          <span className={`pill ${o.status === 'ACTIVE' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100'}`}>{o.status}</span>
        </div>
        <h3 className="text-xl font-black">{o.name}</h3>
        <p className="mt-2 text-sm text-slate-400">{o.address || 'Alamat belum diisi'}</p>
        <p className="mt-1 text-sm text-slate-400">{o.phone || 'Telepon belum diisi'}</p>
        <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm">
          <p className="text-xs font-bold uppercase text-slate-400">Inventory Warehouse</p>
          <b className="mt-1 block">{o.defaultInventoryWarehouse?.name || 'Belum diset'}</b>
          <p className="mt-1 text-xs text-slate-400">{o.blockSaleWhenIngredientOutOfStock ? 'Block jika bahan habis' : 'Tidak block bahan habis'} · {o.allowSaleWithoutRecipe ? 'Boleh tanpa recipe' : 'Wajib recipe'}</p>
        </div>
        <div className="mt-3 rounded-2xl bg-brand-50 p-3 text-sm">
          <p className="text-xs font-bold uppercase text-brand-700">Printer & Struk</p>
          <p className="mt-1 text-xs text-brand-800">
            Receipt: {o.autoPrintReceipt ? 'ON' : 'OFF'} Â· Kitchen: {o.autoPrintKitchen ? 'ON' : 'OFF'} Â· Item List: {o.autoPrintCustomerItemList ? 'ON' : 'OFF'}
          </p>
        </div>
        <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-slate-400">Customer Web Ordering</p>
              <b className={`mt-1 block ${o.customerOrderingEnabled ? 'text-green-700' : 'text-slate-500'}`}>{o.customerOrderingEnabled ? 'Enabled' : 'Disabled'} · {o.acceptingCustomerOrders === false ? 'Closed' : 'Accepting'}</b>
              <p className="mt-1 truncate text-xs text-slate-400">{customerOrderUrl(o)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => copyText(customerOrderUrl(o)).catch(() => toast.error('Gagal menyalin link.'))} className="rounded-xl border bg-white p-2 text-brand-700" title="Copy link"><Copy size={16} /></button>
              <button onClick={() => downloadQr(o).catch(() => toast.error('Gagal membuat QR.'))} className="rounded-xl border bg-white px-3 py-2 text-xs font-black text-brand-700">QR</button>
            </div>
          </div>
        </div>
        <button onClick={() => setEdit(o)} className="mt-4 flex items-center gap-2 text-sm font-bold text-brand-600"><Edit size={16} /> Edit info outlet</button>
      </div>)}
    </div>
    {edit && <Modal title={edit.id ? 'Edit outlet' : 'Outlet baru'} close={() => setEdit(null)}>
      <form onSubmit={save}>
        <Field name="code" label="Kode outlet" value={edit.code} required />
        <Field name="name" label="Nama outlet" value={edit.name} required />
        <Field name="address" label="Alamat" value={edit.address} />
        <Field name="phone" label="Telepon" value={edit.phone} />
        <label className="label">Default Inventory Warehouse</label>
        <select className="input mb-3" name="inventoryWarehouseId" defaultValue={edit.inventoryWarehouseId || ''}>
          <option value="">Belum diset</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}{w.outlet?.name ? ` · ${w.outlet.name}` : ''}</option>)}
        </select>
        <div className="mb-3 rounded-2xl bg-slate-50 p-3">
          <label className="mb-2 flex items-center gap-2 text-sm font-bold"><input name="blockSaleWhenIngredientOutOfStock" type="checkbox" defaultChecked={edit.blockSaleWhenIngredientOutOfStock !== false} /> Block transaksi jika stok bahan tidak cukup</label>
          <label className="flex items-center gap-2 text-sm font-bold"><input name="allowSaleWithoutRecipe" type="checkbox" defaultChecked={edit.allowSaleWithoutRecipe !== false} /> Izinkan produk tanpa recipe tetap dijual</label>
          <p className="mt-2 text-xs text-slate-400">COGS/HPP tetap memakai HPP produk. Setting ini hanya untuk validasi dan potong stok bahan.</p>
        </div>
        <div className="mb-3 rounded-2xl bg-brand-50 p-3">
          <p className="mb-2 text-sm font-black text-brand-800">Printer & Struk</p>
          <label className="mb-2 flex items-center gap-2 text-sm font-bold"><input name="autoPrintReceipt" type="checkbox" defaultChecked={!!edit.autoPrintReceipt} /> Auto print receipt setelah transaksi paid</label>
          <label className="mb-2 flex items-center gap-2 text-sm font-bold"><input name="autoPrintKitchen" type="checkbox" defaultChecked={!!edit.autoPrintKitchen} /> Auto print kitchen ticket</label>
          <label className="flex items-center gap-2 text-sm font-bold"><input name="autoPrintCustomerItemList" type="checkbox" defaultChecked={!!edit.autoPrintCustomerItemList} /> Auto print customer item list untuk pending order</label>
          <p className="mt-2 text-xs text-brand-700">Tahap awal: setting disimpan per outlet dan siap dipakai oleh flow print.</p>
        </div>
        <div className="mb-3 rounded-2xl bg-slate-50 p-3">
          <p className="mb-2 text-sm font-black text-slate-800">Customer Web Ordering</p>
          <label className="mb-2 flex items-center gap-2 text-sm font-bold"><input name="customerOrderingEnabled" type="checkbox" defaultChecked={!!edit.customerOrderingEnabled} /> Enable Customer Ordering</label>
          <label className="label">Public Slug</label>
          <input className="input mb-3" name="customerOrderingSlug" defaultValue={edit.customerOrderingSlug || publicSlug(edit.code || edit.name || '')} placeholder="foru-huis" />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-bold"><input name="customerOrderAllowDineIn" type="checkbox" defaultChecked={edit.customerOrderAllowDineIn !== false} /> Allow Dine In</label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="customerOrderAllowTakeAway" type="checkbox" defaultChecked={edit.customerOrderAllowTakeAway !== false} /> Allow Take Away</label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="customerOrderAllowDelivery" type="checkbox" defaultChecked={!!edit.customerOrderAllowDelivery} /> Allow Delivery</label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="customerOrderRequestPhone" type="checkbox" defaultChecked={!!edit.customerOrderRequestPhone} /> Request Phone Number</label>
            <label className="flex items-center gap-2 text-sm font-bold"><input name="customerOrderSoundEnabled" type="checkbox" defaultChecked={!!edit.customerOrderSoundEnabled} /> Customer Order Sound</label>
          </div>
          <div className="mt-4 border-t pt-4"><label className="mb-3 flex items-center gap-2 text-sm font-black"><input name="preOrderEnabled" type="checkbox" defaultChecked={edit.preOrderEnabled!==false}/> Enable Pre-Order</label><div className="grid grid-cols-3 gap-2"><Field name="preOrderMinLeadMinutes" label="Lead (menit)" value={edit.preOrderMinLeadMinutes??60}/><Field name="preOrderMaxDaysAhead" label="Maks. hari" value={edit.preOrderMaxDaysAhead??14}/><Field name="preOrderSlotMinutes" label="Slot (menit)" value={edit.preOrderSlotMinutes??30}/></div><div className="grid grid-cols-2 gap-2"><Field name="customerOrderOpenTime" label="Jam buka" value={edit.customerOrderOpenTime||'08:00'}/><Field name="customerOrderCloseTime" label="Jam tutup" value={edit.customerOrderCloseTime||'21:00'}/></div><Field name="timezone" label="Timezone" value={edit.timezone||'Asia/Jakarta'}/><p className="label">Hari operasional</p><div className="flex flex-wrap gap-2">{['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map((label,day)=><label key={day} className="rounded-lg bg-white p-2 text-xs font-bold"><input className="mr-1" name={`operatingDay${day}`} type="checkbox" defaultChecked={(edit.customerOrderOperatingDays||[0,1,2,3,4,5,6]).includes(day)}/>{label}</label>)}</div></div>
          <div className="mt-3 rounded-xl bg-white p-3 text-xs text-slate-500">
            Order URL: <span className="font-bold text-slate-700">{edit.id ? customerOrderUrl(edit) : 'Simpan outlet dulu untuk link final.'}</span>
          </div>
        </div>
        {edit.id && <><label className="label">Status</label><select className="input mb-3" name="status" defaultValue={edit.status || 'ACTIVE'}><option>ACTIVE</option><option>INACTIVE</option></select></>}
        <button disabled={submitting} className="btn-primary mt-3 w-full">{submitting ? 'Menyimpan...' : 'Simpan Outlet'}</button>
      </form>
    </Modal>}
  </Page>;
}

function Field({ name, label, value, required = false }: { name: string; label: string; value?: any; required?: boolean }) {
  return <label className="mb-3 block"><span className="label">{label}</span><input className="input" name={name} defaultValue={value ?? ''} required={required} /></label>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: any }) {
  return <div data-back-modal="true" className="fixed inset-0 z-[60] flex items-end justify-center overflow-auto bg-black/40 p-0 sm:items-center sm:p-4">
    <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
      <div className="mb-5 flex justify-between"><h3 className="section-title">{title}</h3><button data-back-close="true" onClick={close}>×</button></div>{children}
    </div>
  </div>;
}
