import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Bell, Boxes, Camera, History, PackagePlus, PackageX, Pencil, Plus, Search, SlidersHorizontal, Warehouse } from 'lucide-react';
import { api, dt, rupiah } from '../api';
import { checkInventoryStockAlerts, requestInventoryNotificationPermission } from '../inventoryAlerts';
import { scanInventoryBarcode } from '../barcodeScanner';

type Category = { id: string; name: string; status: string };
type Unit = { id: string; name: string; status: string };
type InvWarehouse = { id: string; code: string; name: string; type: string; outletId?: string | null; address?: string | null; picName?: string | null; phone?: string | null; status: string; outlet?: { name: string } | null };
type Item = {
  id: string; code: string; sku?: string | null; barcode?: string | null; name: string; categoryId: string; unitId: string;
  minimumStock: number; currentStock: number; averageCost: number;
  supplier?: string; notes?: string; photoUrl?: string; status: string;
  stockAlertEnabled?: boolean; stockAlertType?: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'CUSTOM_THRESHOLD'; stockAlertThreshold?: number | null;
  category?: Category; unit?: Unit; stocks?: Array<{ id: string; warehouseId: string; currentQty: number; availableQty: number; averageCost: number; warehouse?: InvWarehouse }>;
};

const tabs = [
  ['/inventory', 'Dashboard'],
  ['/inventory/warehouses', 'Warehouse'],
  ['/inventory/items', 'Bahan Baku'],
  ['/inventory/stock-in', 'Stok Masuk'],
  ['/inventory/stock-out', 'Stok Keluar'],
  ['/inventory/transfers', 'Transfer Stock'],
  ['/inventory/adjustments', 'Penyesuaian'],
  ['/inventory/opname', 'Stock Opname'],
  ['/inventory/history', 'Riwayat Stok'],
  ['/inventory/alerts', 'Notifikasi Stok']
];
const emptyItem = { code: '', sku: '', name: '', categoryId: '', unitId: '', minimumStock: 0, currentStock: 0, averageCost: 0, supplier: '', notes: '', photoUrl: '', stockAlertEnabled: false, stockAlertType: 'LOW_STOCK', stockAlertThreshold: '', status: 'ACTIVE' };
const n = (v: any) => Number(v || 0);

