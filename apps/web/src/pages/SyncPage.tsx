import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { dt } from '../api';
import { getSyncQueue, runManualSync, saveSyncQueue, subscribeSyncState, type SyncQueueItem, type SyncQueueStatus, type SyncState } from '../sync';

export default function SyncPage() {
  const [rows, setRows] = useState<SyncQueueItem[]>(() => getSyncQueue());
  const [filter, setFilter] = useState<SyncQueueStatus | 'ALL'>('PENDING');
  const [selected, setSelected] = useState<string[]>([]);
  const [state, setState] = useState<SyncState>();
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  function reload() { setRows(getSyncQueue()); }
  useEffect(() => subscribeSyncState(s => { setState(s); reload(); }), []);

  const shown = useMemo(() => rows.filter(x => filter === 'ALL' || x.status === filter), [rows, filter]);
  const counts = rows.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] || 0) + 1 }), {} as Record<string, number>);

  async function retry(ids?: string[]) {
    const retryIds = ids?.length ? ids : rows.filter(x => x.status === 'FAILED').map(x => x.id);
    if (!retryIds.length) return alert('Tidak ada data untuk retry.');
    try {
      await runManualSync(retryIds);
      reload();
    } catch (error) {
      alert((error as Error).message);
    }
  }

  function view(row: SyncQueueItem) {
    alert(JSON.stringify(row, null, 2));
  }

  function deleteLocal(row: SyncQueueItem) {
    if (user?.role !== 'OWNER') return;
    if (!confirm('Hapus data lokal ini dari sync queue?')) return;
    saveSyncQueue(getSyncQueue().filter(x => x.id !== row.id));
    reload();
  }

  return <div className="p-4 lg:p-8">
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <h2 className="text-3xl font-black">Sinkronisasi</h2>
        <p className="text-slate-500">Pantau queue offline, retry data gagal, dan jalankan manual sync.</p>
      </div>
      <button onClick={() => runManualSync().catch(e => alert(e.message))} disabled={state?.syncing} className="btn-primary">Sync Sekarang</button>
    </div>

    <div className="mb-5 grid gap-3 sm:grid-cols-4">
      <Card label="Status" value={state?.syncing ? 'Sinkronisasi...' : state?.online ? 'Online' : 'Offline'} />
      <Card label="Last Sync" value={state?.lastSyncAt ? dt(state.lastSyncAt) : '-'} />
      <Card label="Pending Sync" value={String((counts.PENDING || 0) + (counts.SYNCING || 0))} />
      <Card label="Failed" value={String(counts.FAILED || 0)} />
      <Card label="Next Auto Sync" value={state?.nextAutoSyncAt ? dt(state.nextAutoSyncAt) : '-'} />
    </div>

    <div className="mb-4 flex flex-wrap gap-2">
      {(['PENDING', 'FAILED', 'SYNCED', 'ALL'] as const).map(x => <button key={x} onClick={() => setFilter(x)} className={`rounded-full px-4 py-2 text-sm font-bold ${filter === x ? 'bg-ink text-white' : 'bg-white text-slate-500'}`}>{x}</button>)}
      <button onClick={() => retry(selected)} className="rounded-full bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700">Retry Selected</button>
      <button onClick={() => retry()} className="rounded-full bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700">Retry All Failed</button>
    </div>

    <div className="card overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-4"></th><th>Tipe</th><th>Action</th><th>Status</th><th>Retry</th><th>Error</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>{shown.map(row => <tr className="border-t" key={row.id}>
            <td className="p-4"><input type="checkbox" checked={selected.includes(row.id)} onChange={e => setSelected(v => e.target.checked ? [...v, row.id] : v.filter(id => id !== row.id))} /></td>
            <td className="font-bold">{row.entityType}</td>
            <td>{row.action}</td>
            <td><span className={`pill ${row.status === 'SYNCED' ? 'bg-brand-50 text-brand-700' : row.status === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{row.status}</span></td>
            <td>{row.status === 'SYNCED' ? '-' : row.retryCount}</td>
            <td className="max-w-xs truncate text-red-600">{row.lastError || '-'}</td>
            <td>{dt(row.createdAt)}</td>
            <td><div className="flex gap-3"><button onClick={() => view(row)} className="font-bold text-brand-600">View Detail</button>{row.status === 'FAILED' && <button onClick={() => retry([row.id])} className="font-bold text-brand-600">Retry</button>}{user?.role === 'OWNER' && <button onClick={() => deleteLocal(row)} className="text-red-600"><Trash2 size={16} /></button>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!shown.length && <div className="p-10 text-center text-sm text-slate-400">Tidak ada data sync queue untuk filter ini.</div>}
    </div>
  </div>;
}

function Card({ label, value }: { label: string; value: string }) {
  return <div className="card p-4"><p className="text-xs font-bold text-slate-400">{label}</p><b className="mt-2 block text-lg">{value}</b></div>;
}
