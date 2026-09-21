import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, BookOpen, ChefHat, Clock3, Copy, Plus, Search, Trash2, X } from 'lucide-react';
import { API, api, type User } from '../api';
import { useOutlet } from '../OutletContext';
import { toast } from '../toast';
import { appConfirm } from '../components/ui/AppDialog';
import foruLogo from '/images/foru.png';

type SopStatus = 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
type SopStep = { id: string; instruction: string; durationMinutes?: number | null };
type ProductSop = {
  id: string;
  title: string;
  equipment?: string | null;
  steps: SopStep[];
  servingNotes?: string | null;
  status: SopStatus;
  version: number;
  updatedAt: string;
};
type SopProduct = {
  id: string;
  sku?: string | null;
  name: string;
  imageUrl?: string | null;
  status: string;
  category?: { id: string; name: string; sortOrder: number } | null;
  categoryName: string;
  recipe: Array<{ id: string; sourceType?: 'INVENTORY' | 'PRODUCT'; ingredientCode?: string | null; ingredientName: string; qty: number; unit: string; wastePercent: number }>;
  sop?: ProductSop | null;
};
type SopForm = { title: string; equipment: string; steps: SopStep[]; servingNotes: string; status: SopStatus };

const API_ORIGIN = API.replace(/\/api\/?$/, '');
const imageSrc = (url?: string | null) => !url ? foruLogo : url.startsWith('/storage/') ? `${API_ORIGIN}${url}` : url;
const stepId = () => globalThis.crypto?.randomUUID?.() || `step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyStep = (): SopStep => ({ id: stepId(), instruction: '', durationMinutes: null });
const formFor = (product: SopProduct): SopForm => ({
  title: product.sop?.title || `SOP ${product.name}`,
  equipment: product.sop?.equipment || '',
  steps: product.sop?.steps?.length ? product.sop.steps.map(step => ({ ...step })) : [emptyStep()],
  servingNotes: product.sop?.servingNotes || '',
  status: product.sop?.status || 'DRAFT',
});

export default function ProductSopPage({ user }: { user: User }) {
  const { selectedOutletId } = useOutlet();
  const [products, setProducts] = useState<SopProduct[]>([]);
  const [canManage, setCanManage] = useState(user.role === 'OWNER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Semua');
  const [selected, setSelected] = useState<SopProduct | null>(null);
  const [editing, setEditing] = useState<SopProduct | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const query = selectedOutletId ? `?outletId=${encodeURIComponent(selectedOutletId)}` : '';
      const result = await api<{ canManage: boolean; products: SopProduct[] }>(`/product-sops${query}`);
      setProducts(result.products);
      setCanManage(result.canManage);
      setError('');
      setSelected(current => current ? result.products.find(product => product.id === current.id) || null : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SOP produk gagal dimuat.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [selectedOutletId]);

  const categories = useMemo(() => ['Semua', ...new Set(products.map(product => product.categoryName))], [products]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('id-ID');
    return products.filter(product => (category === 'Semua' || product.categoryName === category) && (!query || `${product.name} ${product.sku || ''} ${product.categoryName}`.toLocaleLowerCase('id-ID').includes(query)));
  }, [products, category, search]);

  return <main className="p-4 lg:p-8">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-3xl font-black text-ink">SOP Produk</h1><p className="mt-1 text-slate-500">Panduan pembuatan produk untuk kasir dan crew.</p></div>
      {canManage && <span className="rounded-full bg-brand-50 px-4 py-2 text-xs font-black text-brand-700">OWNER · KELOLA SOP</span>}
    </div>

    <section className="sticky top-16 z-20 mb-5 rounded-3xl bg-white/95 p-3 shadow-sm ring-1 ring-black/5 backdrop-blur">
      <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19}/><input className="input h-12 rounded-2xl pl-11" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari nama produk, SKU, atau kategori..."/></div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{categories.map(item => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${category === item ? 'bg-ink text-white' : 'bg-slate-50 text-slate-600'}`}>{item}</button>)}</div>
    </section>

    {error && <div className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {loading ? <div className="py-16 text-center text-slate-400">Memuat SOP produk...</div> : !visible.length ? <div className="rounded-3xl bg-white py-16 text-center text-slate-400 shadow-sm">{canManage ? 'Produk tidak ditemukan.' : 'Belum ada SOP Published untuk outlet ini.'}</div> :
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{visible.map(product => <article key={product.id} className="flex min-w-0 flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
        <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => product.sop ? setSelected(product) : canManage ? setEditing(product) : undefined}>
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-brand-50 to-amber-50"><img src={imageSrc(product.imageUrl)} alt="" className="h-full w-full object-cover" onError={event => { event.currentTarget.src = foruLogo; event.currentTarget.className = 'h-full w-full object-contain p-6 opacity-60'; }}/><SopBadge sop={product.sop}/></div>
          <div className="flex min-w-0 flex-1 flex-col p-3"><p className="truncate text-[11px] font-bold text-slate-400">{product.categoryName}</p><h2 className="mt-1 line-clamp-2 text-sm font-black leading-tight text-ink">{product.name}</h2><div className="mt-auto pt-3 text-xs font-bold text-brand-700">{product.sop ? 'Lihat SOP →' : 'Buat SOP →'}</div></div>
        </button>
        {canManage && product.sop && <button className="mx-3 mb-3 rounded-xl border border-brand-100 px-3 py-2 text-xs font-black text-brand-700" onClick={() => setEditing(product)}>Edit SOP</button>}
      </article>)}</div>}

    {selected && (
      <SopDetail
        product={selected}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onEdit={() => { setEditing(selected); setSelected(null); }}
      />
    )}
    {editing && (
      <SopEditor
        product={editing}
        products={products}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load(); }}
      />
    )}
  </main>;
}

