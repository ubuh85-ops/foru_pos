export type OrderNotificationSettings = { soundEnabled: boolean; soundName: string };

const STORAGE_KEY = 'foru:order-notification-settings';
export const ORDER_NOTIFICATION_SETTINGS_CHANGED = 'foru:order-notification-settings-changed';

export function getOrderNotificationSettings(): OrderNotificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<OrderNotificationSettings>;
      return { soundEnabled: value.soundEnabled !== false, soundName: value.soundName || 'default' };
    }
  } catch { /* use defaults */ }
  return { soundEnabled: true, soundName: 'default' };
}

export function setOrderNotificationSettings(value: OrderNotificationSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(ORDER_NOTIFICATION_SETTINGS_CHANGED, { detail: value }));
}
