import { Capacitor } from '@capacitor/core';
import { api } from './api';
import { appAlert } from './components/ui/AppDialog';

type InventoryAlertCandidate = {
  alertLogId?: string;
  inventoryItemId: string;
  itemName: string;
  unit?: string;
  alertType: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'CUSTOM_THRESHOLD';
  currentStock: number;
  threshold?: number | null;
  title: string;
  message: string;
};

const inventoryAlertDeviceKey = 'foru:inventory_alert_device_id';

function inventoryAlertDeviceId() {
  const existing = localStorage.getItem(inventoryAlertDeviceKey);
  if (existing) return existing;
  const generated = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(inventoryAlertDeviceKey, generated);
  return generated;
}

async function logAlert(alert: InventoryAlertCandidate, deviceId: string, status: 'SENT' | 'FAILED', errorMessage?: string) {
  if (alert.alertLogId) {
    await api(`/inventory/alert-logs/${alert.alertLogId}/result`, {
      method: 'PATCH',
      body: JSON.stringify({ deviceId, status, errorMessage: errorMessage || null })
    });
    return;
  }
  await api('/inventory/alert-logs', {
    method: 'POST',
    body: JSON.stringify({
      inventoryItemId: alert.inventoryItemId,
      deviceId,
      alertType: alert.alertType,
      currentStock: alert.currentStock,
      threshold: alert.threshold ?? null,
      title: alert.title,
      message: alert.message,
      status,
      errorMessage: errorMessage || null
    })
  });
}

export async function requestInventoryNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return { granted: false, reason: 'Notifikasi stok hanya aktif di Android app.' };
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') permission = await LocalNotifications.requestPermissions();
  if (permission.display !== 'granted') return { granted: false, reason: 'Izin notifikasi belum aktif. Aktifkan izin agar stok kosong dapat diberitahukan.' };
  try {
    await LocalNotifications.createChannel({
      id: 'inventory-stock-alert',
      name: 'Inventory Stock Alert',
      description: 'Notifikasi stok bahan baku kosong atau menipis',
      importance: 5,
      visibility: 1,
      sound: 'default'
    });
  } catch {}
  return { granted: true };
}

export async function checkInventoryStockAlerts(showPermissionWarning = false) {
  if (!Capacitor.isNativePlatform()) return { checked: true, sent: 0, failed: 0, skipped: 0 };
  const outletId = localStorage.getItem('outletId') || '';
  const deviceId = inventoryAlertDeviceId();
  const params = new URLSearchParams({ deviceId });
  if (outletId) params.set('outletId', outletId);
  const qs = `?${params.toString()}`;
  const alerts = await api<InventoryAlertCandidate[]>(`/inventory/alerts/check${qs}`);
  if (!alerts.length) return { checked: true, sent: 0, failed: 0 };

  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const permission = await requestInventoryNotificationPermission();
  if (!permission.granted) {
    for (const alert of alerts) await logAlert(alert, deviceId, 'FAILED', permission.reason);
    if (showPermissionWarning) await appAlert(permission.reason || 'Izin notifikasi belum aktif.', { title: 'Izin Notifikasi', tone: 'warning' });
    return { checked: true, sent: 0, failed: alerts.length };
  }

  let sent = 0;
  let failed = 0;
  for (const stockAlert of alerts) {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Date.now() % 2147483000) + sent + failed,
          title: stockAlert.title,
          body: stockAlert.message,
          channelId: 'inventory-stock-alert',
          schedule: { at: new Date(Date.now() + 250) }
        }]
      });
      await logAlert(stockAlert, deviceId, 'SENT');
      sent += 1;
    } catch (e) {
      await logAlert(stockAlert, deviceId, 'FAILED', (e as Error).message);
      failed += 1;
    }
  }
  return { checked: true, sent, failed };
}