export default function InventoryPage() {
  const loc = useLocation();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [warehouses, setWarehouses] = useState<InvWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [summary, setSummary] = useState<any>();
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [alertRows, setAlertRows] = useState<any[]>([]);
  const [transferRows, setTransferRows] = useState<any[]>([]);
  const [period, setPeriod] = useState('today');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<any | null>(null);
  const mode = loc.pathname.split('/')[2] || 'dashboard';

  async function loadLookups() {
    const [nextCategories, nextUnits, nextWarehouses] = await Promise.all([api<Category[]>('/inventory/categories'), api<Unit[]>('/inventory/units'), api<InvWarehouse[]>('/warehouses?status=ACTIVE')]);
    setCategories(nextCategories); setUnits(nextUnits); setWarehouses(nextWarehouses);
    setWarehouseId(old => old || nextWarehouses[0]?.id || '');
    return { categories: nextCategories, units: nextUnits, warehouses: nextWarehouses };
  }
  function loadItems() {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (categoryId) p.set('category_id', categoryId);
    if (status) p.set('status', status);
    return api<Item[]>(`/inventory/items?${p}`).then(setItems);
  }
  function inventoryParams(extra?: Record<string, string>) { const p = new URLSearchParams(extra); if (warehouseId) p.set('warehouseId', warehouseId); return p.toString(); }
  function loadSummary() { return api(`/inventory/dashboard?${inventoryParams({ period })}`).then(setSummary); }
  function loadHistory() { return api<any[]>(`/inventory/history?${inventoryParams()}`).then(setHistoryRows); }
  function loadAlerts() { return api<any[]>('/inventory/alerts').then(setAlertRows); }
  function loadTransfers() { return api<any[]>(`/inventory/transfers?${inventoryParams()}`).then(setTransferRows); }
  function reload() { setError(''); loadLookups().catch(e => setError(e.message)); loadItems().catch(e => setError(e.message)); loadSummary().catch(() => {}); loadHistory().catch(() => {}); loadAlerts().catch(() => {}); loadTransfers().catch(() => {}); }
  useEffect(() => { reload(); }, []);
  useEffect(() => { loadItems().catch(e => setError(e.message)); }, [q, categoryId, status]);
  useEffect(() => { loadSummary().catch(e => setError(e.message)); loadHistory().catch(() => {}); loadTransfers().catch(() => {}); }, [period, warehouseId]);

  const activeItems = useMemo(() => items.filter(i => i.status === 'ACTIVE'), [items]);

  async function addLookup(kind: 'categories' | 'units') {
    const name = prompt(kind === 'categories' ? 'Nama kategori baru' : 'Nama satuan baru');
    if (!name) return;
    try {
      const created = await api<any>(`/inventory/${kind}`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      await loadLookups();
      if (kind === 'categories') setCategoryId(created.id);
      alert(`${kind === 'categories' ? 'Kategori' : 'Satuan'} "${created.name}" berhasil ditambahkan.`);
    } catch (e) { alert((e as Error).message); }
  }
  async function saveItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      code: f.get('code'), sku: f.get('sku') || null, name: f.get('name'), categoryId: f.get('categoryId'), unitId: f.get('unitId'),
      barcode: f.get('sku') || null,
      minimumStock: Number(f.get('minimumStock') || 0), currentStock: Number(f.get('currentStock') || 0), averageCost: Number(f.get('averageCost') || 0),
      supplier: f.get('supplier') || null, notes: f.get('notes') || null, photoUrl: edit?.photoUrl || null,
      stockAlertEnabled: f.get('stockAlertEnabled') === 'on', stockAlertType: f.get('stockAlertType') || 'LOW_STOCK',
      stockAlertThreshold: f.get('stockAlertThreshold') ? Number(f.get('stockAlertThreshold')) : null,
      status: f.get('status') || 'ACTIVE',
      warehouseId: f.get('warehouseId') || warehouseId || undefined
    };
    try {
      await api(edit?.id ? `/inventory/items/${edit.id}` : '/inventory/items', { method: edit?.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setEdit(null); reload();
      if (body.stockAlertEnabled) {
        const permission = await requestInventoryNotificationPermission();
        if (!permission.granted) alert(permission.reason);
      }
    } catch (e) { setError((e as Error).message); alert((e as Error).message); }
  }
  async function removeItem(item: Item) {
    if (!confirm(`Hapus bahan baku ${item.name}?`)) return;
    try { await api(`/inventory/items/${item.id}`, { method: 'DELETE' }); reload(); } catch (e) { alert((e as Error).message); }
  }
  async function photo(file?: File) {
    if (!file || !edit) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return alert('Foto harus JPG atau PNG.');
    if (file.size > 2 * 1024 * 1024) return alert('Maksimal ukuran foto 2MB.');
    const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file); });
    setEdit({ ...edit, photoUrl: data });
  }
  async function movement(endpoint: string, payload: any, form?: HTMLFormElement) {
    try { await api(endpoint, { method: 'POST', body: JSON.stringify(payload) }); form?.reset(); reload(); checkInventoryStockAlerts().catch(() => {}); alert('Stok berhasil disimpan.'); } catch (e) { setError((e as Error).message); }
  }
  async function scanForItem(): Promise<Item | null> {
    const scanned = await scanInventoryBarcode();
    if (!scanned?.value) return null;
    try {
      const rows = await api<Item[]>(`/inventory/search?q=${encodeURIComponent(scanned.value)}`);
      const exact = rows.find(i => i.sku?.toLowerCase() === scanned.value.toLowerCase() || i.code.toLowerCase() === scanned.value.toLowerCase()) || rows[0];
      if (exact) return exact;
    } catch {}
    if (confirm('Barang belum terdaftar.\n\nTambah Barang Baru?')) {
      setEdit({ ...emptyItem, code: scanned.value, sku: scanned.value });
    }
    return null;
  }
  async function scanForSku(currentId?: string) {
    const scanned = await scanInventoryBarcode();
    if (!scanned?.value) return;
    try {
      const found = await api<Item>(`/inventory/items/by-sku/${encodeURIComponent(scanned.value)}`);
      if (found && found.id !== currentId) {
        if (confirm(`Barcode sudah digunakan oleh:\n\n${found.name}\n\nApakah ingin membuka data tersebut?`)) setEdit(found);
        return;
      }
    } catch {}
    setEdit((old: any) => ({ ...(old || emptyItem), sku: scanned.value, code: old?.code || scanned.value }));
  }

  return <div className="p-4 lg:p-8">
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div><h2 className="text-3xl font-black">Inventory</h2><p className="text-slate-500">Manajemen stok manual. Belum terhubung dengan transaksi POS.</p></div>
      <div className="flex gap-2 overflow-x-auto">{tabs.map(([path, label]) => <Link key={path} to={path} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${loc.pathname === path || (path === '/inventory' && loc.pathname === '/inventory/dashboard') ? 'bg-ink text-white' : 'bg-white text-slate-600'}`}>{label}</Link>)}</div>
    </div>
    {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <WarehouseFilter warehouses={warehouses} warehouseId={warehouseId} setWarehouseId={setWarehouseId} />
    {mode === 'dashboard' && <Dashboard summary={summary} period={period} setPeriod={setPeriod} />}
    {mode === 'warehouses' && <WarehousePage rows={warehouses} reload={reload} />}
    {mode === 'items' && <Items items={items} categories={categories} units={units} q={q} setQ={setQ} categoryId={categoryId} setCategoryId={setCategoryId} status={status} setStatus={setStatus} addLookup={addLookup} setEdit={setEdit} removeItem={removeItem} />}
    {mode === 'stock-in' && <StockIn items={activeItems} warehouses={warehouses} warehouseId={warehouseId} onSubmit={movement} scanForItem={scanForItem} />}
    {mode === 'stock-out' && <StockOut items={activeItems} warehouses={warehouses} warehouseId={warehouseId} onSubmit={movement} scanForItem={scanForItem} />}
    {mode === 'transfers' && <TransferStock items={activeItems} warehouses={warehouses} rows={transferRows} reload={reload} />}
    {mode === 'adjustments' && <Adjustment items={activeItems} warehouses={warehouses} warehouseId={warehouseId} onSubmit={movement} scanForItem={scanForItem} />}
    {mode === 'opname' && <Opname items={activeItems} warehouses={warehouses} warehouseId={warehouseId} onSubmit={movement} scanForItem={scanForItem} />}
    {mode === 'history' && <HistoryView rows={historyRows} />}
    {mode === 'alerts' && <AlertLogs rows={alertRows} />}
    {edit && <ItemModal item={edit} categories={categories} units={units} warehouses={warehouses} warehouseId={warehouseId} save={saveItem} close={() => setEdit(null)} photo={photo} scanSku={scanForSku} />}
  </div>;
}

function Dashboard({ summary, period, setPeriod }: any) {
  const cards = [['Total Item', summary?.totalItems || 0, Boxes], ['Total Stock Value', rupiah(summary?.totalStockValue || 0), Warehouse], ['Low Stock', summary?.lowStock || 0, AlertTriangle], ['Out of Stock', summary?.outOfStock || 0, PackageX]];
  const max = Math.max(1, summary?.chart?.stockIn || 0, summary?.chart?.stockOut || 0, summary?.chart?.adjustment || 0);
  return <><div className="mb-4 flex gap-2 overflow-auto">{[['today', 'Hari Ini'], ['week', 'Minggu Ini'], ['month', 'Bulan Ini']].map(([v, l]) => <button key={v} onClick={() => setPeriod(v)} className={`rounded-full px-4 py-2 text-sm font-bold ${period === v ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'}`}>{l}</button>)}</div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]: any) => <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5" key={label}><div className="mb-4 flex justify-between"><span className="text-sm font-bold text-slate-500">{label}</span><span className="rounded-2xl bg-brand-50 p-2 text-brand-700"><Icon size={19} /></span></div><b className="text-2xl">{value}</b></div>)}</div><div className="mt-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5"><h3 className="mb-4 text-lg font-black">Stock Movement</h3>{[['Stock In', summary?.chart?.stockIn || 0, 'bg-brand-500'], ['Stock Out', summary?.chart?.stockOut || 0, 'bg-red-400'], ['Adjustment', summary?.chart?.adjustment || 0, 'bg-amber-400']].map(([l, v, c]: any) => <div className="mb-3" key={l}><div className="mb-1 flex justify-between text-sm"><b>{l}</b><span>{v}</span></div><div className="h-3 rounded-full bg-slate-100"><div className={`h-3 rounded-full ${c}`} style={{ width: `${Math.max(4, v / max * 100)}%` }} /></div></div>)}</div></>;
}

function WarehouseFilter({ warehouses, warehouseId, setWarehouseId }: any) {
  if (!warehouses.length) return null;
  return <div className="mb-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
    <label className="block max-w-md"><span className="label">Warehouse / Lokasi Stok</span><select className="input" value={warehouseId} onChange={(e: any) => setWarehouseId(e.target.value)}>{warehouses.map((w: InvWarehouse) => <option key={w.id} value={w.id}>{w.name} · {w.code}</option>)}</select></label>
  </div>;
}

function WarehousePage({ rows, reload }: any) {
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api('/warehouses', { method: 'POST', body: JSON.stringify({ code: f.get('code'), name: f.get('name'), type: f.get('type'), address: f.get('address') || null, picName: f.get('picName') || null, phone: f.get('phone') || null, status: 'ACTIVE' }) });
      e.currentTarget.reset(); reload(); alert('Warehouse berhasil ditambahkan.');
    } catch (err) { alert((err as Error).message); }
  }
  async function deactivate(id: string) {
    if (!confirm('Nonaktifkan warehouse ini?')) return;
    try { await api(`/warehouses/${id}`, { method: 'DELETE' }); reload(); } catch (err) { alert((err as Error).message); }
  }
  return <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
    <form onSubmit={save} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h3 className="mb-4 text-xl font-black">Tambah Warehouse</h3>
      <div className="grid gap-3">
        <Field name="code" label="Kode Warehouse" />
        <Field name="name" label="Nama Warehouse" />
        <label><span className="label">Type</span><select className="input" name="type"><option>CENTRAL</option><option>PRODUCTION</option><option>OUTLET</option><option>VIRTUAL</option></select></label>
        <Field name="address" label="Alamat" />
        <Field name="picName" label="PIC" />
        <Field name="phone" label="Telepon" />
      </div>
      <button className="btn-primary mt-4 w-full">Simpan Warehouse</button>
    </form>
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
      <div className="overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Kode', 'Nama', 'Type', 'Outlet', 'PIC', 'Status', ''].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((w: InvWarehouse) => <tr className="border-t" key={w.id}><td className="p-4 font-mono font-bold">{w.code}</td><td className="font-bold">{w.name}</td><td>{w.type}</td><td>{w.outlet?.name || '-'}</td><td>{w.picName || '-'}</td><td><span className="pill bg-slate-100">{w.status}</span></td><td>{w.status === 'ACTIVE' && <button className="text-red-600" onClick={() => deactivate(w.id)}>Inactive</button>}</td></tr>)}</tbody></table></div>
    </div>
  </div>;
}

