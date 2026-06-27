import { Capacitor, registerPlugin } from '@capacitor/core';

type ForuSQLitePlugin = {
  init: () => Promise<{ ok: boolean }>;
  set: (o: { key: string; value: string }) => Promise<{ ok: boolean }>;
  get: (o: { key: string }) => Promise<{ value: string | null }>;
  remove: (o: { key: string }) => Promise<{ ok: boolean }>;
  clear: () => Promise<{ ok: boolean }>;
  keys: () => Promise<{ keys: string[] }>;
  backup: () => Promise<{ ok: boolean; path?: string }>;
};

const NativeSQLite = registerPlugin<ForuSQLitePlugin>('ForuSQLite');
const native = Capacitor.getPlatform() === 'android';
const cache = new Map<string, string>();
let ready: Promise<void> | null = null;

const knownKeys = [
  'foru:master_data',
  'foru:sync_queue',
  'foru:last_sync_at',
  'foru:active_cash_session',
  'foru:last_login_username',
  'foru:local_orders',
  'foru:local_expenses',
  'foru:local_audit_logs',
  'foru:device_id'
];

export function getCachedText(key: string) {
  return cache.get(key) ?? localStorage.getItem(key);
}

export function getCachedJson<T>(key: string, fallback: T): T {
  const raw = getCachedText(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function initLocalDb() {
  if (ready) return ready;
  ready = (async () => {
    if (native) {
      try {
        await NativeSQLite.init();
        const all = await NativeSQLite.keys();
        for (const key of [...new Set([...knownKeys, ...(all.keys || [])])]) {
          const row = await NativeSQLite.get({ key });
          if (row.value != null) cache.set(key, row.value);
          else {
            const legacy = localStorage.getItem(key);
            if (legacy != null) {
              cache.set(key, legacy);
              await NativeSQLite.set({ key, value: legacy });
            }
          }
        }
      } catch (error) {
        console.warn('SQLite native unavailable, fallback localStorage:', error);
        for (const key of knownKeys) {
          const value = localStorage.getItem(key);
          if (value != null) cache.set(key, value);
        }
      }
    } else {
      for (const key of knownKeys) {
        const value = localStorage.getItem(key);
        if (value != null) cache.set(key, value);
      }
    }
    if (!getCachedText('foru:device_id')) {
      const deviceId = crypto.randomUUID();
      cache.set('foru:device_id', deviceId);
      if (native) await NativeSQLite.set({ key: 'foru:device_id', value: deviceId });
      else localStorage.setItem('foru:device_id', deviceId);
    }
  })();
  return ready;
}

export async function setLocalText(key: string, value: string) {
  cache.set(key, value);
  if (native) {
    await initLocalDb();
    try { await NativeSQLite.set({ key, value }); } catch { localStorage.setItem(key, value); }
  } else localStorage.setItem(key, value);
}

export async function setLocalJson(key: string, value: unknown) {
  await setLocalText(key, JSON.stringify(value));
}

export async function removeLocal(key: string) {
  cache.delete(key);
  if (native) {
    await initLocalDb();
    try { await NativeSQLite.remove({ key }); } catch { localStorage.removeItem(key); }
  } else localStorage.removeItem(key);
}

export async function clearLocalForLogout() {
  const preserve = ['foru:master_data', 'foru:sync_queue', 'foru:last_sync_at', 'foru:last_login_username'];
  for (const key of ['token', 'user', 'outletId']) localStorage.removeItem(key);
  for (const [key] of cache) if (!preserve.includes(key)) cache.delete(key);
}

export async function backupLocalDatabase() {
  if (native) {
    await initLocalDb();
    return NativeSQLite.backup();
  }
  const stamp = new Date().toISOString();
  localStorage.setItem('foru:last_backup_at', stamp);
  return { ok: true, path: `browser-localStorage-${stamp}` };
}
