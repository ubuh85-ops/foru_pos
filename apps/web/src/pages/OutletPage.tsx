import { FormEvent, useEffect, useState } from 'react';
import { Edit, Plus } from 'lucide-react';
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
        autoPrintCustomerItemList: f.get('autoPrintCustomerItemList') === 'on'
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
      <button onClick={() => setEdit({ blockSaleWhenIngredientOutOfStock: true, allowSaleWithoutRecipe: true, autoPrintReceipt: false, autoPrintKitchen: false, autoPrintCustomerItemList: false, status: 'ACTIVE' })} className="btn-primary"><Plus size={18} /> Tambah</button>
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
