import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { getOrderNotificationSettings, ORDER_NOTIFICATION_SETTINGS_CHANGED, setOrderNotificationSettings, type OrderNotificationSettings } from '../orderNotificationSettings';

export default function OrderNotificationSettings() {
  const [settings, setSettings] = useState<OrderNotificationSettings>(() => getOrderNotificationSettings());

  useEffect(() => {
    const onChange = (event: Event) => setSettings((event as CustomEvent<OrderNotificationSettings>).detail);
    window.addEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onChange);
    return () => window.removeEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onChange);
  }, []);

  async function update(next: OrderNotificationSettings) {
    setOrderNotificationSettings(next);
    await api('/push-devices/current/preferences', { method: 'PUT', body: JSON.stringify(next) }).catch(() => {});
  }

  return <label className="hidden shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 sm:flex" title="Pengaturan suara notifikasi order web">
    {settings.soundEnabled ? <Bell size={16} className="text-brand-600" /> : <BellOff size={16} />}
    <span>Notif</span>
    <select aria-label="Suara notifikasi order" value={settings.soundEnabled ? settings.soundName : 'off'} onChange={event => {
      const value = event.target.value;
      void update({ soundEnabled: value !== 'off', soundName: value === 'off' ? settings.soundName : value });
    }} className="max-w-28 bg-transparent text-xs font-bold outline-none">
      <option value="default">Default</option>
      <option value="chime">Chime</option>
      <option value="bell">Bell</option>
      <option value="off">Mati</option>
    </select>
  </label>;
}
