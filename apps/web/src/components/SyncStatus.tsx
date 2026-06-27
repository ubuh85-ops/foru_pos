import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { dt } from '../api';
import { runManualSync, subscribeSyncState, type SyncState } from '../sync';

export default function SyncStatus() {
  const [state, setState] = useState<SyncState>();

  useEffect(() => subscribeSyncState(setState), []);

  async function syncNow() {
    runManualSync().catch(() => {});
  }

  if (!state) return null;
  const status = state.syncing ? 'Sinkronisasi...' : state.online ? 'Online' : 'Offline';
  const dot = state.syncing ? 'bg-amber-400' : state.online ? 'bg-brand-500' : 'bg-red-500';
  const unsynced = state.pendingCount + state.failedCount;

  return <div className="flex min-w-0 items-center gap-2">
    <div className="hidden min-w-0 text-right text-xs leading-tight sm:block">
      <div className="flex items-center justify-end gap-1 font-bold"><span className={`h-2 w-2 rounded-full ${dot}`} />{status}</div>
      <div className="truncate text-slate-400">{state.lastSyncAt ? `Sinkron terakhir: ${dt(state.lastSyncAt)}` : 'Belum pernah sync'}</div>
      {unsynced > 0 && <div className="font-semibold text-amber-600">{unsynced} data belum tersinkron</div>}
    </div>
    <button onClick={syncNow} disabled={state.syncing} className="rounded-full bg-white px-3 py-2 text-xs font-black text-brand-700 shadow-sm ring-1 ring-brand-100 disabled:opacity-60">
      <RefreshCw size={14} className={`mr-1 inline ${state.syncing ? 'animate-spin' : ''}`} /> Sync
    </button>
  </div>;
}

export function SyncDashboardWidget() {
  const [state, setState] = useState<SyncState>();
  useEffect(() => subscribeSyncState(setState), []);
  if (!state) return null;
  const pending = state.pendingCount + state.failedCount;
  return <div className="mt-6 rounded-3xl border border-brand-100 bg-brand-50/50 p-5">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h3 className="section-title">Status Sinkronisasi</h3>
        <p className="mt-2 text-sm text-slate-500"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${state.syncing ? 'bg-amber-400' : state.online ? 'bg-brand-500' : 'bg-red-500'}`} />{state.syncing ? 'Sinkronisasi...' : state.online ? 'Online' : 'Offline'}</p>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div><p className="text-slate-400">Last Sync</p><b>{state.lastSyncAt ? dt(state.lastSyncAt) : '-'}</b></div>
        <div><p className="text-slate-400">Pending Sync</p><b>{pending}</b></div>
      </div>
      <button onClick={() => runManualSync().catch(() => {})} disabled={state.syncing} className="btn-primary shrink-0">Sync Sekarang</button>
    </div>
  </div>;
}
