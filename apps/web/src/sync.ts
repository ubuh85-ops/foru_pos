import { api } from './api';
import { getCachedJson, getCachedText, initLocalDb, setLocalJson, setLocalText } from './localDb';
import { emitMasterDataChanged } from './masterEvents';

export type SyncQueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
export type SyncEntityType = 'ORDER' | 'SALE' | 'EXPENSE' | 'CASH_SESSION' | 'PRINTER_LOG' | 'AUDIT_LOG' | 'VARIANT_OPTION';
export type SyncAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'PAY' | 'CANCEL' | 'VOID' | 'CLOSE_SHIFT' | 'PRINT';

export type SyncQueueItem = {
  id: string;
  entityType: SyncEntityType;
  entityLocalId: string;
  action: SyncAction;
  payload: any;
  status: SyncQueueStatus;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  syncedAt?: string;
};

export type SyncState = {
  online: boolean;
  syncing: boolean;
  lastSyncAt?: string;
  pendingCount: number;
  failedCount: number;
  message?: string;
  progress: number;
  step?: string;
  nextAutoSyncAt?: string;
};

const QUEUE_KEY = 'foru:sync_queue';
const LAST_SYNC_KEY = 'foru:last_sync_at';
const META_EVENT = 'foru-sync-state';
const RETRY_DELAYS = [30_000, 60_000, 300_000, 900_000];
const AUTO_SYNC_INTERVAL = 30_000;

let currentState: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  lastSyncAt: getCachedText(LAST_SYNC_KEY) || undefined,
  pendingCount: 0,
  failedCount: 0,
  progress: 0
};
let running: Promise<SyncResult> | null = null;

export type SyncResult = {
  ok: boolean;
  uploaded: Record<string, number>;
  failed: number;
  downloaded: number;
  message: string;
};

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function getSyncQueue() {
  return getCachedJson<SyncQueueItem[]>(QUEUE_KEY, []);
}

export function saveSyncQueue(queue: SyncQueueItem[]) {
  void setLocalJson(QUEUE_KEY, queue);
  refreshSyncState();
}

export function enqueueSync(item: Omit<SyncQueueItem, 'id' | 'status' | 'retryCount' | 'createdAt'> & { id?: string }) {
  const queue = getSyncQueue();
  const id = item.id || crypto.randomUUID();
  const existing = queue.find(x => x.id === id);
  const next = { ...item, id, status: 'PENDING' as const, retryCount: existing?.retryCount || 0, createdAt: existing?.createdAt || new Date().toISOString(), lastError: undefined };
  saveSyncQueue(existing ? queue.map(x => x.id === id ? next : x) : [...queue, next]);
  scheduleAutoSync();
  return id;
}

