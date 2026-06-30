import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Edit, Plus, Search } from 'lucide-react';
import { api, rupiah } from '../api';
import { downloadMasterData } from '../sync';
import { emitMasterDataChanged, subscribeMasterDataChanged } from '../masterEvents';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Err = ({ v }: { v: string }) => v ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{v}</div> : null;
const Head = ({ title, sub, action }: any) => <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-3xl font-black">{title}</h2><p className="text-slate-500">{sub}</p></div>{action && <button onClick={action} className="btn-primary"><Plus size={18} /> Tambah</button>}</div>;
const Modal = ({ title, close, children }: any) => <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h3 className="text-2xl font-black">{title}</h3><button onClick={close} className="text-2xl">×</button></div>{children}</div></div>;

function Fields({ items, values = {} }: any) {
  return <>{items.map(([name, label, type = 'text']: any) => <label key={name} className="mb-3 block"><span className="label">{label}</span><input className="input" name={name} type={type} defaultValue={values[name] ?? ''} required={['name'].includes(name)} /></label>)}</>;
}
function CheckList({ title, name, rows, checked = [] }: any) {
  return <div className="mt-4"><p className="label">{title}</p><div className="grid gap-2 sm:grid-cols-2">{rows.map(([id, label]: any) => <label key={id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm"><input name={name} value={id} type="checkbox" defaultChecked={checked.includes(id)} /> {label}</label>)}</div></div>;
}

export default function ProductPage() {
  const [data, setData] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [outlets, setOutlets] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const load = () => api<any[]>('/products').then(setData);
  useEffect(() => {
    load();
    api<any[]>('/categories').then(setCategories);
    api<any[]>('/variant-groups').then(setGroups);
    api<any[]>('/outlets').then(setOutlets);
    return subscribeMasterDataChanged(() => {
      load();
      api<any[]>('/variant-groups').then(setGroups);
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter(p => {
      const cat = String(p.categoryRef?.name || p.category || '').toLowerCase();
      const matchSearch = !q || String(p.name || '').toLowerCase().includes(q) || String(p.description || '').toLowerCase().includes(q) || cat.includes(q);
      const matchCategory = !categoryId || p.categoryId === categoryId || p.categoryRef?.id === categoryId;
      return matchSearch && matchCategory;
    });
  }, [data, search, categoryId]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const outletPricing = outlets.map(o => ({
        outletId: o.id,
        isAvailable: f.get(`available_${o.id}`) === 'on',
        outletPrice: f.get(`price_${o.id}`) ? Number(f.get(`price_${o.id}`)) : null,
        outletHpp: f.get(`hpp_${o.id}`) ? Number(f.get(`hpp_${o.id}`)) : null,
        status: f.get(`status_${o.id}`) || 'ACTIVE'
      }));
      await api(edit?.id ? `/products/${edit.id}` : '/products', {
        method: edit?.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: f.get('name'),
          categoryId: f.get('categoryId'),
          description: f.get('description'),
          imageUrl: f.get('imageUrl'),
          basePrice: Number(f.get('basePrice') || 0),
          baseHpp: Number(f.get('baseHpp') || 0),
          status: f.get('status') || 'ACTIVE',
          variantGroupIds: f.getAll('variantGroupIds'),
          outletPricing
        })
      });
      await downloadMasterData('ONLINE');
      emitMasterDataChanged('product_master_updated');
      setEdit(null);
      load();
      alert('Produk berhasil disimpan.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function rowFor(o: any) { return (edit?.outlets || []).find((x: any) => x.outletId === o.id); }

  return <Page>
    <Head title="Master produk" sub="Produk, harga/HPP outlet, kategori, dan attached variant groups." action={() => setEdit({})} />
    <Err v={error} />
    <div className="mb-4 grid gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input className="input pl-11" placeholder="Cari produk, deskripsi, atau kategori..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Semua kategori</option>{categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
    </div>

    <div className="space-y-3 md:hidden">{filtered.map(p => <ProductCard key={p.id} p={p} setEdit={setEdit} />)}{!filtered.length && <EmptyProduct />}</div>
    <div className="card hidden overflow-hidden md:block"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-4">Produk</th><th>Kategori</th><th>Base Price</th><th>Base HPP</th><th>Variant Groups</th><th>Outlet aktif</th><th>Status</th><th></th></tr></thead><tbody>{filtered.map(p => <tr className="border-t" key={p.id}><td className="p-4 font-bold">{p.name}<p className="font-normal text-slate-400">{p.description}</p></td><td>{p.categoryRef?.name || p.category}</td><td>{rupiah(p.basePrice)}</td><td>{rupiah(p.baseHpp)}</td><td>{p.variantGroups?.map((x: any) => x.group.name).join(', ') || '-'}</td><td>{(p.outlets || []).filter((x: any) => x.isAvailable && x.status === 'ACTIVE').length} outlet</td><td><span className="pill bg-brand-50 text-brand-700">{p.status}</span></td><td><button onClick={() => setEdit(p)} className="text-brand-600"><Edit size={17} /></button></td></tr>)}</tbody></table></div>{!filtered.length && <EmptyProduct />}</div>

    {edit && <Modal title={edit.id ? 'Edit produk' : 'Produk baru'} close={() => setEdit(null)}><form onSubmit={save}><Fields values={edit} items={[['name', 'Nama produk'], ['description', 'Deskripsi'], ['imageUrl', 'Image URL'], ['basePrice', 'Base selling price', 'number'], ['baseHpp', 'Base HPP', 'number']]} /><label className="label">Kategori</label><select className="input mb-3" name="categoryId" defaultValue={edit.categoryId || categories[0]?.id} required>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><label className="label">Status produk master</label><select className="input mb-3" name="status" defaultValue={edit.status || 'ACTIVE'}><option>ACTIVE</option><option>INACTIVE</option></select><CheckList title="Variant Groups" name="variantGroupIds" rows={groups.map(g => [g.id, g.name])} checked={(edit.variantGroups || []).map((x: any) => x.variantGroupId)} /><div className="mt-5"><label className="label">Outlet Availability & Pricing</label><div className="overflow-auto rounded-2xl border"><table className="w-full min-w-[640px] text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">Outlet</th><th>Available</th><th>Price</th><th>HPP</th><th>Status</th></tr></thead><tbody>{outlets.map(o => { const r = rowFor(o), isNew = !edit.id; return <tr className="border-t" key={o.id}><td className="p-3 font-bold">{o.name}<p className="text-xs font-normal text-slate-400">{o.code}</p></td><td className="text-center"><input name={`available_${o.id}`} type="checkbox" defaultChecked={isNew ? true : !!r?.isAvailable} /></td><td className="p-2"><input className="input" name={`price_${o.id}`} type="number" min="0" placeholder={`Base ${edit.basePrice ?? 0}`} defaultValue={r?.outletPrice ?? ''} /></td><td className="p-2"><input className="input" name={`hpp_${o.id}`} type="number" min="0" placeholder={`Base ${edit.baseHpp ?? 0}`} defaultValue={r?.outletHpp ?? ''} /></td><td className="p-2"><select className="input" name={`status_${o.id}`} defaultValue={r?.status || (isNew ? 'ACTIVE' : 'INACTIVE')}><option>ACTIVE</option><option>INACTIVE</option></select></td></tr>; })}</tbody></table></div><p className="mt-2 text-xs text-slate-400">Kosongkan Price/HPP outlet untuk memakai Base Price/Base HPP produk.</p></div><button className="btn-primary mt-5 w-full">Simpan Produk</button></form></Modal>}
  </Page>;
}

function ProductCard({ p, setEdit }: any) {
  return <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="line-clamp-2 font-black text-ink">{p.name}</h3><p className="text-sm text-slate-400">{p.categoryRef?.name || p.category}</p></div><button onClick={() => setEdit(p)} className="shrink-0 rounded-xl bg-brand-50 p-2 text-brand-600"><Edit size={17} /></button></div><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Harga</p><b>{rupiah(p.basePrice)}</b></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">HPP</p><b>{rupiah(p.baseHpp)}</b></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Outlet aktif</p><b>{(p.outlets || []).filter((x: any) => x.isAvailable && x.status === 'ACTIVE').length} outlet</b></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Status</p><span className="pill bg-brand-50 text-brand-700">{p.status}</span></div></div><div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-400">Variant Groups</p><p className="mt-1 line-clamp-2">{p.variantGroups?.map((x: any) => x.group.name).join(', ') || '-'}</p></div></div>;
}
function EmptyProduct() { return <div className="p-8 text-center text-slate-400">Produk tidak ditemukan.</div>; }
