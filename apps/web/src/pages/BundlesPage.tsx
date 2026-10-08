import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Camera, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { API, api, handleUnauthorizedSession, rupiah } from '../api';
import { useOutlet, type Outlet } from '../OutletContext';
import { toast } from '../toast';
import { appConfirm } from '../components/ui/AppDialog';
import { bundlePayload, editBundle, newBundle, newBundleChoice, newBundleGroup,
  type BundleCategory, type BundleChoice, type BundleDraft, type BundleGroup, type BundleProduct, type BundleRecord } from '../bundleAdmin';

const imageSrc = (url: string | null) => url?.startsWith('/storage/') ? `${API.replace(/\/api\/?$/, '')}${url}` : url || '';
function Check({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />{label}</label>;
}
function move<T>(items: T[], from: number, direction: number) {
  const to = from + direction;
  if (to < 0 || to >= items.length) return items;
  const next = [...items]; [next[from], next[to]] = [next[to]!, next[from]!]; return next;
}

export default function BundlesPage() {
  const { selectedOutletId } = useOutlet();
  const [rows, setRows] = useState<BundleRecord[]>([]);
  const [products, setProducts] = useState<BundleProduct[]>([]);
  const [categories, setCategories] = useState<BundleCategory[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterOutlet, setFilterOutlet] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [reload, setReload] = useState(0);
  const [edit, setEdit] = useState<BundleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([api<BundleProduct[]>('/products'), api<BundleCategory[]>('/categories'), api<Outlet[]>('/outlets')])
      .then(([products, categories, outlets]) => { if (active) { setProducts(products); setCategories(categories); setOutlets(outlets); setReady(true); } })
      .catch(error => { if (active) setError((error as Error).message); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const params = new URLSearchParams(); if (filterOutlet) params.set('outletId', filterOutlet); if (filterStatus) params.set('status', filterStatus);
    api<BundleRecord[]>(`/bundles${params.size ? `?${params}` : ''}`).then(rows => { if (active) setRows(rows); })
      .catch(error => { if (active) { setRows([]); setError((error as Error).message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filterOutlet, filterStatus, reload]);
  const visible = useMemo(() => rows.filter(row => `${row.name} ${row.category.name}`.toLowerCase().includes(search.toLowerCase().trim())), [rows, search]);
  async function deactivate(row: BundleRecord) {
    if (busy || !await appConfirm(`${row.name} tidak akan tersedia untuk penjualan. Konfigurasi tetap tersimpan.`, { title: 'Nonaktifkan paket?', confirmText: 'Nonaktifkan' })) return;
    setBusy(true);
    try { await api(`/bundles/${encodeURIComponent(row.id)}`, { method: 'DELETE' }); setReload(value => value + 1); toast.success('Paket dinonaktifkan.'); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="p-4 lg:p-8">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-black">Bundle / Combo</h1><p className="text-slate-500">Kelola paket menggunakan produk dan kategori existing.</p></div>
      <button disabled={!ready || loading || busy} className="btn-primary disabled:opacity-50" onClick={() => setEdit(newBundle(filterOutlet || selectedOutletId))}><Plus size={18} /> Tambah Paket</button></div>
    <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Phase 2: pengelolaan paket. Paket belum ditampilkan atau dijual di POS/Web Order sampai integrasi transaksi selesai.</p>
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><label className="relative"><span className="label">Cari paket / kategori</span><Search className="pointer-events-none absolute bottom-4 left-3 text-slate-400" size={18}/><input className="input pl-10" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari paket..." /></label>
      <label><span className="label">Outlet</span><select className="input" value={filterOutlet} onChange={event => setFilterOutlet(event.target.value)}><option value="">Semua outlet</option>{outlets.filter(outlet => outlet.status === 'ACTIVE').map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
      <label><span className="label">Status</span><select className="input" value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="">Semua status</option><option>ACTIVE</option><option>INACTIVE</option></select></label></div>
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-700">{error}<button className="ml-3 underline" onClick={() => setReload(value => value + 1)}>Coba lagi</button></div>}
    {loading ? <p role="status">Memuat paket...</p> : <>
      <p className="mb-3 text-sm text-slate-500">{visible.length} paket{rows.length === 200 ? ' · Maksimal 200 hasil, gunakan filter outlet/status.' : ''}</p>
      {!visible.length && !error && <div className="card p-8 text-center text-slate-500">Belum ada paket yang sesuai.</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map(row => <article className="card p-5" key={row.id}>
        <div className="flex justify-between gap-3"><div><p className="text-xs font-bold uppercase text-brand-700">{row.category.name}</p><h2 className="text-xl font-black">{row.name}</h2></div><span className={`pill self-start ${row.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-slate-100'}`}>{row.status}</span></div>
        <p className="mt-3 text-xl font-black text-brand-700">{rupiah(row.basePrice)}</p><p className="mt-1 text-sm text-slate-500">{row.groups.length} grup · {row.groups.some(group => !group.isFixed) ? 'Pilihan customer' : 'Paket tetap'}</p>
        <p className="mt-3 text-sm">Outlet: {row.outlets.map(assignment => `${outlets.find(outlet => outlet.id === assignment.outletId)?.name || 'Outlet tidak tersedia'}${assignment.isActive ? '' : ' (nonaktif)'}`).join(', ')}</p>
        <p className="mt-1 text-sm">Channel: {[row.availablePOS && 'POS', row.availableWebOrder && 'Web Order'].filter(Boolean).join(', ') || 'Tidak ada'}</p>
        <p className="mt-1 text-xs text-slate-500">Periode: {row.startDate ? new Date(row.startDate).toLocaleString('id-ID') : 'Tanpa batas awal'} — {row.endDate ? new Date(row.endDate).toLocaleString('id-ID') : 'Tanpa batas akhir'}</p>
        <div className="mt-4 flex gap-3"><button className="btn-soft" disabled={!ready || busy} onClick={() => setEdit(editBundle(row))}>Edit</button>{row.status === 'ACTIVE' && <button className="btn-soft text-red-700" disabled={busy} onClick={() => void deactivate(row)}>Nonaktifkan</button>}</div>
      </article>)}</div></>}
    {edit && <BundleEditor initial={edit} products={products} categories={categories} outlets={outlets} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setReload(value => value + 1); }} />}
  </div>;
}

export function BundleEditor({ initial, products, categories, outlets, onClose, onSaved }: { initial: BundleDraft; products: BundleProduct[]; categories: BundleCategory[]; outlets: Outlet[]; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  function change(patch: Partial<BundleDraft>) { setDirty(true); setDraft(value => ({ ...value, ...patch })); }
  const close = useCallback(async () => {
    if (saving || uploading) return;
    if (!dirty || await appConfirm('Perubahan konfigurasi paket belum disimpan.', { title: 'Tutup tanpa menyimpan?', confirmText: 'Tutup' })) onClose();
  }, [saving, uploading, dirty, onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; nameInput.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!panel.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); void close(); }
      if (event.key === 'Tab') {
        const fields = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')).filter(field => field.getClientRects().length);
        const first = fields[0], last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [close]);
  function groupChange(index: number, patch: Partial<BundleGroup>) { change({ groups: draft.groups.map((group, at) => at === index ? { ...group, ...patch } : group) }); }
  function itemChange(groupIndex: number, itemIndex: number, patch: Partial<BundleChoice>) {
    groupChange(groupIndex, { items: draft.groups[groupIndex]!.items.map((item, at) => at === itemIndex ? { ...item, ...patch } : item) });
  }
  async function upload(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Foto harus JPG/PNG/WEBP, maksimal 5 MB.'); return; }
    setUploading(true); setError('');
    try {
      const form = new FormData(); form.append('image', file);
      const response = await fetch(`${API}/products/images`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, body: form });
      const data = await response.json() as { imageUrl?: string; message?: string };
      if (!response.ok) { if (response.status === 401) handleUnauthorizedSession(data.message); throw new Error(data.message || 'Upload foto gagal.'); }
      if (!data.imageUrl) throw new Error('URL foto tidak tersedia.');
      change({ imageUrl: data.imageUrl }); toast.success('Foto paket berhasil diupload.');
    } catch (error) { setError((error as Error).message); } finally { setUploading(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (saving || uploading) return; setError('');
    try {
      const body = bundlePayload(draft);
      for (const group of draft.groups) for (const choice of group.items) {
        const product = products.find(product => product.id === choice.productId);
        if (!product) throw new Error('Ada produk yang sudah dihapus. Pilih ulang isi paket.');
        for (const attached of product.variantGroups.filter(row => row.group.status === 'ACTIVE')) {
          if (!choice.fixedOptionIds.length) continue;
          const count = attached.group.options.filter(option => choice.fixedOptionIds.includes(option.id)).length;
          if (count < (attached.group.required ? Math.max(1, attached.group.minSelect) : attached.group.minSelect) || count > attached.group.maxSelect) throw new Error(`${product.name} / ${attached.group.name}: pilihan tetap tidak memenuhi min/max.`);
        }
      }
      setSaving(true);
      await api(draft.id ? `/bundles/${encodeURIComponent(draft.id)}` : '/bundles', { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      toast.success('Paket berhasil disimpan.'); onSaved();
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  const displayOutlets = [...outlets, ...draft.outlets.filter(row => !outlets.some(outlet => outlet.id === row.outletId)).map(row => ({ id: row.outletId, name: 'Outlet tidak tersedia', status: 'INACTIVE' }))];
  return <div data-back-modal="true" className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-2 sm:p-4"><div ref={panel} role="dialog" aria-modal="true" aria-labelledby="bundle-editor-title" className="max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
    <form onSubmit={save}><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4"><h2 id="bundle-editor-title" className="text-2xl font-black">{draft.id ? 'Edit Paket' : 'Tambah Paket'}</h2><button type="button" data-back-close="true" aria-label="Tutup editor paket" disabled={saving || uploading} onClick={() => void close()}><X /></button></div>
      <fieldset disabled={saving || uploading} className="space-y-6 p-5 disabled:opacity-60">
        <section><h3 className="mb-3 text-lg font-black">Informasi paket</h3><div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">Nama paket *</span><input ref={nameInput} className="input" value={draft.name} maxLength={160} required onChange={event => change({ name: event.target.value })} /></label>
          <label><span className="label">Kategori *</span><select className="input" required value={draft.categoryId} onChange={event => change({ categoryId: event.target.value })}><option value="">Pilih kategori</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}{category.status !== 'ACTIVE' ? ' (nonaktif)' : ''}</option>)}</select></label>
          <label><span className="label">Harga dasar *</span><input className="input" type="number" min="0" max="999999999999.99" step="0.01" required value={draft.basePrice} onChange={event => change({ basePrice: event.target.value })} /></label>
          <label><span className="label">Status</span><select className="input" value={draft.status} onChange={event => change({ status: event.target.value as BundleDraft['status'] })}><option>INACTIVE</option><option>ACTIVE</option></select></label>
          <label className="sm:col-span-2"><span className="label">Deskripsi</span><textarea className="input" maxLength={3000} value={draft.description || ''} onChange={event => change({ description: event.target.value })} /></label>
          <label><span className="label">Urutan paket</span><input className="input" type="number" min="0" max="100000" required value={draft.sortOrder} onChange={event => change({ sortOrder: Number(event.target.value) })} /></label>
        </div><p className="mt-2 text-sm text-slate-500">HPP dihitung dari isi yang dipilih; bukan diisi manual. Kategori mengikuti master existing.</p></section>
        <section className="rounded-2xl bg-slate-50 p-4"><h3 className="mb-3 font-black">Foto paket</h3><div className="flex flex-wrap items-center gap-3">
          {draft.imageUrl && <img src={imageSrc(draft.imageUrl)} alt="Foto paket" className="h-24 w-24 rounded-xl object-cover" />}
          <label className="btn-soft cursor-pointer"><Upload size={16}/>Upload Foto<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
          <label className="btn-soft cursor-pointer"><Camera size={16}/>Kamera<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
          {draft.imageUrl && <button type="button" className="btn-soft text-red-700" onClick={() => change({ imageUrl: null })}>Hapus foto</button>}</div><p className="mt-2 text-xs text-slate-500">JPG/PNG/WEBP maksimal 5 MB; dikompres menjadi WEBP oleh server.</p></section>
        <section><h3 className="mb-3 text-lg font-black">Channel dan periode</h3><div className="mb-3 flex flex-wrap gap-5"><Check label="POS Kasir" checked={draft.availablePOS} onChange={availablePOS => change({ availablePOS })}/><Check label="Web Order" checked={draft.availableWebOrder} onChange={availableWebOrder => change({ availableWebOrder })}/></div>
          <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">Mulai (opsional)</span><input className="input" type="datetime-local" step="0.001" value={draft.startDate || ''} onChange={event => change({ startDate: event.target.value })}/></label><label><span className="label">Berakhir (opsional)</span><input className="input" type="datetime-local" step="0.001" value={draft.endDate || ''} onChange={event => change({ endDate: event.target.value })}/></label></div><p className="mt-2 text-xs text-slate-500">Waktu menggunakan zona perangkat. Daily Pre-Order diintegrasikan pada fase berikutnya.</p></section>
        <section><h3 className="mb-3 text-lg font-black">Outlet dan harga</h3><p className="mb-3 text-sm text-slate-500">Harga outlet kosong memakai harga dasar. Harga online kosong memakai harga outlet/dasar.</p>
          <div className="space-y-3">{displayOutlets.map(outlet => {
            const assignment = draft.outlets.find(row => row.outletId === outlet.id);
            return <div key={outlet.id} className="rounded-2xl border p-4"><Check label={`${outlet.name}${outlet.status !== 'ACTIVE' ? ' (nonaktif/tidak diizinkan — lepaskan sebelum simpan)' : ''}`} checked={!!assignment} disabled={!assignment && outlet.status !== 'ACTIVE'} onChange={selected => change({ outlets: selected ? [...draft.outlets, { outletId: outlet.id, isActive: true, price: null, gofoodPrice: null, grabfoodPrice: null, shopeefoodPrice: null }] : draft.outlets.filter(row => row.outletId !== outlet.id) })}/>
              {assignment && <><div className="my-3"><Check label="Paket aktif di outlet ini" checked={assignment.isActive} onChange={isActive => change({ outlets: draft.outlets.map(row => row.outletId === outlet.id ? { ...row, isActive } : row) })}/></div><div className="grid gap-3 sm:grid-cols-4">{(['price', 'gofoodPrice', 'grabfoodPrice', 'shopeefoodPrice'] as const).map((field, index) => <label key={field}><span className="label">{['Dine In / Take Away', 'GoFood', 'GrabFood', 'ShopeeFood'][index]}</span><input className="input" type="number" min="0" max="999999999999.99" step="0.01" value={assignment[field] ?? ''} placeholder="Fallback" onChange={event => change({ outlets: draft.outlets.map(row => row.outletId === outlet.id ? { ...row, [field]: event.target.value } : row) })}/></label>)}</div></>}
            </div>;
          })}</div></section>
        <section><div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-black">Isi paket</h3><button type="button" className="btn-soft" disabled={draft.groups.length >= 20} onClick={() => change({ groups: [...draft.groups, newBundleGroup()] })}><Plus size={16}/>Tambah Grup</button></div>
          <div className="space-y-4">{draft.groups.map((group, groupIndex) => <GroupEditor key={groupIndex} group={group} index={groupIndex} total={draft.groups.length} products={products} onChange={patch => groupChange(groupIndex, patch)} onItemChange={(index, patch) => itemChange(groupIndex, index, patch)} onMove={direction => change({ groups: move(draft.groups, groupIndex, direction) })} onRemove={() => change({ groups: draft.groups.filter((_, index) => index !== groupIndex) })}/>)}</div>
        </section>
      </fieldset>
      <div className="sticky bottom-0 border-t bg-white px-5 py-4">{error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}<div className="flex justify-end gap-3"><button type="button" className="btn-soft" disabled={saving || uploading} onClick={() => void close()}>Batal</button><button className="btn-primary" disabled={saving || uploading}>{uploading ? 'Mengupload foto...' : saving ? 'Menyimpan...' : 'Simpan Paket'}</button></div></div>
    </form></div></div>;
}

function GroupEditor({ group, index, total, products, onChange, onItemChange, onMove, onRemove }: { group: BundleGroup; index: number; total: number; products: BundleProduct[];
  onChange: (patch: Partial<BundleGroup>) => void; onItemChange: (index: number, patch: Partial<BundleChoice>) => void; onMove: (direction: number) => void; onRemove: () => void }) {
  const [search, setSearch] = useState('');
  const candidates = products.filter(product => `${product.name} ${product.sku || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="rounded-2xl border bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between"><h4 className="font-black">Grup {index + 1}</h4><div className="flex gap-2"><button type="button" aria-label="Naikkan grup" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={18}/></button><button type="button" aria-label="Turunkan grup" disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown size={18}/></button><button type="button" aria-label="Hapus grup" className="text-red-700" onClick={onRemove}><Trash2 size={18}/></button></div></div>
    <label><span className="label">Nama grup *</span><input className="input" required maxLength={120} value={group.name} placeholder="Pilih makanan" onChange={event => onChange({ name: event.target.value })}/></label>
    <div className="my-3 flex flex-wrap gap-4"><Check label="Semua item otomatis (paket tetap)" checked={group.isFixed} onChange={isFixed => onChange({ isFixed })}/>{!group.isFixed && <Check label="Wajib pilih" checked={group.required} onChange={required => onChange({ required })}/>}</div>
    {!group.isFixed && <div className="mb-3 grid grid-cols-2 gap-3">{(['minSelect', 'maxSelect'] as const).map(field => <label key={field}><span className="label">{field === 'minSelect' ? 'Minimal pilihan' : 'Maksimal pilihan'}</span><input className="input" type="number" min={field === 'minSelect' ? 0 : 1} max="50" required value={group[field]} onChange={event => onChange({ [field]: Number(event.target.value) })}/></label>)}</div>}
    <label className="mb-3 block"><span className="label">Cari produk untuk pilihan grup</span><input className="input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nama / SKU..."/></label>
    <div className="space-y-3">{group.items.map((choice, itemIndex) => {
      const product = products.find(product => product.id === choice.productId);
      const options = candidates.some(product => product.id === choice.productId) || !product ? candidates : [product, ...candidates];
      const modern = product?.variantGroups.filter(row => row.group.status === 'ACTIVE') || [];
      return <div className="rounded-xl border bg-white p-3" key={itemIndex}><div className="mb-3 flex justify-between gap-2"><span className="text-sm font-bold">Item {itemIndex + 1}</span><div className="flex gap-2"><button type="button" aria-label="Naikkan item" disabled={itemIndex === 0} onClick={() => onChange({ items: move(group.items, itemIndex, -1) })}><ArrowUp size={16}/></button><button type="button" aria-label="Turunkan item" disabled={itemIndex === group.items.length - 1} onClick={() => onChange({ items: move(group.items, itemIndex, 1) })}><ArrowDown size={16}/></button><button type="button" aria-label="Hapus item" className="text-red-700" onClick={() => onChange({ items: group.items.filter((_, index) => index !== itemIndex) })}><Trash2 size={16}/></button></div></div>
        <label><span className="label">Produk *</span><select className="input" value={choice.productId} required onChange={event => onItemChange(itemIndex, { productId: event.target.value, variantId: null, fixedOptionIds: [] })}><option value="">Pilih produk</option>{choice.productId && !product && <option value={choice.productId}>Produk sudah dihapus — pilih ulang</option>}{options.map(product => <option key={product.id} value={product.id} disabled={product.status !== 'ACTIVE' && product.id !== choice.productId}>{product.name}{product.sku ? ` (${product.sku})` : ''}{product.status !== 'ACTIVE' ? ' · nonaktif' : ''}</option>)}</select></label>
        {!modern.length && !!product?.variants.length && <label className="mt-3 block"><span className="label">Variant</span><select className="input" value={choice.variantId || ''} onChange={event => onItemChange(itemIndex, { variantId: event.target.value || null })}><option value="">Customer memilih variant</option>{product.variants.map(variant => <option key={variant.id} value={variant.id} disabled={variant.status !== 'ACTIVE' && variant.id !== choice.variantId}>{variant.variantName}{variant.status !== 'ACTIVE' ? ' (nonaktif)' : ''}</option>)}</select></label>}
        {!!modern.length && <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="mb-2 text-xs text-slate-500">Kosongkan semua opsi agar customer memilih. Centang untuk menetapkan opsi paket (wajib memenuhi min/max semua grup).</p>{modern.map(({ group: variantGroup }) => <div className="mb-2" key={variantGroup.id}><p className="mb-1 text-sm font-bold">{variantGroup.name} ({variantGroup.required ? Math.max(1, variantGroup.minSelect) : variantGroup.minSelect}–{variantGroup.maxSelect})</p><div className="flex flex-wrap gap-3">{variantGroup.options.map(option => <Check key={option.id} label={`${option.name}${option.status !== 'ACTIVE' ? ' (nonaktif)' : ''}`} checked={choice.fixedOptionIds.includes(option.id)} disabled={option.status !== 'ACTIVE' && !choice.fixedOptionIds.includes(option.id)} onChange={selected => onItemChange(itemIndex, { fixedOptionIds: selected ? [...choice.fixedOptionIds, option.id] : choice.fixedOptionIds.filter(id => id !== option.id) })}/>)}</div></div>)}</div>}
        <div className="my-3 grid grid-cols-2 gap-3"><label><span className="label">Unit produk per paket</span><input className="input" type="number" min="1" max="50" required value={choice.qty} onChange={event => onItemChange(itemIndex, { qty: Number(event.target.value) })}/></label><label><span className="label">Tambahan harga / unit</span><input className="input" type="number" min="0" max="999999999999.99" step="0.01" required value={choice.additionalPrice} onChange={event => onItemChange(itemIndex, { additionalPrice: event.target.value })}/></label></div>
        <div className="flex flex-wrap gap-4"><Check label="Item aktif" checked={choice.isActive} onChange={isActive => onItemChange(itemIndex, { isActive })}/>{!group.isFixed && <Check label="Pilihan default" checked={choice.isDefault} onChange={isDefault => onItemChange(itemIndex, { isDefault })}/>}</div>
        {!!choice.fixedOptionIds.length && <button type="button" className="mt-2 text-sm font-bold text-brand-700" onClick={() => onItemChange(itemIndex, { fixedOptionIds: [] })}>Reset opsi tetap — customer memilih</button>}
      </div>;
    })}</div><button type="button" className="btn-soft mt-3" disabled={group.items.length >= 50} onClick={() => onChange({ items: [...group.items, newBundleChoice()] })}><Plus size={16}/>Tambah Produk</button>
  </div>;
}