export function recordLocalAudit(action: string, entityType: string, entityId: string, newValue?: unknown) {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const row = {
    id: `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    entityType,
    entityId,
    action,
    oldValue: null,
    newValue,
    changedBy: user?.id,
    changedAt: new Date().toISOString()
  };
  const rows = getCachedJson<any[]>('foru:local_audit_logs', []);
  void setLocalJson('foru:local_audit_logs', [row, ...rows].slice(0, 1000));
  enqueueSync({ id: row.id, entityType: 'AUDIT_LOG', entityLocalId: row.id, action: 'CREATE', payload: row });
}

export function getSyncState() {
  const queue = getSyncQueue();
  currentState = {
    ...currentState,
    online: navigator.onLine,
    lastSyncAt: getCachedText(LAST_SYNC_KEY) || undefined,
    pendingCount: queue.filter(x => x.status === 'PENDING' || x.status === 'SYNCING').length,
    failedCount: queue.filter(x => x.status === 'FAILED').length
  };
  return currentState;
}

function emit() {
  window.dispatchEvent(new CustomEvent(META_EVENT, { detail: getSyncState() }));
}

export function subscribeSyncState(listener: (state: SyncState) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<SyncState>).detail);
  window.addEventListener(META_EVENT, handler);
  listener(getSyncState());
  return () => window.removeEventListener(META_EVENT, handler);
}

export function refreshSyncState() {
  emit();
}

function markItems(ids: string[], patch: Partial<SyncQueueItem>) {
  const now = new Date().toISOString();
  saveSyncQueue(getSyncQueue().map(item => ids.includes(item.id) ? { ...item, ...patch, syncedAt: patch.status === 'SYNCED' ? now : item.syncedAt } : item));
}

function groupForPush(items: SyncQueueItem[]) {
  const payload: Record<string, any[]> = { orders: [], sales: [], expenses: [], cash_sessions: [], printer_logs: [], audit_logs: [], variant_options: [] };
  const priority: Record<string, number> = { CASH_SESSION: 1, VARIANT_OPTION: 2, ORDER: 3, SALE: 4, EXPENSE: 5, PRINTER_LOG: 6, AUDIT_LOG: 7 };
  for (const item of [...items].sort((a, b) => (priority[a.entityType] || 99) - (priority[b.entityType] || 99))) {
    const row = { local_id: item.entityLocalId, action: item.action, idempotency_key: item.id, payload_hash: payloadHash(item.payload), payload: item.payload };
    if (item.entityType === 'ORDER') payload.orders.push(row);
    if (item.entityType === 'SALE') payload.sales.push(row);
    if (item.entityType === 'EXPENSE') payload.expenses.push(row);
    if (item.entityType === 'CASH_SESSION') payload.cash_sessions.push(row);
    if (item.entityType === 'PRINTER_LOG') payload.printer_logs.push(row);
    if (item.entityType === 'AUDIT_LOG') payload.audit_logs.push(row);
    if (item.entityType === 'VARIANT_OPTION') payload.variant_options.push(row);
  }
  return payload;
}

function payloadHash(payload: unknown) {
  const text = JSON.stringify(payload ?? {});
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return String(hash >>> 0);
}

export async function runManualSync(selectedIds?: string[]) {
  if (running) return running;
  if (!navigator.onLine) {
    currentState = { ...getSyncState(), online: false, message: 'Tidak ada koneksi internet.', progress: 0 };
    emit();
    throw new Error('Tidak ada koneksi internet.');
  }
  running = (async (): Promise<SyncResult> => {
    const start = performance.now();
    const queue = getSyncQueue();
    const candidates = queue.filter(item => selectedIds?.length ? selectedIds.includes(item.id) : ['PENDING', 'FAILED'].includes(item.status));
    const uploaded: Record<string, number> = {};
    let failed = 0;
    let downloaded = 0;
    try {
      currentState = { ...getSyncState(), syncing: true, message: 'Sinkronisasi Data...', progress: 10, step: 'Menyiapkan antrian...' };
      emit();

      if (candidates.length) {
        markItems(candidates.map(x => x.id), { status: 'SYNCING' });
        currentState = { ...getSyncState(), syncing: true, progress: 35, step: 'Mengirim transaksi, pengeluaran, dan shift...' };
        emit();
        const push = await api<any>('/sync/push', { method: 'POST', body: JSON.stringify(groupForPush(candidates)) });
        const failedLocalIds = new Map<string, string>((push.results || []).filter((x: any) => x.sync_status === 'FAILED').map((x: any) => [x.local_id, x.error || 'Sync gagal']));
        const okIds: string[] = [];
        const failIds: string[] = [];
        for (const item of candidates) {
          uploaded[item.entityType] = (uploaded[item.entityType] || 0) + (failedLocalIds.has(item.entityLocalId) ? 0 : 1);
          if (failedLocalIds.has(item.entityLocalId)) failIds.push(item.id); else okIds.push(item.id);
        }
        if (okIds.length) markItems(okIds, { status: 'SYNCED', lastError: undefined });
        if (failIds.length) {
          failed = failIds.length;
          saveSyncQueue(getSyncQueue().map(item => failIds.includes(item.id) ? { ...item, status: 'FAILED', retryCount: item.retryCount + 1, lastError: failedLocalIds.get(item.entityLocalId) || 'Sync gagal' } : item));
        }
      }

      currentState = { ...getSyncState(), syncing: true, progress: 70, step: 'Mengambil master data...' };
      emit();
      const hasMasterMutation = candidates.some(item => item.entityType === 'VARIANT_OPTION');
      const since = hasMasterMutation ? '' : getCachedText(LAST_SYNC_KEY);
      const master = await api<any>(hasMasterMutation ? '/sync/bootstrap' : `/sync/pull${since ? `?last_sync_at=${encodeURIComponent(since)}` : ''}`);
      const merged = mergeMasterData(master);
      await setLocalJson('foru:master_data', merged);
      emitMasterDataChanged('master_data_refreshed', { source: 'manual_sync' });
      downloaded = Object.values(master || {}).reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);

      const lastSyncAt = new Date().toISOString();
      await setLocalText(LAST_SYNC_KEY, lastSyncAt);
      currentState = { ...getSyncState(), syncing: false, lastSyncAt, progress: 100, step: 'Selesai', message: failed ? 'Sinkronisasi selesai dengan beberapa gagal.' : 'Sinkronisasi berhasil.' };
      emit();
      return { ok: failed === 0, uploaded, failed, downloaded, message: currentState.message || 'Sinkronisasi selesai.' };
    } catch (error) {
      failed = candidates.length;
      if (candidates.length) saveSyncQueue(getSyncQueue().map(item => candidates.some(x => x.id === item.id) ? { ...item, status: 'FAILED', retryCount: item.retryCount + 1, lastError: (error as Error).message } : item));
      currentState = { ...getSyncState(), syncing: false, progress: 0, step: 'Gagal', message: 'Sinkronisasi gagal.' };
      emit();
      try {
        await api('/sync/status', { method: 'POST', body: JSON.stringify({ action: 'SYNC_FAILED', startedAt: new Date(Date.now() - Math.round(performance.now() - start)).toISOString(), finishedAt: new Date().toISOString(), duration: Math.round(performance.now() - start), failedRecords: failed, error: (error as Error).message }) });
      } catch {}
      throw error;
    } finally {
      running = null;
      scheduleAutoSync();
    }
  })();
  return running;
}

function mergeMasterData(incoming: any) {
  if (!incoming?.incremental) return incoming;
  const existing = getCachedJson<any>('foru:master_data', {});
  const mergeRows = (oldRows: any[] = [], newRows: any[] = []) => {
    const map = new Map(oldRows.map(row => [row.id, row]));
    for (const row of newRows) map.set(row.id, row);
    return [...map.values()];
  };
  return {
    ...existing,
    ...incoming,
    outlets: mergeRows(existing.outlets, incoming.outlets),
    categories: mergeRows(existing.categories, incoming.categories),
    products: mergeRows(existing.products, incoming.products),
    variantGroups: mergeRows(existing.variantGroups, incoming.variantGroups),
    coupons: mergeRows(existing.coupons, incoming.coupons),
    printers: mergeRows(existing.printers, incoming.printers),
    user: incoming.user || existing.user
  };
}

export async function downloadMasterData(reason: 'APP_OPEN' | 'LOGIN' | 'ONLINE' = 'APP_OPEN') {
  if (!localStorage.getItem('token') || !navigator.onLine) return null;
  try {
    currentState = { ...getSyncState(), syncing: true, message: 'Mengambil master data...', progress: 65, step: reason === 'LOGIN' ? 'Menyiapkan data outlet...' : 'Refresh master data...' };
    emit();
    const master = await api<any>('/sync/bootstrap');
    await setLocalJson('foru:master_data', master);
    emitMasterDataChanged('master_data_refreshed', { source: reason });
    const lastSyncAt = new Date().toISOString();
    await setLocalText(LAST_SYNC_KEY, lastSyncAt);
    currentState = { ...getSyncState(), syncing: false, lastSyncAt, progress: 100, step: 'Master data siap', message: 'Master data berhasil diperbarui.' };
    emit();
    return master;
  } catch (error) {
    currentState = { ...getSyncState(), syncing: false, progress: 0, step: 'Gagal mengambil master data', message: (error as Error).message };
    emit();
    return null;
  }
}

let retryTimer: number | undefined;
let schedulerTimer: number | undefined;
export function scheduleAutoSync() {
  window.clearTimeout(retryTimer);
  if (!navigator.onLine) return;
  const failed = getSyncQueue().filter(x => x.status === 'FAILED');
  const pending = getSyncQueue().some(x => x.status === 'PENDING');
  if (pending) retryTimer = window.setTimeout(() => { runManualSync().catch(() => {}); }, 1500);
  else if (failed.length) {
    const next = failed.reduce((ms, item) => Math.min(ms, RETRY_DELAYS[Math.min(item.retryCount, RETRY_DELAYS.length - 1)]), RETRY_DELAYS[0]);
    retryTimer = window.setTimeout(() => { runManualSync().catch(() => {}); }, next);
  } else if (!getCachedText('foru:master_data')) retryTimer = window.setTimeout(() => { downloadMasterData('APP_OPEN').catch(() => {}); }, 1200);
}

function startBackgroundScheduler() {
  window.clearInterval(schedulerTimer);
  schedulerTimer = window.setInterval(() => {
    currentState = { ...getSyncState(), nextAutoSyncAt: new Date(Date.now() + AUTO_SYNC_INTERVAL).toISOString() };
    emit();
    if (!navigator.onLine || running) return;
    runManualSync().catch(() => {});
  }, AUTO_SYNC_INTERVAL);
  currentState = { ...getSyncState(), nextAutoSyncAt: new Date(Date.now() + AUTO_SYNC_INTERVAL).toISOString() };
  emit();
}

export function initSyncService() {
  void initLocalDb().then(() => { refreshSyncState(); downloadMasterData('APP_OPEN').finally(scheduleAutoSync); });
  window.addEventListener('online', () => { refreshSyncState(); downloadMasterData('ONLINE').finally(scheduleAutoSync); });
  window.addEventListener('offline', refreshSyncState);
  refreshSyncState();
  startBackgroundScheduler();
  scheduleAutoSync();
}
