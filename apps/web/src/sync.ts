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

export type SyncResult = {
  ok: boolean;
  uploaded: Record<string, number>;
  failed: number;
  downloaded: number;
  message: string;
};

const META_EVENT = 'foru-sync-state';

function onlineOnlyState(): SyncState {
  return {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: false,
    pendingCount: 0,
    failedCount: 0,
    progress: 0,
    message: 'Online mode aktif. Offline sync dinonaktifkan sementara.',
  };
}

export function getSyncQueue(): SyncQueueItem[] {
  return [];
}

export function saveSyncQueue(_queue: SyncQueueItem[]) {
  refreshSyncState();
}

export function enqueueSync(_item: Omit<SyncQueueItem, 'id' | 'status' | 'retryCount' | 'createdAt'> & { id?: string }) {
  return '';
}

export function recordLocalAudit(_action: string, _entityType: string, _entityId: string, _newValue?: unknown) {
  // Online release: local audit queue is disabled. Backend-side audit remains active for API mutations.
}

export function getSyncState() {
  return onlineOnlyState();
}

export function subscribeSyncState(listener: (state: SyncState) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<SyncState>).detail);
  window.addEventListener(META_EVENT, handler);
  listener(getSyncState());
  return () => window.removeEventListener(META_EVENT, handler);
}

export function refreshSyncState() {
  window.dispatchEvent(new CustomEvent(META_EVENT, { detail: getSyncState() }));
}

export async function runManualSync(_selectedIds?: string[]): Promise<SyncResult> {
  throw new Error('Manual sync dinonaktifkan pada online mode.');
}

export async function downloadMasterData(_reason?: 'APP_OPEN' | 'LOGIN' | 'ONLINE') {
  return null;
}

export function scheduleAutoSync() {
  // Disabled for online release.
}

export function initSyncService() {
  window.addEventListener('online', refreshSyncState);
  window.addEventListener('offline', refreshSyncState);
  refreshSyncState();
}
