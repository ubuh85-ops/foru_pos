import { FormEvent, useEffect, useState } from 'react';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { api, rupiah } from '../api';
import { emitMasterDataChanged, subscribeMasterDataChanged } from '../masterEvents';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Err = ({ v }: { v: string }) => v ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{v}</div> : null;

type OptionForm = {
  groupId: string;
  option?: any;
};

export default function VariantGroupsPage() {
  const [data, setData] = useState<any[]>([]);
  const [editGroup, setEditGroup] = useState<any>(null);
  const [optionForm, setOptionForm] = useState<OptionForm | null>(null);
  const [error, setError] = useState('');

  function load() {
    api<any[]>('/variant-groups').then(setData).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    return subscribeMasterDataChanged(() => load());
  }, []);

  async function saveGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      await api(editGroup?.id ? `/variant-groups/${editGroup.id}` : '/variant-groups', {
        method: editGroup?.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: f.get('name'),
          description: f.get('description'),
          minSelect: Number(f.get('minSelect') || 0),
          maxSelect: Number(f.get('maxSelect') || 1),
          required: f.get('required') === 'on',
          status: f.get('status') || 'ACTIVE',
        }),
      });
      setEditGroup(null);
      load();
      emitMasterDataChanged('variant_group_updated');
      alert('Variant group berhasil disimpan.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveOption(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!optionForm) return;
    try {
      const f = new FormData(e.currentTarget);
      const payload = {
        name: String(f.get('name') || ''),
        additionalPrice: Number(f.get('additionalPrice') || 0),
        hpp: Number(f.get('hpp') || 0),
        sortOrder: Number(f.get('sortOrder') || 0),
        status: String(f.get('status') || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
      };
      if (optionForm.option) await api(`/variant-options/${optionForm.option.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api(`/variant-groups/${optionForm.groupId}/options`, { method: 'POST', body: JSON.stringify(payload) });
      setOptionForm(null);
      load();
      emitMasterDataChanged(optionForm.option ? 'variant_option_updated' : 'variant_option_created', { groupId: optionForm.groupId, optionId: optionForm.option?.id });
      alert(optionForm.option ? 'Opsi varian berhasil diubah.' : 'Opsi varian berhasil ditambahkan.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeOption(groupId: string, option: any) {
    try {
      if (!confirm(`Hapus/nonaktifkan opsi "${option.name}"?`)) return;
      await api(`/variant-options/${option.id}`, { method: 'DELETE' });
      load();
      emitMasterDataChanged('variant_option_deleted', { groupId, optionId: option.id });
      alert('Opsi varian berhasil dihapus/nonaktif.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleStatus(groupId: string, option: any) {
    try {
      await api(`/variant-options/${option.id}`, { method: 'PUT', body: JSON.stringify({ status: option.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
      load();
      emitMasterDataChanged('variant_option_updated', { groupId, optionId: option.id });
      alert(`Opsi varian berhasil dibuat ${option.status === 'ACTIVE' ? 'inactive' : 'active'}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <h2 className="text-3xl font-black">Variant groups</h2>
        <p className="text-slate-500">Reusable modifier seperti Size, Temperature, Topping.</p>
      </div>
      <button onClick={() => setEditGroup({})} className="btn-primary"><Plus size={18} /> Tambah Group</button>
    </div>
    <Err v={error} />
    <div className="grid gap-4 xl:grid-cols-2">
      {data.map((group) => <article className="card p-5" key={group.id}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-black">{group.name}</h3>
            <p className="mt-1 text-sm text-slate-400">{group.required ? 'Wajib' : 'Opsional'} · min {group.minSelect} · max {group.maxSelect}</p>
          </div>
          <span className={`pill ${group.status === 'ACTIVE' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100'}`}>{group.status}</span>
        </div>
        <div className="mt-4 space-y-2">
          {(group.options || []).filter((option: any) => option.status !== 'DELETED').map((option: any) => <div className="rounded-xl bg-slate-50 p-3 text-sm" key={option.id}>
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => setOptionForm({ groupId: group.id, option })} className="min-w-0 flex-1 text-left">
                <b className="block truncate">{option.name}</b>
                <p className="text-xs text-slate-400">
                  +{rupiah(option.additionalPrice)} · HPP {rupiah(option.hpp)} · Sort {option.sortOrder || 0} · {option.status}
                </p>
              </button>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <button onClick={() => setOptionForm({ groupId: group.id, option })} className="font-bold text-brand-600"><Edit size={15} /></button>
                <button onClick={() => toggleStatus(group.id, option)} className="text-xs font-bold text-amber-700">{option.status === 'ACTIVE' ? 'Inactive' : 'Active'}</button>
                <button onClick={() => removeOption(group.id, option)} className="font-bold text-red-600"><Trash2 size={15} /></button>
              </div>
            </div>
          </div>)}
        </div>
        <div className="mt-4 flex gap-4">
          <button onClick={() => setEditGroup(group)} className="text-sm font-bold text-brand-600">Edit group</button>
          <button onClick={() => setOptionForm({ groupId: group.id })} className="text-sm font-bold text-brand-600">+ Opsi</button>
        </div>
      </article>)}
    </div>
    {editGroup && <Modal title={editGroup.id ? 'Edit variant group' : 'Variant group baru'} close={() => setEditGroup(null)}>
      <form onSubmit={saveGroup}>
        <Field name="name" label="Nama group" value={editGroup.name} required />
        <Field name="description" label="Deskripsi" value={editGroup.description} />
        <Field name="minSelect" label="Min pilih" type="number" value={editGroup.minSelect ?? 0} />
        <Field name="maxSelect" label="Max pilih" type="number" value={editGroup.maxSelect ?? 1} />
        <label className="mb-3 flex items-center gap-2 text-sm"><input name="required" type="checkbox" defaultChecked={editGroup.required} /> Wajib dipilih</label>
        <label className="label">Status</label>
        <select className="input mb-3" name="status" defaultValue={editGroup.status || 'ACTIVE'}><option>ACTIVE</option><option>INACTIVE</option></select>
        <button className="btn-primary w-full">Simpan Group</button>
      </form>
    </Modal>}
    {optionForm && <Modal title={optionForm.option ? 'Edit opsi varian' : 'Tambah opsi varian'} close={() => setOptionForm(null)}>
      <form onSubmit={saveOption}>
        <Field name="name" label="Nama opsi" value={optionForm.option?.name} required />
        <Field name="additionalPrice" label="Tambahan harga" type="number" value={optionForm.option?.additionalPrice ?? 0} min={0} />
        <Field name="hpp" label="HPP tambahan" type="number" value={optionForm.option?.hpp ?? 0} min={0} />
        <Field name="sortOrder" label="Sort order" type="number" value={optionForm.option?.sortOrder ?? 0} />
        <label className="label">Status</label>
        <select className="input mb-4" name="status" defaultValue={optionForm.option?.status || 'ACTIVE'}><option>ACTIVE</option><option>INACTIVE</option></select>
        <button className="btn-primary w-full">Simpan Opsi</button>
      </form>
    </Modal>}
  </Page>;
}

function Field({ name, label, type = 'text', value, required, min }: { name: string; label: string; type?: string; value?: any; required?: boolean; min?: number }) {
  return <>
    <label className="label">{label}</label>
    <input className="input mb-3" name={name} type={type} defaultValue={value ?? ''} required={required} min={min} />
  </>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: any }) {
  return <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-auto bg-black/40 p-0 sm:items-center sm:p-4">
    <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
      <div className="mb-5 flex justify-between"><h3 className="section-title">{title}</h3><button onClick={close}>✕</button></div>
      {children}
    </div>
  </div>;
}