function SopBadge({ sop }: { sop?: ProductSop | null }) {
  const style = !sop ? 'bg-slate-800 text-white' : sop.status === 'PUBLISHED' ? 'bg-green-600 text-white' : sop.status === 'DRAFT' ? 'bg-amber-500 text-white' : 'bg-slate-500 text-white';
  return <span className={`absolute right-2 top-2 rounded-full px-2.5 py-1 text-[10px] font-black ${style}`}>{sop?.status || 'BELUM ADA'}</span>;
}

function SopDetail({ product, canManage, onClose, onEdit }: { product: SopProduct; canManage: boolean; onClose: () => void; onEdit: () => void }) {
  const sop = product.sop!;
  return <div data-back-modal="true" className="fixed inset-0 z-[60] overflow-y-auto bg-[#f7f4ec] md:grid md:place-items-center md:bg-slate-900/50 md:p-4" role="dialog" aria-modal="true">
    <div className="min-h-[100dvh] w-full bg-white md:min-h-0 md:max-h-[92vh] md:max-w-4xl md:overflow-y-auto md:rounded-3xl md:shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-white/95 p-4 backdrop-blur md:p-6"><div><p className="text-xs font-black uppercase tracking-wide text-brand-700">{product.categoryName}</p><h2 className="text-2xl font-black text-ink">{sop.title}</h2><p className="text-sm text-slate-400">{product.name} · Versi {sop.version}</p></div><button data-back-close="true" className="btn-icon" onClick={onClose} aria-label="Tutup"><X/></button></header>
      <div className="space-y-5 p-4 pb-28 md:p-6 md:pb-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="space-y-5">
            <img src={imageSrc(product.imageUrl)} alt={product.name} className="aspect-[4/3] w-full rounded-3xl bg-brand-50 object-cover" onError={event => { event.currentTarget.src = foruLogo; event.currentTarget.className = 'aspect-[4/3] w-full rounded-3xl bg-brand-50 object-contain p-12'; }}/>
            {!!product.recipe.length && <section className="rounded-3xl bg-slate-50 p-4"><h3 className="mb-3 flex items-center gap-2 font-black"><ChefHat size={19}/> Komponen resep</h3><div className="space-y-2">{product.recipe.map(item => <div key={item.id} className="flex items-start justify-between gap-3 border-t border-slate-200 pt-2 text-sm"><span>{item.ingredientName}{item.ingredientCode ? <small className="ml-1 text-slate-400">({item.ingredientCode})</small> : null}{item.sourceType === 'PRODUCT' ? <small className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 font-bold text-brand-700">Sub-resep</small> : null}</span><b className="shrink-0">{item.qty} {item.unit}{item.wastePercent ? ` + ${item.wastePercent}%` : ''}</b></div>)}</div></section>}
            {sop.equipment && <section className="rounded-3xl border p-4"><h3 className="mb-2 font-black">Persiapan & peralatan</h3><p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{sop.equipment}</p></section>}
          </div>
          <section><h3 className="mb-4 flex items-center gap-2 text-xl font-black"><BookOpen size={21}/> Cara pembuatan</h3><ol className="space-y-3">{sop.steps.map((step, index) => <li key={step.id || index} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-2xl border p-4"><span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 font-black text-white">{index + 1}</span><div><p className="whitespace-pre-line leading-relaxed text-slate-700">{step.instruction}</p>{step.durationMinutes ? <p className="mt-2 flex items-center gap-1 text-xs font-bold text-slate-400"><Clock3 size={14}/>{step.durationMinutes} menit</p> : null}</div></li>)}</ol>{sop.servingNotes && <div className="mt-5 rounded-3xl bg-amber-50 p-4 text-amber-900"><b className="block">Catatan penyajian</b><p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{sop.servingNotes}</p></div>}</section>
        </div>
      </div>
      {canManage && <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3 md:sticky"><button className="btn-primary mx-auto w-full max-w-4xl" onClick={onEdit}>Edit SOP</button></div>}
    </div>
  </div>;
}

function SopEditor({ product, products, onClose, onSaved }: { product: SopProduct; products: SopProduct[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [form, setForm] = useState<SopForm>(() => formFor(product));
  const [saving, setSaving] = useState(false);
  const copySources = products.filter(candidate => candidate.id !== product.id && candidate.sop);
  const [copySourceId, setCopySourceId] = useState(copySources[0]?.id || '');
  const updateStep = (index: number, patch: Partial<SopStep>) => setForm(current => ({ ...current, steps: current.steps.map((step, position) => position === index ? { ...step, ...patch } : step) }));
  const moveStep = (index: number, direction: -1 | 1) => setForm(current => { const target = index + direction; if (target < 0 || target >= current.steps.length) return current; const steps = [...current.steps]; [steps[index], steps[target]] = [steps[target], steps[index]]; return { ...current, steps }; });
  const removeStep = (index: number) => setForm(current => ({ ...current, steps: current.steps.filter((_, position) => position !== index) }));
  const copyFromProduct = async () => {
    const source = copySources.find(candidate => candidate.id === copySourceId);
    if (!source?.sop) return toast.error('Pilih produk sumber yang sudah memiliki SOP.');
    if (!await appConfirm(`Salin cara pembuatan dari ${source.name}? Langkah, peralatan, dan catatan saat ini akan diganti.`, { title: 'Salin SOP Produk', confirmText: 'Salin SOP' })) return;
    setForm(current => ({
      ...current,
      equipment: source.sop?.equipment || '',
      steps: source.sop?.steps?.length ? source.sop.steps.map(step => ({ ...step, id: stepId() })) : [emptyStep()],
      servingNotes: source.sop?.servingNotes || '',
    }));
    toast.success(`Cara pembuatan disalin dari ${source.name}.`);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const steps = form.steps.map(step => ({ ...step, instruction: step.instruction.trim(), durationMinutes: step.durationMinutes || null })).filter(step => step.instruction);
    if (form.status === 'PUBLISHED' && !steps.length) return toast.error('SOP Published wajib memiliki minimal satu langkah.');
    setSaving(true);
    try {
      await api(`/product-sops/${product.id}`, { method: 'PUT', body: JSON.stringify({ ...form, title: form.title.trim(), equipment: form.equipment.trim() || null, servingNotes: form.servingNotes.trim() || null, steps }) });
      toast.success('SOP produk berhasil disimpan.');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SOP gagal disimpan.');
    } finally { setSaving(false); }
  };
  return <div data-back-modal="true" className="fixed inset-0 z-[70] overflow-y-auto bg-[#f7f4ec] md:bg-slate-900/50 md:p-4" role="dialog" aria-modal="true">
    <form onSubmit={submit} className="mx-auto min-h-[100dvh] w-full max-w-4xl bg-white md:min-h-0 md:rounded-3xl md:shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-white/95 p-4 backdrop-blur md:rounded-t-3xl md:p-6"><div><p className="text-xs font-black uppercase text-brand-700">Kelola SOP Produk</p><h2 className="text-xl font-black">{product.name}</h2></div><button data-back-close="true" type="button" className="btn-icon" onClick={onClose} aria-label="Tutup"><X/></button></header>
      <div className="space-y-5 p-4 pb-28 md:p-6 md:pb-6">
        <section className="rounded-3xl border border-brand-100 bg-brand-50/60 p-4">
          <div className="mb-3 flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-brand-700"><Copy size={19}/></span><div><h3 className="font-black text-ink">Salin cara pembuatan</h3><p className="text-xs leading-relaxed text-slate-500">Salin langkah, peralatan, dan catatan dari produk lain. Judul, status, serta bahan resep produk ini tidak berubah.</p></div></div>
          {copySources.length ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><select className="input" value={copySourceId} onChange={event => setCopySourceId(event.target.value)}><option value="">Pilih produk sumber</option>{copySources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.sop?.title}</option>)}</select><button type="button" className="btn-soft justify-center" onClick={() => void copyFromProduct()} disabled={!copySourceId}><Copy size={17}/> Salin</button></div> : <div className="rounded-2xl bg-white p-3 text-sm text-slate-500">Belum ada SOP produk lain yang dapat disalin.</div>}
        </section>
        <label className="label">Judul SOP<input className="input mt-2" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} maxLength={200} required/></label>
        <label className="label">Persiapan & peralatan<textarea className="input mt-2 min-h-24" value={form.equipment} onChange={event => setForm({ ...form, equipment: event.target.value })} placeholder="Contoh: gelas 14 oz, sendok aduk, shaker..." maxLength={5000}/></label>
        <section><div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-black">Langkah pembuatan</h3><p className="text-xs text-slate-400">Urutkan langkah sesuai proses operasional.</p></div><button type="button" className="btn-soft" onClick={() => setForm(current => ({ ...current, steps: [...current.steps, emptyStep()] }))}><Plus size={17}/> Tambah</button></div>
          <div className="space-y-3">{form.steps.map((step, index) => <div key={step.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-2xl border p-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 font-black text-white">{index + 1}</span><div className="min-w-0"><textarea className="input min-h-20" value={step.instruction} onChange={event => updateStep(index, { instruction: event.target.value })} placeholder={`Langkah ${index + 1}`} maxLength={1000}/><div className="mt-2 flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs font-bold text-slate-500"><Clock3 size={15}/><input className="w-20 rounded-xl border px-2 py-1.5" type="number" min="0" max="1440" value={step.durationMinutes ?? ''} onChange={event => updateStep(index, { durationMinutes: event.target.value ? Number(event.target.value) : null })}/> menit</label><button type="button" className="btn-icon" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="Naikkan langkah"><ArrowUp size={16}/></button><button type="button" className="btn-icon" onClick={() => moveStep(index, 1)} disabled={index === form.steps.length - 1} aria-label="Turunkan langkah"><ArrowDown size={16}/></button><button type="button" className="btn-icon text-red-600" onClick={() => removeStep(index)} aria-label="Hapus langkah"><Trash2 size={16}/></button></div></div></div>)}</div>
        </section>
        <label className="label">Catatan penyajian<textarea className="input mt-2 min-h-24" value={form.servingNotes} onChange={event => setForm({ ...form, servingNotes: event.target.value })} placeholder="Contoh: sajikan segera, posisi logo menghadap customer..." maxLength={5000}/></label>
        <label className="label">Status<select className="input mt-2" value={form.status} onChange={event => setForm({ ...form, status: event.target.value as SopStatus })}><option value="DRAFT">DRAFT — hanya Owner</option><option value="PUBLISHED">PUBLISHED — terlihat kasir/crew</option><option value="INACTIVE">INACTIVE — disembunyikan</option></select></label>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-white p-3 md:sticky md:rounded-b-3xl"><div className="mx-auto grid max-w-4xl grid-cols-2 gap-3"><button type="button" className="btn-soft" onClick={onClose} disabled={saving}>Batal</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan SOP'}</button></div></div>
    </form>
  </div>;
}
