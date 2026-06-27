export type MasterDataEvent =
  | 'variant_option_created'
  | 'variant_option_updated'
  | 'variant_option_deleted'
  | 'variant_group_updated'
  | 'product_master_updated'
  | 'master_data_refreshed';

export const MASTER_DATA_EVENT = 'foru-master-data-event';
const MASTER_DATA_VERSION_KEY = 'foru:master_data_version';

export function getMasterDataVersion() {
  return Number(localStorage.getItem(MASTER_DATA_VERSION_KEY) || '0');
}

export function emitMasterDataChanged(type: MasterDataEvent = 'master_data_refreshed', detail: Record<string, unknown> = {}) {
  const version = getMasterDataVersion() + 1;
  localStorage.setItem(MASTER_DATA_VERSION_KEY, String(version));
  window.dispatchEvent(new CustomEvent(MASTER_DATA_EVENT, { detail: { type, version, ...detail } }));
}

export function subscribeMasterDataChanged(listener: (event: { type: MasterDataEvent; version: number; [key: string]: unknown }) => void) {
  const handler = (event: Event) => listener((event as CustomEvent).detail);
  window.addEventListener(MASTER_DATA_EVENT, handler);
  return () => window.removeEventListener(MASTER_DATA_EVENT, handler);
}