function Items(p: any) {
  return <><div className="mb-4 grid gap-3 lg:grid-cols-[1fr_180px_160px_auto]"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input className="input pl-11" placeholder="Cari nama/kode/SKU barcode..." value={p.q} onChange={(e: any) => p.setQ(e.target.value)} /></div><select className="input" value={p.categoryId} onChange={(e: any) => p.setCategoryId(e.target.value)}><option value="">Semua kategori</option>{p.categories.map((c: Category) => <option value={c.id} key={c.id}>{c.name}</option>)}</select><select className="input" value={p.status} onChange={(e: any) => p.setStatus(e.target.value)}><option value="">Semua status</option><option>ACTIVE</option><option>INACTIVE</option></select><button onClick={() => p.setEdit(emptyItem)} className="btn-primary"><Plus size={18} /> Tambah</button></div><div className="mb-4 flex gap-2"><button onClick={() => p.addLookup('categories')} className="btn-soft">+ Kategori</button><button onClick={() => p.addLookup('units')} className="btn-soft">+ Satuan</button></div><div className="hidden overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 lg:block"><table className="w-full min-w-[1200px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Foto', 'Kode', 'SKU/Barcode', 'Nama', 'Kategori', 'Satuan', 'Min', 'Stock', 'Alert', 'Avg Cost', 'Status', ''].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{p.items.map((i: Item) => <tr className="border-t" key={i.id}><td className="p-4"><Thumb item={i} /></td><td className="font-bold">{i.code}</td><td className="font-mono text-xs">{i.sku || '-'}</td><td>{i.name}</td><td>{i.category?.name}</td><td>{i.unit?.name}</td><td>{n(i.minimumStock)}</td><td><StockBadge item={i} /></td><td><AlertBadge item={i} /></td><td>{rupiah(i.averageCost)}</td><td><span className="pill bg-slate-100">{i.status}</span></td><td><button onClick={() => p.setEdit(i)} className="mr-3 text-brand-700"><Pencil size={17} /></button><button onClick={() => p.removeItem(i)} className="text-red-600">Delete</button></td></tr>)}</tbody></table></div><div className="grid gap-3 lg:hidden">{p.items.map((i: Item) => <article className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5" key={i.id}><div className="flex gap-3"><Thumb item={i} /><div className="min-w-0 flex-1"><b className="block truncate">{i.name}</b><p className="text-sm text-slate-400">{i.code} · {i.sku || 'Tanpa barcode'} · {i.category?.name}</p><div className="mt-2 flex flex-wrap gap-2"><StockBadge item={i} /><AlertBadge item={i} /></div></div><button onClick={() => p.setEdit(i)}><Pencil size={18} /></button></div></article>)}</div></>;
}
function StockBadge({ item }: { item: Item }) { const stock = n(item.currentStock), min = n(item.minimumStock); const label = stock === 0 ? 'OUT OF STOCK' : stock <= min ? 'LOW STOCK' : `${stock} ${item.unit?.name || ''}`; const cls = stock === 0 ? 'bg-red-50 text-red-700' : stock <= min ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700'; return <span className={`pill ${cls}`}>{label}</span>; }
function AlertBadge({ item }: { item: Item }) { return <span className={`pill ${item.stockAlertEnabled ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>{item.stockAlertEnabled ? 'Alert ON' : 'Alert OFF'}</span>; }
function Thumb({ item }: { item: Item }) { return item.photoUrl ? <img src={item.photoUrl} className="h-14 w-14 rounded-2xl object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Boxes size={20} /></span>; }

function ItemModal({ item, categories, units, warehouses, warehouseId, save, close, photo, scanSku }: any) {
  const [sku, setSku] = useState(item.sku || '');
  useEffect(() => setSku(item.sku || ''), [item.id, item.sku]);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form onSubmit={save} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex justify-between"><h3 className="text-2xl font-black">{item.id ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}</h3><button type="button" onClick={close}>×</button></div><div className="mb-4 flex items-center gap-4"><Thumb item={item} /><label className="btn-soft cursor-pointer"><Camera size={16} /> Upload Foto<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => photo(e.target.files?.[0])} /></label></div><input type="hidden" name="photoUrl" value={item.photoUrl || ''} /><div className="grid gap-3 sm:grid-cols-2"><Field name="code" label="Kode" value={item.code} /><label><span className="label">SKU / Barcode</span><div className="flex gap-2"><input className="input min-w-0 flex-1 font-mono" name="sku" value={sku} onChange={e => setSku(e.target.value)} placeholder="8991234567890" /><button type="button" onClick={async () => { await scanSku(item.id); }} className="btn-soft shrink-0"><Camera size={16} /> Scan</button></div></label><Field name="name" label="Nama" value={item.name} />{!item.id && <label><span className="label">Warehouse Stok Awal</span><select className="input" name="warehouseId" defaultValue={warehouseId}>{warehouses.map((w: InvWarehouse) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}<Select name="categoryId" label="Kategori" value={item.categoryId} rows={categories} /><Select name="unitId" label="Satuan" value={item.unitId} rows={units} /><Field name="minimumStock" label="Minimum Stock" type="number" value={item.minimumStock} /><Field name="currentStock" label="Current Stock" type="number" value={item.currentStock} /><Field name="averageCost" label="Average Cost" type="number" value={item.averageCost} /><Field name="supplier" label="Supplier" value={item.supplier} /><label className="sm:col-span-2"><span className="label">Catatan</span><textarea name="notes" className="input min-h-24" defaultValue={item.notes || ''} /></label><section className="rounded-3xl border bg-slate-50 p-4 sm:col-span-2"><div className="mb-3 flex items-center gap-2 font-black"><Bell size={18} /> Stock Alert</div><label className="mb-3 flex items-center gap-3 text-sm font-bold"><input name="stockAlertEnabled" type="checkbox" defaultChecked={!!item.stockAlertEnabled} /> Aktifkan notifikasi stok</label><div className="grid gap-3 sm:grid-cols-2"><label><span className="label">Jenis Alert</span><select className="input" name="stockAlertType" defaultValue={item.stockAlertType || 'LOW_STOCK'}><option value="OUT_OF_STOCK">Stok kosong</option><option value="LOW_STOCK">Stok di bawah minimum</option><option value="CUSTOM_THRESHOLD">Custom threshold</option></select></label><Field name="stockAlertThreshold" label="Custom threshold" type="number" value={item.stockAlertThreshold ?? ''} /></div><p className="mt-2 text-xs text-slate-500">Contoh: kirim notifikasi jika stok ≤ 5 {item.unit?.name || ''}.</p></section><label><span className="label">Status</span><select className="input" name="status" defaultValue={item.status || 'ACTIVE'}><option>ACTIVE</option><option>INACTIVE</option></select></label></div><button className="btn-primary mt-5 w-full">Simpan</button></form></div>;
}
function Field({ name, label, value, type = 'text' }: any) { return <label><span className="label">{label}</span><input className="input" name={name} type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? '0.001' : undefined} defaultValue={value || ''} required={['code', 'name'].includes(name)} /></label>; }
function Select({ name, label, value, rows }: any) { return <label><span className="label">{label}</span><select className="input" name={name} defaultValue={value || rows[0]?.id} required>{rows.filter((x: any) => x.status === 'ACTIVE').map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>; }

function ItemSelect({ items, value, onChange }: { items: Item[]; value?: string; onChange?: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [internalId, setInternalId] = useState(items[0]?.id || '');
  const [open, setOpen] = useState(false);
  const selectedId = value ?? internalId;
  const choose = (id: string, name: string) => { onChange ? onChange(id) : setInternalId(id); setQuery(name); setOpen(false); };
  const selected = items.find(i => i.id === selectedId);
  const filtered = items.filter(i => i.name.toLowerCase().includes(query.toLowerCase()) || i.code.toLowerCase().includes(query.toLowerCase()) || (i.sku || '').toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  return <div className="relative"><input type="hidden" name="itemId" value={selectedId} required /><input className="input" value={query} onFocus={() => { setOpen(true); setQuery(''); }} onChange={e => { setQuery(e.target.value); setOpen(true); }} placeholder="Cari nama, kode, atau barcode bahan..." />{open && <div className="absolute z-50 mt-2 max-h-72 w-full overflow-auto rounded-2xl border bg-white shadow-xl">{filtered.length ? filtered.map(i => <button type="button" key={i.id} onMouseDown={() => choose(i.id, '')} className="flex w-full items-start justify-between gap-3 border-b px-4 py-3 text-left hover:bg-brand-50"><div><b className="block text-sm text-ink">{i.name}</b><span className="text-xs text-slate-400">{i.code} · {i.sku || 'Tanpa barcode'}</span></div><span className="shrink-0 text-xs font-bold text-slate-500">{n(i.currentStock)} {i.unit?.name}</span></button>) : <div className="px-4 py-3 text-sm text-slate-400">Bahan tidak ditemukan</div>}</div>}{selected && <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500"><b>{selected.name}</b><br />Kode: {selected.code} · SKU: {selected.sku || '-'} · Stock: {n(selected.currentStock)} {selected.unit?.name} · Avg Cost: {rupiah(selected.averageCost)}</div>}</div>;
}
function StockIn({ items, warehouses, warehouseId, onSubmit, scanForItem }: any) {
  const [itemId, setItemId] = useState(items[0]?.id || '');
  const [qty, setQty] = useState(1);
  async function scanOnce(add = false) { const item = await scanForItem(); if (!item) return; setItemId(item.id); setQty(q => add && item.id === itemId ? q + 1 : Math.max(1, q)); setTimeout(() => (document.querySelector('input[name="qty"]') as HTMLInputElement | null)?.focus(), 50); }
  async function continuous() { do { await scanOnce(true); } while (confirm('Scan item berikutnya? Tekan Batal untuk selesai.')); }
  return <Movement title="Stok Masuk" icon={<PackagePlus />} warehouses={warehouses} warehouseId={warehouseId} onSubmit={(e: any) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit('/inventory/stock-in', { warehouseId: f.get('warehouseId'), supplier: f.get('supplier'), reference: f.get('reference'), remarks: f.get('remarks'), items: [{ itemId: f.get('itemId'), qty: Number(f.get('qty')), unitCost: Number(f.get('unitCost')) }] }, e.currentTarget); }}><Field name="supplier" label="Supplier" /><Field name="reference" label="Referensi" /><div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => scanOnce(false)} className="btn-soft"><Camera size={16} /> Scan Barcode</button><button type="button" onClick={continuous} className="btn-soft">Continuous Scan</button></div><label className="sm:col-span-2"><span className="label">Bahan</span><ItemSelect items={items} value={itemId} onChange={setItemId} /></label><label><span className="label">Qty</span><input className="input" name="qty" type="number" min={0} step="0.001" value={qty} onChange={e => setQty(Number(e.target.value || 0))} /></label><Field name="unitCost" label="Harga Beli" type="number" /><Field name="remarks" label="Catatan" /></Movement>;
}
function StockOut({ items, warehouses, warehouseId, onSubmit, scanForItem }: any) {
  const [itemId, setItemId] = useState(items[0]?.id || '');
  async function scanOnce() { const item = await scanForItem(); if (!item) return; setItemId(item.id); setTimeout(() => (document.querySelector('input[name="qty"]') as HTMLInputElement | null)?.focus(), 50); }
  return <Movement title="Stok Keluar" icon={<PackageX />} warehouses={warehouses} warehouseId={warehouseId} onSubmit={(e: any) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit('/inventory/stock-out', { warehouseId: f.get('warehouseId'), destination: f.get('destination'), remarks: f.get('remarks'), items: [{ itemId: f.get('itemId'), qty: Number(f.get('qty')) }] }, e.currentTarget); }}><Field name="destination" label="Tujuan" /><button type="button" onClick={scanOnce} className="btn-soft"><Camera size={16} /> Scan Barcode</button><label><span className="label">Bahan</span><ItemSelect items={items} value={itemId} onChange={setItemId} /></label><Field name="qty" label="Qty" type="number" /><Field name="remarks" label="Catatan" /></Movement>;
}
function Adjustment({ items, warehouses, warehouseId, onSubmit, scanForItem }: any) {
  const [itemId, setItemId] = useState(items[0]?.id || '');
  async function scanOnce() { const item = await scanForItem(); if (!item) return; setItemId(item.id); setTimeout(() => (document.querySelector('input[name="qty"]') as HTMLInputElement | null)?.focus(), 50); }
  return <Movement title="Penyesuaian Stok" icon={<SlidersHorizontal />} warehouses={warehouses} warehouseId={warehouseId} onSubmit={(e: any) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit('/inventory/adjustments', { warehouseId: f.get('warehouseId'), itemId: f.get('itemId'), qty: Number(f.get('qty')), adjustmentType: f.get('adjustmentType'), reason: f.get('reason'), remarks: f.get('remarks') }, e.currentTarget); }}><button type="button" onClick={scanOnce} className="btn-soft sm:col-span-2"><Camera size={16} /> Scan Barcode</button><label><span className="label">Bahan</span><ItemSelect items={items} value={itemId} onChange={setItemId} /></label><Field name="qty" label="Qty" type="number" /><label><span className="label">Type</span><select className="input" name="adjustmentType"><option value="INCREASE">Increase</option><option value="DECREASE">Decrease</option></select></label><label><span className="label">Reason</span><select className="input" name="reason"><option>Rusak</option><option>Hilang</option><option>Expired</option><option>Koreksi</option><option>Lainnya</option></select></label><Field name="remarks" label="Catatan" /></Movement>;
}
function Opname({ items, warehouses, warehouseId, onSubmit, scanForItem }: any) {
  const [itemId, setItemId] = useState(items[0]?.id || '');
  async function scanOnce() { const item = await scanForItem(); if (!item) return; setItemId(item.id); setTimeout(() => (document.querySelector('input[name="actualStock"]') as HTMLInputElement | null)?.focus(), 50); }
  return <Movement title="Stock Opname" icon={<Warehouse />} warehouses={warehouses} warehouseId={warehouseId} onSubmit={(e: any) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit('/inventory/opname', { warehouseId: f.get('warehouseId'), items: [{ itemId: f.get('itemId'), actualStock: Number(f.get('actualStock')), remarks: f.get('remarks') }] }, e.currentTarget); }}><button type="button" onClick={scanOnce} className="btn-soft sm:col-span-2"><Camera size={16} /> Scan Barcode</button><label><span className="label">Bahan</span><ItemSelect items={items} value={itemId} onChange={setItemId} /></label><Field name="actualStock" label="Actual Stock" type="number" /><Field name="remarks" label="Catatan" /></Movement>;
}

function TransferStock({ items, warehouses, rows, reload }: any) {
  const [itemId, setItemId] = useState(items[0]?.id || '');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api('/inventory/transfers', { method: 'POST', body: JSON.stringify({ fromWarehouseId: f.get('fromWarehouseId'), toWarehouseId: f.get('toWarehouseId'), notes: f.get('notes') || null, autoComplete: f.get('autoComplete') === 'on', items: [{ itemId: f.get('itemId'), qty: Number(f.get('qty')), unitCost: Number(f.get('unitCost') || 0) }] }) });
      e.currentTarget.reset(); reload(); alert('Transfer stock berhasil dibuat.');
    } catch (err) { alert((err as Error).message); }
  }
  async function complete(id: string) {
    try { await api(`/inventory/transfers/${id}/complete`, { method: 'POST' }); reload(); alert('Transfer stock berhasil diselesaikan.'); } catch (err) { alert((err as Error).message); }
  }
  return <div className="grid gap-4 xl:grid-cols-[460px_1fr]"><form onSubmit={submit} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5"><div className="mb-5 flex items-center gap-3 text-2xl font-black"><span className="rounded-2xl bg-brand-50 p-3 text-brand-700"><PackagePlus /></span>Transfer Stock</div><div className="grid gap-3"><label><span className="label">Dari Warehouse</span><select className="input" name="fromWarehouseId">{warehouses.map((w: InvWarehouse) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label><span className="label">Ke Warehouse</span><select className="input" name="toWarehouseId">{warehouses.map((w: InvWarehouse) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label><span className="label">Bahan</span><ItemSelect items={items} value={itemId} onChange={setItemId} /></label><Field name="qty" label="Qty" type="number" value={1} /><Field name="unitCost" label="Unit Cost optional" type="number" /><Field name="notes" label="Catatan" /><label className="flex items-center gap-3 text-sm font-bold"><input type="checkbox" name="autoComplete" defaultChecked /> Langsung selesaikan transfer</label></div><button className="btn-primary mt-5 w-full">Simpan Transfer</button></form><div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5"><div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Tanggal', 'No Transfer', 'Dari', 'Ke', 'Item', 'Status', ''].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r: any) => <tr className="border-t" key={r.id}><td className="p-4">{dt(r.createdAt)}</td><td className="font-mono font-bold">{r.transferNumber}</td><td>{r.fromWarehouse?.name}</td><td>{r.toWarehouse?.name}</td><td>{r.items?.map((x: any) => `${x.item?.name} (${n(x.qty)})`).join(', ')}</td><td><span className="pill bg-slate-100">{r.status}</span></td><td>{r.status !== 'COMPLETED' && r.status !== 'CANCELLED' && <button className="font-bold text-brand-700" onClick={() => complete(r.id)}>Complete</button>}</td></tr>)}</tbody></table></div>{!rows.length && <div className="p-8 text-center text-slate-400">Belum ada transfer stock.</div>}</div></div>;
}

function Movement({ title, icon, onSubmit, children, warehouses = [], warehouseId }: any) { return <form onSubmit={onSubmit} className="max-w-2xl rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5"><div className="mb-5 flex items-center gap-3 text-2xl font-black"><span className="rounded-2xl bg-brand-50 p-3 text-brand-700">{icon}</span>{title}</div><div className="grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="label">Warehouse / Lokasi</span><select className="input" name="warehouseId" defaultValue={warehouseId}>{warehouses.map((w: InvWarehouse) => <option key={w.id} value={w.id}>{w.name} · {w.code}</option>)}</select></label>{children}</div><button className="btn-primary mt-5 w-full">Simpan</button></form>; }
function HistoryView({ rows }: any) { return <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5"><div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Tanggal', 'Item', 'Type', 'Qty', 'Before', 'After', 'User', 'Reference'].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r: any) => <tr className="border-t" key={r.id}><td className="p-4">{dt(r.createdAt)}</td><td className="font-bold">{r.item?.name}</td><td><span className="pill bg-slate-100">{r.movementType}</span></td><td>{n(r.qty)}</td><td>{n(r.beforeQty)}</td><td>{n(r.afterQty)}</td><td>{r.user?.name}</td><td>{r.reference || r.remarks || '-'}</td></tr>)}</tbody></table></div>{!rows.length && <div className="p-8 text-center text-slate-400"><History className="mx-auto mb-2" />Belum ada riwayat stok.</div>}</div>; }
function AlertLogs({ rows }: any) { return <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5"><div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Tanggal', 'Bahan', 'Alert', 'Stock', 'Threshold', 'Status', 'Pesan'].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r: any) => <tr className="border-t" key={r.id}><td className="p-4">{dt(r.sentAt)}</td><td className="font-bold">{r.item?.name}</td><td><span className="pill bg-amber-50 text-amber-700">{r.alertType}</span></td><td>{n(r.currentStock)} {r.item?.unit?.name}</td><td>{r.threshold ?? '-'}</td><td><span className={`pill ${r.status === 'SENT' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>{r.status}</span></td><td>{r.message || r.errorMessage || '-'}</td></tr>)}</tbody></table></div>{!rows.length && <div className="p-8 text-center text-slate-400"><Bell className="mx-auto mb-2" />Belum ada notifikasi stok.</div>}</div>; }
