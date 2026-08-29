import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react';
import { api } from '../api';
import { toast } from '../toast';

type Category = {
  id: string;
  name: string;
  description?: string | null;
  sortOrder: number;
  status: string;
};

type CategoryForm = {
  name: string;
  description: string;
  status: string;
};

const emptyForm: CategoryForm = { name: '', description: '', status: 'ACTIVE' };

function ordered(categories: Category[]) {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api<Category[]>('/categories');
      setCategories(ordered(result));
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kategori gagal dimuat.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const startReorder = () => {
    setDraft(ordered(categories).map((category, index) => ({ ...category, sortOrder: (index + 1) * 10 })));
    setReordering(true);
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.length) return;
    const next = [...draft];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDraft(next.map((category, position) => ({ ...category, sortOrder: (position + 1) * 10 })));
  };

  const moveDragged = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const sourceIndex = draft.findIndex((category) => category.id === draggedId);
    const targetIndex = draft.findIndex((category) => category.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...draft];
    const [item] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, item);
    setDraft(next.map((category, position) => ({ ...category, sortOrder: (position + 1) * 10 })));
  };

  const saveOrder = async () => {
    setSaving(true);
    try {
      const result = await api<Category[]>('/categories/reorder', {
        method: 'PUT',
        body: JSON.stringify({ categories: draft.map(({ id, sortOrder }) => ({ id, sortOrder })) }),
      });
      setCategories(ordered(result));
      setReordering(false);
      toast.success('Urutan kategori berhasil disimpan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Urutan kategori gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (category: Category) => {
    setEditing(category);
    setForm({ name: category.name, description: category.description || '', status: category.status });
    setModalOpen(true);
  };

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api<Category>(editing ? `/categories/${editing.id}` : '/categories', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim(), status: form.status }),
      });
      await load();
      setEditing(null);
      setModalOpen(false);
      toast.success('Kategori berhasil disimpan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kategori gagal disimpan.');
    } finally {
      setSaving(false);
    }
  };

  const visibleCategories = useMemo(() => reordering ? draft : categories, [categories, draft, reordering]);

  return (
    <main className="p-4 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Kategori</h1>
          <p className="mt-1 text-slate-500">Atur kategori produk dan urutan tampilnya di POS.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {reordering ? (
            <>
              <button className="btn-soft" type="button" onClick={() => setReordering(false)} disabled={saving}>Batal</button>
              <button className="btn-primary" type="button" onClick={() => void saveOrder()} disabled={saving || !draft.length}>
                {saving ? 'Menyimpan...' : 'Simpan Urutan'}
              </button>
            </>
          ) : (
            <>
              <button className="btn-soft" type="button" onClick={startReorder} disabled={loading || !categories.length}>Atur Urutan</button>
              <button className="btn-primary" type="button" onClick={openCreate}><Plus size={18} /> Tambah Kategori</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</div>}
      <section className="card">
        {loading ? <div className="py-12 text-center text-slate-400">Memuat kategori...</div> : !visibleCategories.length ? (
          <div className="py-12 text-center text-slate-400">Belum ada kategori.</div>
        ) : (
          <div className="space-y-2">
            {visibleCategories.map((category, index) => (
              <div
                key={category.id}
                draggable={reordering}
                onDragStart={() => setDraggedId(category.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveDragged(category.id)}
                onDragEnd={() => setDraggedId(null)}
                className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                {reordering && <GripVertical className="shrink-0 text-slate-400" size={20} />}
                <span className="w-8 shrink-0 text-center text-sm font-semibold text-slate-400">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-800">{category.name}</div>
                  {category.description && <div className="truncate text-sm text-slate-500">{category.description}</div>}
                </div>
                <span className={`pill ${category.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{category.status}</span>
                {reordering ? (
                  <div className="flex shrink-0 gap-1">
                    <button className="btn-icon" type="button" aria-label="Naikkan kategori" onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp size={17} /></button>
                    <button className="btn-icon" type="button" aria-label="Turunkan kategori" onClick={() => move(index, 1)} disabled={index === draft.length - 1}><ArrowDown size={17} /></button>
                  </div>
                ) : <button className="btn-soft shrink-0" type="button" onClick={() => openEdit(category)}>Edit</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      <CategoryModal
        open={modalOpen}
        editing={editing}
        form={form}
        saving={saving}
        onChange={setForm}
        onClose={() => { setEditing(null); setForm(emptyForm); setModalOpen(false); }}
        onSubmit={saveCategory}
      />
    </main>
  );
}

function CategoryModal({ open, editing, form, saving, onChange, onClose, onSubmit }: {
  open: boolean;
  editing: Category | null;
  form: CategoryForm;
  saving: boolean;
  onChange: (value: CategoryForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <form className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onSubmit={onSubmit}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold text-slate-900">{editing ? 'Edit Kategori' : 'Tambah Kategori'}</h2><button type="button" className="btn-icon" onClick={onClose} aria-label="Tutup"><X size={18} /></button></div>
        <label className="label">Nama Kategori<input className="input mt-2 w-full" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} autoFocus required /></label>
        <label className="label mt-4">Deskripsi<textarea className="input mt-2 min-h-24 w-full" value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} /></label>
        <label className="label mt-4">Status<select className="input mt-2 w-full" value={form.status} onChange={(e) => onChange({ ...form, status: e.target.value })}><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select></label>
        <div className="mt-6 flex justify-end gap-2"><button className="btn-soft" type="button" onClick={onClose} disabled={saving}>Batal</button><button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></div>
      </form>
    </div>
  );
}
