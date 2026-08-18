import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Download, Edit, FileDown, FileUp, Plus, Search, Trash2 } from 'lucide-react';
import { API, api, handleUnauthorizedSession, rupiah } from '../api';
import { downloadMasterData } from '../sync';
import { emitMasterDataChanged, subscribeMasterDataChanged } from '../masterEvents';
import { toast } from '../toast';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Err = ({ v }: { v: string }) => v ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{v}</div> : null;
const Head = ({ title, sub, action }: any) => <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-3xl font-black">{title}</h2><p className="text-slate-500">{sub}</p></div>{action && <button onClick={action} className="btn-primary"><Plus size={18} /> Tambah</button>}</div>;
const Modal = ({ title, close, children }: any) => <div data-back-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h3 className="text-2xl font-black">{title}</h3><button data-back-close="true" onClick={close} className="text-2xl">×</button></div>{children}</div></div>;

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
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [inventoryUnits, setInventoryUnits] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState('');
  const [importEncoding, setImportEncoding] = useState<'text' | 'base64'>('text');
  const [importMode, setImportMode] = useState('UPSERT');
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const load = () => api<any[]>('/products').then(setData);
  useEffect(() => {
    load();
    api<any[]>('/categories').then(setCategories);
    api<any[]>('/variant-groups').then(setGroups);
    api<any[]>('/outlets').then(setOutlets);
    api<any[]>('/inventory/items').then(setInventoryItems).catch(() => setInventoryItems([]));
    api<any[]>('/inventory/units').then(setInventoryUnits).catch(() => setInventoryUnits([]));
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

  function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  async function downloadFile(path: string, filename: string) {
    const res = await fetch(API + path, { headers: authHeaders() });
    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      handleUnauthorizedSession(data.message);
      throw new Error(data.message || 'Sesi tidak valid atau telah berakhir');
    }
    if (!res.ok) throw new Error('Download gagal');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  const exportAll = async () => {
    try { await downloadFile('/products/export', 'foru-products-export.csv'); }
    catch (e) { toast.error((e as Error).message); }
  };
  const exportSelected = async () => {
    if (!selectedIds.length) return toast.error('Pilih produk terlebih dahulu.');
    try { await downloadFile(`/products/export?ids=${selectedIds.join(',')}`, 'foru-products-selected.csv'); }
    catch (e) { toast.error((e as Error).message); }
  };
  const downloadTemplate = async () => {
    try { await downloadFile('/products/import-template', 'foru-product-import-template.csv'); }
    catch (e) { toast.error((e as Error).message); }
  };
  async function readImportFile(file: File) {
    setImportFile(file.name);
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.csv')) {
      setImportEncoding('text');
      setImportText(await file.text());
      setImportPreview(null);
      return;
    }
    if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
      setImportEncoding('base64');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('File tidak bisa dibaca.'));
        reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
        reader.readAsDataURL(file);
      });
      setImportText(base64);
      setImportPreview(null);
      return;
    }
    toast.error('Format file tidak didukung. Gunakan CSV, XLS, atau XLSX.');
  }
  function importPayload(preview: boolean) {
    return JSON.stringify({ filename: importFile, mode: importMode, preview, content: importText, encoding: importEncoding });
  }
  function resetImportState() {
    setImportPreview(null);
    setImportText('');
    setImportFile('');
    setImportEncoding('text');
  }
  async function previewImport() {
    if (!importText.trim()) {
      toast.error('Upload file CSV, XLS, atau XLSX terlebih dahulu.');
      return;
    }
    setImporting(true);
    try {
      const result = await api('/products/import', { method: 'POST', body: importPayload(true) });
      setImportPreview(result);
    } catch (e) { toast.error((e as Error).message); }
    finally { setImporting(false); }
  }
  async function commitImport() {
    if (!importText.trim()) return toast.error('Upload file CSV, XLS, atau XLSX terlebih dahulu.');
    setImporting(true);
    try {
      const result: any = await api('/products/import', { method: 'POST', body: importPayload(false) });
      toast.success(`Import selesai. Baru ${result.summary.imported}, update ${result.summary.updated}, gagal ${result.summary.failed}.`);
      setImportOpen(false);
      resetImportState();
      await downloadMasterData('ONLINE');
      emitMasterDataChanged('product_master_updated');
      load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setImporting(false); }
  }
  function downloadErrorReport() {
    const rows = [['Row', 'SKU', 'Product', 'Error'], ...(importPreview?.preview || []).filter((x: any) => x.status === 'ERROR').map((x: any) => [x.row, x.sku, x.product, x.message])];
    const csv = rows.map(r => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'foru-product-import-errors.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const f = new FormData(e.currentTarget);
      const outletPricing = outlets.map(o => ({
        outletId: o.id,
        isAvailable: f.get(`available_${o.id}`) === 'on',
        outletPrice: f.get(`price_${o.id}`) ? Number(f.get(`price_${o.id}`)) : null,
        outletHpp: f.get(`hpp_${o.id}`) ? Number(f.get(`hpp_${o.id}`)) : null,
        status: f.get(`status_${o.id}`) || 'ACTIVE'
      }));
      const channelPricing = outlets.flatMap(o => ['GOFOOD', 'GRABFOOD', 'SHOPEEFOOD'].map(channel => ({
        outletId: o.id,
        channel,
        price: f.get(`channel_${channel}_${o.id}`) ? Number(f.get(`channel_${channel}_${o.id}`)) : null,
        status: f.get(`channel_${channel}_${o.id}`) ? 'ACTIVE' : 'INACTIVE'
      })));
      const saved:any = await api(edit?.id ? `/products/${edit.id}` : '/products', {
        method: edit?.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: f.get('name'),
          sku: f.get('sku'),
          categoryId: f.get('categoryId'),
          description: f.get('description'),
          imageUrl: f.get('imageUrl'),
          basePrice: Number(f.get('basePrice') || 0),
          baseHpp: Number(f.get('baseHpp') || 0),
          status: f.get('status') || 'ACTIVE',
          variantGroupIds: f.getAll('variantGroupIds'),
          outletPricing,
          channelPricing
        })
      });
      const productId = edit?.id || saved?.id;
      const recipeItemIds = f.getAll('recipeInventoryItemId').map(String);
      const recipeRows = recipeItemIds.map((inventoryItemId, i) => ({
        inventoryItemId,
        usageQty: Number(f.getAll('recipeUsageQty')[i] || 0),
        usageUnitId: String(f.getAll('recipeUsageUnitId')[i] || ''),
        wastePercent: Number(f.getAll('recipeWastePercent')[i] || 0),
        isActive: true
      })).filter(row => row.inventoryItemId && row.usageUnitId && row.usageQty > 0);
      if (productId && (recipeRows.length || edit?.recipes?.length)) {
        await api(`/products/${productId}/recipe`, { method: 'PUT', body: JSON.stringify({ items: recipeRows }) });
      }
      await downloadMasterData('ONLINE');
      emitMasterDataChanged('product_master_updated');
      setEdit(null);
      load();
      toast.success('Data berhasil disimpan.');
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }
  function rowFor(o: any) { return (edit?.outlets || []).find((x: any) => x.outletId === o.id); }
  function channelPriceFor(o: any, channel: string) { return (edit?.channelPrices || []).find((x: any) => x.outletId === o.id && x.channel === channel)?.price ?? ''; }

  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
      <div><h2 className="text-3xl font-black">Master produk</h2><p className="text-slate-500">Produk, harga/HPP outlet, kategori, dan attached variant groups.</p></div>
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
        <button onClick={() => setEdit({})} className="btn-primary"><Plus size={18} /> Tambah</button>
        <button onClick={() => setImportOpen(true)} className="btn-soft"><FileUp size={18} /> Import</button>
        <button onClick={exportAll} className="btn-soft"><Download size={18} /> Export</button>
        <button onClick={exportSelected} className="btn-soft"><FileDown size={18} /> Export Selected</button>
        <button onClick={downloadTemplate} className="btn-soft">Template</button>
      </div>
    </div>
    <Err v={error} />
    <div className="mb-4 grid gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input className="input pl-11" placeholder="Cari produk, deskripsi, atau kategori..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Semua kategori</option>{categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
    </div>

    <div className="grid gap-3 md:grid-cols-2 xl:hidden">{filtered.map(p => <ProductCard key={p.id} p={p} setEdit={setEdit} selected={selectedIds.includes(p.id)} toggle={() => setSelectedIds(v => v.includes(p.id) ? v.filter(x => x !== p.id) : [...v, p.id])} />)}{!filtered.length && <EmptyProduct />}</div>
    <div className="card hidden overflow-hidden xl:block"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-4"><input type="checkbox" checked={!!filtered.length && filtered.every(p => selectedIds.includes(p.id))} onChange={e => setSelectedIds(e.target.checked ? filtered.map(p => p.id) : [])} /></th><th>Produk</th><th>SKU</th><th>Kategori</th><th>Base Price</th><th>Base HPP</th><th>Variant Groups</th><th>Outlet aktif</th><th>Status</th><th></th></tr></thead><tbody>{filtered.map(p => <tr className="border-t" key={p.id}><td className="p-4"><input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => setSelectedIds(v => v.includes(p.id) ? v.filter(x => x !== p.id) : [...v, p.id])} /></td><td className="font-bold">{p.name}<p className="font-normal text-slate-400">{p.description}</p></td><td>{p.sku || '-'}</td><td>{p.categoryRef?.name || p.category}</td><td>{rupiah(p.basePrice)}</td><td>{rupiah(p.baseHpp)}</td><td>{p.variantGroups?.map((x: any) => x.group.name).join(', ') || '-'}</td><td>{(p.outlets || []).filter((x: any) => x.isAvailable && x.status === 'ACTIVE').length} outlet</td><td><span className="pill bg-brand-50 text-brand-700">{p.status}</span></td><td><button onClick={() => setEdit(p)} className="text-brand-600"><Edit size={17} /></button></td></tr>)}</tbody></table></div>{!filtered.length && <EmptyProduct />}</div>

    {edit && <Modal title={edit.id ? 'Edit produk' : 'Produk baru'} close={() => setEdit(null)}><form onSubmit={save}><Fields values={edit} items={[['sku', 'SKU / Product Code'], ['name', 'Nama produk'], ['description', 'Deskripsi'], ['imageUrl', 'Image URL'], ['basePrice', 'Base selling price', 'number'], ['baseHpp', 'Base HPP', 'number']]} /><label className="label">Kategori</label><select className="input mb-3" name="categoryId" defaultValue={edit.categoryId || categories[0]?.id} required>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><label className="label">Status produk master</label><select className="input mb-3" name="status" defaultValue={edit.status || 'ACTIVE'}><option>ACTIVE</option><option>INACTIVE</option></select><CheckList title="Variant Groups" name="variantGroupIds" rows={groups.map(g => [g.id, g.name])} checked={(edit.variantGroups || []).map((x: any) => x.variantGroupId)} /><RecipeSection product={edit} items={inventoryItems} units={inventoryUnits} /><div className="mt-5"><label className="label">Outlet Availability & Pricing</label><div className="overflow-auto rounded-2xl border"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3 text-left">Outlet</th><th>Available</th><th>Dine In Price</th><th>HPP</th><th>GoFood</th><th>GrabFood</th><th>ShopeeFood</th><th>Status</th></tr></thead><tbody>{outlets.map(o => { const r = rowFor(o), isNew = !edit.id; return <tr className="border-t" key={o.id}><td className="p-3 font-bold">{o.name}<p className="text-xs font-normal text-slate-400">{o.code}</p></td><td className="text-center"><input name={`available_${o.id}`} type="checkbox" defaultChecked={isNew ? true : !!r?.isAvailable} /></td><td className="p-2"><input className="input" name={`price_${o.id}`} type="number" min="0" placeholder={`Base ${edit.basePrice ?? 0}`} defaultValue={r?.outletPrice ?? ''} /></td><td className="p-2"><input className="input" name={`hpp_${o.id}`} type="number" min="0" placeholder={`Base ${edit.baseHpp ?? 0}`} defaultValue={r?.outletHpp ?? ''} /></td>{['GOFOOD','GRABFOOD','SHOPEEFOOD'].map(ch => <td className="p-2" key={ch}><input className="input" name={`channel_${ch}_${o.id}`} type="number" min="0" placeholder="Fallback Dine In" defaultValue={channelPriceFor(o, ch)} /></td>)}<td className="p-2"><select className="input" name={`status_${o.id}`} defaultValue={r?.status || (isNew ? 'ACTIVE' : 'INACTIVE')}><option>ACTIVE</option><option>INACTIVE</option></select></td></tr>; })}</tbody></table></div><p className="mt-2 text-xs text-slate-400">Kosongkan harga online untuk memakai harga Dine In outlet. HPP tetap memakai HPP produk/outlet.</p></div><button disabled={submitting} className="btn-primary mt-5 w-full">{submitting ? 'Menyimpan...' : 'Simpan Produk'}</button></form></Modal>}
    {importOpen && <Modal title="Import Produk" close={() => setImportOpen(false)}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-800">Gunakan template yang tersedia. Import mendukung CSV, XLS, dan XLSX. SKU boleh kosong, nanti dibuat otomatis dari nama produk. Category kosong akan masuk ke kategori Lainnya; category baru akan dibuat otomatis.</div>
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="block rounded-2xl border border-dashed border-slate-300 p-5 text-center">
            <FileUp className="mx-auto mb-2 text-brand-600" />
            <b>{importFile || 'Upload CSV / XLS / XLSX produk'}</b>
            <input className="hidden" type="file" accept=".csv,text/csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => e.target.files?.[0] && readImportFile(e.target.files[0])} />
            <p className="mt-1 text-xs text-slate-400">Klik untuk pilih file</p>
          </label>
          <label><span className="label">Mode Import</span><select className="input" value={importMode} onChange={e => setImportMode(e.target.value)}><option value="UPSERT">Insert + Update</option><option value="INSERT_ONLY">Insert Only</option><option value="UPDATE_ONLY">Update Existing</option></select></label>
        </div>
        <div className="flex flex-wrap gap-2"><button className="btn-soft" onClick={downloadTemplate}>Download Template</button><button disabled={importing || !importText} className="btn-soft" onClick={previewImport}>{importing ? 'Memvalidasi...' : 'Preview Validasi'}</button>{importPreview?.summary?.error > 0 && <button className="btn-soft" onClick={downloadErrorReport}>Download Error Report</button>}</div>
        {importPreview && <div className="rounded-2xl border">
          <div className="grid grid-cols-3 gap-2 border-b bg-slate-50 p-3 text-center text-sm"><div><b>{importPreview.summary.totalRows}</b><p className="text-slate-400">Rows</p></div><div><b className="text-emerald-600">{importPreview.summary.success}</b><p className="text-slate-400">Valid</p></div><div><b className="text-red-600">{importPreview.summary.error}</b><p className="text-slate-400">Error</p></div></div>
          <div className="max-h-72 overflow-auto"><table className="w-full min-w-[680px] text-sm"><thead className="bg-white text-slate-500"><tr><th className="p-3 text-left">Row</th><th>SKU</th><th>Product</th><th>Status</th><th>Message</th></tr></thead><tbody>{importPreview.preview.map((r: any) => <tr key={r.row} className="border-t"><td className="p-3">{r.row}</td><td>{r.sku}</td><td>{r.product}</td><td><span className={`pill ${r.status === 'OK' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{r.status}</span></td><td className="text-red-600">{r.message || '-'}</td></tr>)}</tbody></table></div>
        </div>}
        <button disabled={importing || !importPreview || importPreview.summary.success < 1} onClick={commitImport} className="btn-primary w-full">{importing ? 'Importing...' : `Import ${importPreview?.summary?.success || 0} Produk`}</button>
      </div>
    </Modal>}
  </Page>;
}

function RecipeSection({ product, items, units }: { product: any; items: any[]; units: any[] }) {
  const initialRows = (product.recipes || []).filter((x: any) => x.isActive !== false).map((x: any) => ({
    key: x.id,
    inventoryItemId: x.inventoryItemId,
    usageQty: Number(x.usageQty || 0),
    usageUnitId: x.usageUnitId,
    wastePercent: Number(x.wastePercent || 0)
  }));
  const [rows, setRows] = useState<any[]>(initialRows.length ? initialRows : []);
  const add = () => setRows(v => [...v, { key: `new-${Date.now()}`, inventoryItemId: items[0]?.id || '', usageQty: 1, usageUnitId: items[0]?.unitId || units[0]?.id || '', wastePercent: 0 }]);
  const remove = (key: string) => setRows(v => v.filter(x => x.key !== key));
  return <section className="mt-5 rounded-3xl border bg-slate-50 p-4">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><p className="label mb-1">Recipe / Bahan terpakai</p><p className="text-xs text-slate-400">Opsional. Dipakai untuk potong stok bahan saat transaksi paid. HPP laporan tetap dari produk.</p></div>
      <button type="button" onClick={add} className="btn-soft shrink-0"><Plus size={16} /> Tambah Bahan</button>
    </div>
    {!items.length || !units.length ? <div className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-700">Master bahan baku / satuan belum tersedia atau user tidak memiliki akses inventory.</div> : null}
    <div className="mt-4 space-y-3">
      {rows.map((row, idx) => <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5" key={row.key}>
        <div className="mb-2 flex items-center justify-between gap-3"><b className="text-sm">Bahan #{idx + 1}</b><button type="button" onClick={() => remove(row.key)} className="rounded-xl bg-red-50 p-2 text-red-600"><Trash2 size={15} /></button></div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_130px_150px_120px]">
          <label><span className="label">Bahan</span><select className="input" name="recipeInventoryItemId" defaultValue={row.inventoryItemId}>{items.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label>
          <label><span className="label">Qty</span><input className="input" name="recipeUsageQty" type="number" min="0.001" step="0.001" defaultValue={row.usageQty} /></label>
          <label><span className="label">Satuan</span><select className="input" name="recipeUsageUnitId" defaultValue={row.usageUnitId}>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label><span className="label">Waste %</span><input className="input" name="recipeWastePercent" type="number" min="0" max="100" step="0.01" defaultValue={row.wastePercent} /></label>
        </div>
      </div>)}
      {!rows.length && <div className="rounded-2xl border border-dashed p-4 text-center text-sm text-slate-400">Belum ada recipe. Produk tetap bisa dijual tanpa potong stok bahan jika outlet mengizinkan.</div>}
    </div>
  </section>;
}

function ProductCard({ p, setEdit, selected, toggle }: any) {
  return <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-2"><input type="checkbox" checked={selected} onChange={toggle} /><div className="min-w-0"><h3 className="line-clamp-2 font-black text-ink">{p.name}</h3><p className="text-sm text-slate-400">{p.sku || 'Tanpa SKU'} · {p.categoryRef?.name || p.category}</p></div></div><button onClick={() => setEdit(p)} className="shrink-0 rounded-xl bg-brand-50 p-2 text-brand-600"><Edit size={17} /></button></div><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Harga</p><b>{rupiah(p.basePrice)}</b></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">HPP</p><b>{rupiah(p.baseHpp)}</b></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Outlet aktif</p><b>{(p.outlets || []).filter((x: any) => x.isAvailable && x.status === 'ACTIVE').length} outlet</b></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Status</p><span className="pill bg-brand-50 text-brand-700">{p.status}</span></div></div><div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-400">Variant Groups</p><p className="mt-1 line-clamp-2">{p.variantGroups?.map((x: any) => x.group.name).join(', ') || '-'}</p></div></div>;
}
function EmptyProduct() { return <div className="p-8 text-center text-slate-400">Produk tidak ditemukan.</div>; }
