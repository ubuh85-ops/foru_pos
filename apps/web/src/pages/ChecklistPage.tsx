import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { api } from '../api';
import { useOutlet } from '../OutletContext';

const sections = ['OPENING', 'OPERATIONAL', 'CLOSING'] as const;
type Section = typeof sections[number];
const labels: Record<Section, string> = { OPENING: 'Opening', OPERATIONAL: 'Operasional', CLOSING: 'Closing' };
type Item = { id: string; title: string; section: Section; sortOrder: number; status: 'PENDING' | 'DONE'; completedAt: string | null; completer: { name: string } | null };
type Daily = { reviewRequired: boolean; id: string; date: string; items: Item[]; updatedAt: string; reviewStatus: string; reviewer: { name: string } | null; reviewedAt: string | null; reviewNote: string | null; pendingAtReview: number | null; progress: { section: Section; done: number; total: number; percent: number }[] };
type Summary = { canReview: boolean; canConfigure: boolean; rows: { outletId: string; name: string; date: string; reviewRequired: boolean; daily: Daily | null }[] };
type Template = { id: string; title: string; section: Section; sortOrder: number; active: boolean };
const orderedTemplates = (rows: Template[]) => sections.flatMap(section => rows.filter(row => row.section === section).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)));
function moveTemplate(rows: Template[], id: string, targetSection: Section, targetIndex: number) {
  const ordered = orderedTemplates(rows), dragged = ordered.find(row => row.id === id);
  if (!dragged) return ordered;
  const sourceIndex = ordered.filter(row => row.section === dragged.section).findIndex(row => row.id === id);
  let insertionIndex = targetIndex;
  if (dragged.section === targetSection && sourceIndex < insertionIndex) insertionIndex -= 1;
  const groups = Object.fromEntries(sections.map(section => [section, ordered.filter(row => row.id !== id && row.section === section)])) as Record<Section, Template[]>;
  insertionIndex = Math.max(0, Math.min(insertionIndex, groups[targetSection].length));
  groups[targetSection].splice(insertionIndex, 0, { ...dragged, section: targetSection });
  return sections.flatMap(section => groups[section].map((row, sortOrder) => ({ ...row, section, sortOrder })));
}
const stamp = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Permintaan gagal';
function Progress({ daily }: { daily: Daily }) {
  return <div className="grid grid-cols-3 gap-3">{daily.progress.map(p => <div key={p.section}><p className="text-sm font-semibold">{labels[p.section]}</p><p className="my-1 text-sm">{p.done} / {p.total} · {p.percent}%</p><progress aria-label={labels[p.section]} className="h-2 w-full accent-emerald-600" max={100} value={p.percent} /></div>)}</div>;
}
function ReviewStatus({ daily }: { daily: Daily }) {
  if (!daily.reviewRequired) return <p className="mt-3 text-sm text-slate-500">Review tidak diwajibkan</p>;
  return <div className="mt-3 text-sm"><p className={daily.reviewStatus === 'REVIEWED' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>{daily.reviewStatus === 'REVIEWED' ? '✓ Leader Review selesai' : 'Belum Review'}</p>{daily.reviewedAt && <p>{daily.reviewer?.name} · {stamp(daily.reviewedAt)}</p>}{daily.reviewNote && <p className="mt-1 whitespace-pre-wrap">{daily.reviewNote}</p>}{daily.pendingAtReview != null && daily.pendingAtReview > 0 && <p className="text-amber-700">{daily.pendingAtReview} pekerjaan belum selesai saat review.</p>}</div>;
}
function DailyDetail({ outletId, date, canReview }: { outletId: string; date: string; canReview: boolean }) {
  const [daily, setDaily] = useState<Daily | null>(null), [current, setCurrent] = useState(''), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState('');
  const [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false), [warning, setWarning] = useState(false);
  const refresh = useCallback(async () => {
    const data = await api<{ daily: Daily | null; today: string }>(`/checklists/${outletId}/daily${date ? `?date=${date}` : ''}`);
    setDaily(data.daily); setCurrent(data.today);
  }, [outletId, date]);
  useEffect(() => { let active = true; api<{ daily: Daily | null; today: string }>(`/checklists/${outletId}/daily${date ? `?date=${date}` : ''}`).then(data => { if (active) { setDaily(data.daily); setCurrent(data.today); } }).catch(e => { if (active) setError(errorText(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [outletId, date]);
  async function tick(item: Item) {
    if (!daily) return;
    setBusy(true); setError(''); setSaved('');
    try { setDaily(await api<Daily>(`/checklists/${outletId}/daily/${daily.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'DONE' ? 'PENDING' : 'DONE' }) })); setSaved('Tersimpan otomatis'); setConfirmed(false); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function review(acceptIncomplete: boolean) {
    if (!daily) return;
    setBusy(true); setError('');
    try { setDaily(await api<Daily>(`/checklists/${outletId}/daily/${daily.id}/review`, { method: 'POST', body: JSON.stringify({ confirmed, note, acceptIncomplete }) })); setWarning(false); setConfirmed(false); setSaved('Review tersimpan'); }
    catch (e) { setError(errorText(e)); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">Memuat checklist…</p>;
  const pending = daily?.items.filter(item => item.status === 'PENDING').length || 0;
  return <div className="space-y-4">{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}<div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{daily?.date || date || current}</h2><button className="btn-soft" disabled={busy} onClick={() => refresh().catch(e => setError(errorText(e)))}>Muat ulang</button></div>{!daily ? <p>Belum ada checklist untuk tanggal ini.</p> : <><Progress daily={daily} /><p role="status" className="text-sm text-emerald-700">{busy ? 'Menyimpan…' : saved}</p>{daily.date !== current && <p className="text-sm text-slate-500">History hanya dapat dilihat.</p>}{sections.map(section => <details key={section} open className="card p-4"><summary className="cursor-pointer text-lg font-bold">{labels[section]} · {daily.progress.find(p => p.section === section)?.percent}%</summary><div className="mt-3 space-y-2">{daily.items.filter(item => item.section === section).map(item => <label key={item.id} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 ${item.status === 'PENDING' ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}><input type="checkbox" className="mt-1 h-7 w-7 shrink-0 accent-emerald-600" checked={item.status === 'DONE'} disabled={busy || daily.date !== current} onChange={() => void tick(item)} /><span><span className="font-medium">{item.title}</span><span className={`mt-1 block text-xs ${item.status === 'PENDING' ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>{item.completedAt ? `${item.completer?.name || 'User'} · ${stamp(item.completedAt)}` : 'BELUM DIKERJAKAN'}</span></span></label>)}{!daily.items.some(item => item.section === section) && <p className="text-sm text-slate-500">Tidak ada item aktif.</p>}</div></details>)}<section className="card p-4"><h2 className="text-lg font-bold">Daily Review</h2><ReviewStatus daily={daily} />{canReview && daily.reviewRequired && daily.date === current && daily.reviewStatus !== 'REVIEWED' && <div className="mt-4 space-y-3"><label className="block">Catatan Leader<textarea className="input mt-1" rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label><label className="flex items-center gap-3"><input type="checkbox" className="h-6 w-6" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Saya sudah memeriksa checklist outlet hari ini.</label><button className="btn-primary" disabled={!confirmed || busy} onClick={() => pending ? setWarning(true) : void review(false)}>Selesai Review</button>{warning && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold">Checklist Belum Lengkap</h3><p>{pending} pekerjaan belum selesai. Tetap selesaikan review?</p><div className="mt-3 flex gap-3"><button className="btn-soft" disabled={busy} onClick={() => setWarning(false)}>Kembali</button><button className="btn-primary" disabled={busy || !confirmed} onClick={() => void review(true)}>Review</button></div></div>}</div>}</section></>}</div>;
}
function History({ outletId, select }: { outletId: string; select: (date: string) => void }) {
  const [rows, setRows] = useState<Daily[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0), [error, setError] = useState('');
  useEffect(() => { let active = true; setRows([]); api<{ rows: Daily[]; total: number }>(`/checklists/${outletId}/history?page=${page}`).then(data => { if (active) { setRows(data.rows); setTotal(data.total); setError(''); } }).catch(e => { if (active) setError(errorText(e)); }); return () => { active = false; }; }, [outletId, page]);
  return <div className="space-y-3">{error && <p role="alert">{error}</p>}{rows.map(daily => <button key={daily.id} className="card block w-full p-4 text-left" onClick={() => select(daily.date)}><h2 className="mb-3 font-bold">{daily.date}</h2><Progress daily={daily} /><ReviewStatus daily={daily} /></button>)}{!rows.length && <p>Belum ada history.</p>}<div className="flex items-center gap-3"><button className="btn-soft" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><span>Halaman {page}</span><button className="btn-soft" disabled={page * 30 >= total} onClick={() => setPage(p => p + 1)}>Berikutnya</button></div></div>;
}
function ReviewSettings({ outletId }: { outletId: string }) {
  const [required, setRequired] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let active = true; api<{ reviewRequired: boolean }>(`/checklists/${outletId}/settings`).then(data => { if (active) setRequired(data.reviewRequired); }).catch(e => { if (active) setMessage(errorText(e)); }); return () => { active = false; }; }, [outletId]);
  async function change(value: boolean) {
    setBusy(true); setMessage('');
    try { const data = await api<{ reviewRequired: boolean }>(`/checklists/${outletId}/settings`, { method: 'PUT', body: JSON.stringify({ reviewRequired: value }) }); setRequired(data.reviewRequired); setMessage('Pengaturan review tersimpan.'); }
    catch (e) { setMessage(errorText(e)); } finally { setBusy(false); }
  }
  return <section className="card space-y-3 p-4"><h2 className="font-bold">Review outlet</h2><label className="flex items-center gap-3"><input className="h-6 w-6" type="checkbox" checked={required ?? false} disabled={required === null || busy} onChange={e => void change(e.target.checked)} />Wajib review Leader</label><p className="text-sm text-slate-500">Berlaku untuk checklist hari ini dan berikutnya. History sebelumnya tetap tersimpan.</p>{message && <p role="status" className="text-sm">{message}</p>}</section>;
}
function TemplateEditor({ outletId }: { outletId: string }) {
  const [rows, setRows] = useState<Template[]>([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [draggingId, setDraggingId] = useState('');
  const empty = { id: '', title: '', section: 'OPENING' as Section, sortOrder: 0, active: true };
  const [draft, setDraft] = useState<Template>(empty), [deleting, setDeleting] = useState<Template | null>(null);
  const rowsRef = useRef<Template[]>([]);
  const dragRef = useRef<{ id: string; pointerId: number; original: Template[]; moved: boolean; target: string } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const updateRows = useCallback((next: Template[]) => { const ordered = orderedTemplates(next); rowsRef.current = ordered; setRows(ordered); }, []);
  const refresh = useCallback(() => api<Template[]>(`/checklists/${outletId}/templates`).then(updateRows), [outletId, updateRows]);
  useEffect(() => { refresh().catch(e => setError(errorText(e))); }, [refresh]);
  useEffect(() => () => cleanupRef.current?.(), []);

  async function remove() {
    if (!deleting) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/checklists/${outletId}/templates/${deleting.id}`, { method: 'DELETE' });
      if (draft.id === deleting.id) setDraft(empty);
      setDeleting(null); await refresh();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function save(item: Template) {
    setBusy(true); setError(''); setMessage('');
    try {
      const { id, title, section, active } = item;
      const sortOrder = id ? item.sortOrder : rowsRef.current.filter(row => row.section === section).length;
      await api(`/checklists/${outletId}/templates${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify({ title, section, sortOrder, active }) });
      await refresh(); setDraft(empty);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function persistOrder(next: Template[]) {
    setBusy(true); setError(''); setMessage('Menyimpan urutan…');
    try {
      const saved = await api<Template[]>(`/checklists/${outletId}/templates/reorder`, { method: 'POST', body: JSON.stringify({ items: next.map(({ id, section, sortOrder }) => ({ id, section, sortOrder })) }) });
      updateRows(saved); setDraft(current => current.id ? saved.find(row => row.id === current.id) || current : current); setMessage('Urutan checklist tersimpan otomatis.');
    } catch (e) { setError(errorText(e)); setMessage(''); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, item: Template) {
    if (busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const previousUserSelect = document.body.style.userSelect, previousCursor = document.body.style.cursor;
    dragRef.current = { id: item.id, pointerId: event.pointerId, original: rowsRef.current, moved: false, target: '' };
    setDraggingId(item.id); setError(''); setMessage('Geser item ke posisi atau bagian tujuan.');
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'grabbing';
    const move = (pointer: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || pointer.pointerId !== drag.pointerId) return;
      pointer.preventDefault();
      if (pointer.clientY < 80) window.scrollBy(0, -14);
      else if (pointer.clientY > window.innerHeight - 80) window.scrollBy(0, 14);
      const target = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>('[data-checklist-drop]');
      const section = target?.dataset.checklistSection as Section | undefined;
      if (!target || !section || !sections.includes(section)) return;
      let index = Number(target.dataset.checklistIndex || 0);
      if (target.dataset.checklistItem === 'true') {
        const rect = target.getBoundingClientRect();
        if (pointer.clientY > rect.top + rect.height / 2) index += 1;
      }
      const targetKey = `${section}:${index}`;
      if (drag.target === targetKey) return;
      drag.target = targetKey;
      const next = moveTemplate(rowsRef.current, drag.id, section, index);
      if (next.some((row, rowIndex) => row.id !== rowsRef.current[rowIndex]?.id || row.section !== rowsRef.current[rowIndex]?.section)) {
        drag.moved = true; updateRows(next);
      }
    };
    const finish = (pointer: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || pointer.pointerId !== drag.pointerId) return;
      cleanup(); dragRef.current = null; setDraggingId('');
      if (drag.moved) void persistOrder(rowsRef.current); else setMessage('');
    };
    const cancel = (pointer: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || pointer.pointerId !== drag.pointerId) return;
      cleanup(); updateRows(drag.original); dragRef.current = null; setDraggingId(''); setMessage('');
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel);
      document.body.style.userSelect = previousUserSelect; document.body.style.cursor = previousCursor; cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel);
  }

  return <div className="space-y-4">
    <p className="text-sm text-slate-600">Daftar item ini hanya berlaku untuk outlet yang dipilih. Item baru langsung ditambahkan ke checklist hari ini. Tarik pegangan untuk mengubah urutan atau memindahkan item ke bagian lain; perubahan langsung diterapkan pada checklist hari ini tanpa menghapus status centang.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    {deleting && <div role="alertdialog" aria-label="Hapus item checklist" className="card space-y-3 border-red-200 p-4"><h2 className="font-bold">Hapus {deleting.title}?</h2><p>Item dan status centangnya akan dihapus dari checklist hari ini. History sebelumnya tetap tersimpan. Review hari ini perlu diulang jika item dihapus.</p><button className="btn-soft" disabled={busy} onClick={() => setDeleting(null)}>Batal</button><button className="btn-primary ml-2" disabled={busy} onClick={() => void remove()}>Ya, Hapus</button></div>}
    <form className="card space-y-3 p-4" onSubmit={event => { event.preventDefault(); void save(draft); }}><h2 className="font-bold">{draft.id ? 'Edit item' : 'Tambah item'}</h2><label className="block">Judul<input className="input" required maxLength={250} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label className="block">Bagian<select className="input" value={draft.section} onChange={event => setDraft({ ...draft, section: event.target.value as Section })}>{sections.map(section => <option key={section} value={section}>{labels[section]}</option>)}</select></label><button className="btn-primary" disabled={busy}>Simpan Item</button>{draft.id && <button type="button" className="btn-soft ml-2" onClick={() => setDraft(empty)}>Batal Edit</button>}</form>
    <div className="space-y-4"><div><h2 className="text-lg font-black">Atur urutan</h2><p className="text-sm text-slate-500">Tekan dan geser ikon pegangan. Item dapat dipindahkan antarbagian.</p></div>{sections.map(section => {
      const sectionRows = rows.filter(row => row.section === section);
      return <section key={section} className={`card p-4 transition ${draggingId ? 'ring-2 ring-brand-100' : ''}`}>
        <h2 className="mb-3 flex items-center justify-between font-bold"><span>{labels[section]}</span><span className="text-xs font-medium text-slate-400">{sectionRows.length} item</span></h2>
        <div className="min-h-16 space-y-2 rounded-xl border border-dashed border-slate-200 p-2" data-checklist-drop data-checklist-section={section} data-checklist-index={sectionRows.length}>
          {sectionRows.map((item, index) => <div key={item.id} data-checklist-drop data-checklist-item="true" data-checklist-section={section} data-checklist-index={index} className={`rounded-xl border bg-white p-2 shadow-sm transition ${draggingId === item.id ? 'pointer-events-none scale-[0.98] opacity-50' : ''}`}>
            <div className="flex items-center gap-2"><button type="button" aria-label={`Geser ${item.title}`} title="Geser untuk mengatur urutan" disabled={busy} onPointerDown={event => beginDrag(event, item)} className="flex h-11 w-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 active:cursor-grabbing"><GripVertical size={22} /></button><span className="min-w-0 flex-1"><span className="block font-medium">{item.title}</span><span className="text-xs text-slate-400">Urutan {index + 1}{!item.active ? ' · Nonaktif' : ''}</span></span></div>
            <div className="mt-2 flex flex-wrap justify-end gap-2"><button className="btn-soft px-3 py-2 text-sm" disabled={busy} onClick={() => { setDraft(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button><button className="btn-soft px-3 py-2 text-sm" disabled={busy} onClick={() => void save({ ...item, active: !item.active })}>{item.active ? 'Nonaktifkan' : 'Aktifkan'}</button><button className="btn-soft px-3 py-2 text-sm text-red-700" disabled={busy} onClick={() => { setDeleting(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Hapus</button></div>
          </div>)}
          {!sectionRows.length && <p className="py-4 text-center text-sm text-slate-400">Tarik item ke bagian ini.</p>}
        </div>
      </section>;
    })}</div>
  </div>;
}
export default function ChecklistPage({ settings = false }: { settings?: boolean }) {
  const { selectedOutletId, setSelectedOutletId } = useOutlet();
  const [outletId, setOutletId] = useState(selectedOutletId), [date, setDate] = useState(''), [mode, setMode] = useState<'daily' | 'monitor' | 'history'>('daily');
  const [summary, setSummary] = useState<Summary | null>(null), [error, setError] = useState('');
  useEffect(() => { setOutletId(selectedOutletId); setDate(''); }, [selectedOutletId]);
  useEffect(() => { let active = true; const refresh = () => api<Summary>('/checklists').then(data => { if (active) { setSummary(data); setError(''); } }).catch(e => { if (active) setError(errorText(e)); }); void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000); return () => { active = false; window.clearInterval(timer); }; }, []);
  useEffect(() => { if (summary && outletId && !summary.rows.some(row => row.outletId === outletId)) setOutletId(''); }, [summary, outletId]);
  return <main className="mx-auto w-full max-w-4xl space-y-5 p-4 md:p-6"><header><h1 className="text-2xl font-black">{settings ? 'Settings · Checklist' : 'Checklist Harian'}</h1><p className="mt-1 text-sm text-slate-500">Crew mengerjakan · Leader mengontrol · Owner monitoring</p></header>{error && <p role="alert" className="text-red-700">{error}</p>}{!settings && <nav className="flex flex-wrap gap-2"><button className={mode === 'daily' ? 'btn-primary' : 'btn-soft'} onClick={() => { setMode('daily'); setDate(''); }}>Hari Ini</button>{summary?.canReview && <button className={mode === 'monitor' ? 'btn-primary' : 'btn-soft'} onClick={() => setMode('monitor')}>Monitoring Leader</button>}<button className={mode === 'history' ? 'btn-primary' : 'btn-soft'} onClick={() => setMode('history')}>History</button>{summary?.canConfigure && <Link className="btn-soft" to="/settings/checklist">Pengaturan</Link>}</nav>}{settings && <Link className="btn-soft" to="/checklists">Checklist Harian</Link>}{mode !== 'monitor' && <label className="block">Outlet<select className="input mt-1" value={outletId} onChange={e => { setSelectedOutletId(e.target.value); setOutletId(e.target.value); setDate(''); }}><option value="">Pilih outlet</option>{(summary?.rows || []).map(o => <option key={o.outletId} value={o.outletId}>{o.name}</option>)}</select></label>}{settings ? summary?.canConfigure ? outletId && <div key={outletId} className="space-y-4"><ReviewSettings outletId={outletId} /><TemplateEditor outletId={outletId} /></div> : <p>Pengaturan checklist hanya untuk Owner.</p> : mode === 'monitor' ? <div className="space-y-3"><p className="text-sm text-slate-500">Progress diperbarui setiap 30 detik. PIC menampilkan user yang menyelesaikan item hari ini.</p>{summary?.rows.map(row => <article className="card space-y-3 p-4" key={row.outletId}><h2 className="font-bold">{row.name} · {row.date}</h2>{row.daily ? <><Progress daily={row.daily} /><ReviewStatus daily={row.daily} /><p className="text-xs text-slate-500">PIC: {[...new Set(row.daily.items.flatMap(i => i.completer ? [i.completer.name] : []))].join(', ') || 'Belum ada'}<br />Last Update: {stamp(row.daily.updatedAt)}</p></> : <p className="text-amber-700">Checklist belum dibuka · {row.reviewRequired ? 'Belum Review' : 'Review tidak diwajibkan'}</p>}<button className="btn-soft" onClick={() => { setSelectedOutletId(row.outletId); setOutletId(row.outletId); setDate(''); setMode('daily'); }}>Lihat Detail</button></article>)}</div> : outletId ? mode === 'history' ? <History key={outletId} outletId={outletId} select={value => { setDate(value); setMode('daily'); }} /> : <DailyDetail key={`${outletId}:${date}`} outletId={outletId} date={date} canReview={summary?.canReview || false} /> : <p>Pilih outlet untuk melanjutkan.</p>}</main>;
}
