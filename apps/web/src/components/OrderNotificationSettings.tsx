import { Bell, BellOff, Play, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { api } from '../api';
import { getOrderNotificationSettings, ORDER_NOTIFICATION_SETTINGS_CHANGED, setOrderNotificationSettings, type OrderNotificationSettings } from '../orderNotificationSettings';

type DeviceSound = { id: string; name: string; uri: string };
const DeviceNotificationSound = registerPlugin<{ listSounds: () => Promise<{ sounds: DeviceSound[] }>; createChannel: (options: { channelId: string; channelName?: string; soundUri?: string }) => Promise<void>; clearAppChannels: () => Promise<void>; previewSound: (options: { soundUri: string }) => Promise<void>; stopPreview: () => Promise<void>; getSettings: () => Promise<{ hasSettings?: boolean; soundEnabled?: boolean; soundName?: string }>; saveSettings: (options: OrderNotificationSettings & { soundUri?: string }) => Promise<void> }>('DeviceNotificationSound');
const SOUND_MAP_KEY = 'foru:device-notification-sounds';

export default function OrderNotificationSettings() {
  const [settings, setSettings] = useState<OrderNotificationSettings>(() => getOrderNotificationSettings());
  const [draft, setDraft] = useState<OrderNotificationSettings>(() => getOrderNotificationSettings());
  const [deviceSounds, setDeviceSounds] = useState<DeviceSound[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);

  useEffect(() => {
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<OrderNotificationSettings>).detail;
      setSettings(next);
      setDraft(next);
    };
    window.addEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onChange);
    return () => window.removeEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onChange);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void DeviceNotificationSound.getSettings().then(nativeSettings => {
      if (!nativeSettings.hasSettings || typeof nativeSettings.soundEnabled !== 'boolean') return;
      const restored = { soundEnabled: nativeSettings.soundEnabled, soundName: nativeSettings.soundName || 'default' };
      setOrderNotificationSettings(restored);
      setSettings(restored);
      setDraft(restored);
    }).catch(() => {});
    void DeviceNotificationSound.listSounds().then(result => {
      const map = Object.fromEntries((result.sounds || []).map(sound => [sound.id, sound]));
      localStorage.setItem(SOUND_MAP_KEY, JSON.stringify(map));
      setDeviceSounds(result.sounds || []);
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setMessage('');
    setOrderNotificationSettings(draft);
    setSettings(draft);
    if (Capacitor.isNativePlatform()) {
      const selectedSound = deviceSounds.find(sound => sound.id === draft.soundName);
      await DeviceNotificationSound.saveSettings({ ...draft, soundUri: selectedSound?.uri || '' }).catch(() => {});
    }
    try {
      const token = localStorage.getItem('foru:android_push_token');
      await api('/push-devices/current/preferences', { method: 'PUT', body: JSON.stringify({ ...draft, ...(token ? { token } : {}) }) });
      setMessage('Pengaturan suara tersimpan di perangkat.');
    } catch (error) {
      setMessage('Pengaturan suara tersimpan di perangkat. Sinkronisasi server akan dicoba lagi saat perangkat terhubung.');
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    await stopPreview();
    const selected = deviceSounds.find(sound => sound.id === draft.soundName);
    if (selected) {
      await DeviceNotificationSound.previewSound({ soundUri: selected.uri }).then(() => setPreviewing(true)).catch(() => {});
      return;
    }
    if (draft.soundName === 'off') return;
    if (typeof AudioContext !== 'undefined') {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = draft.soundName === 'bell' ? 880 : draft.soundName === 'chime' ? 740 : 660;
      gain.gain.value = 0.08;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.35);
      audioContextRef.current = context;
      oscillatorRef.current = oscillator;
      oscillator.onended = () => setPreviewing(false);
      setPreviewing(true);
    }
  }

  async function stopPreview() {
    oscillatorRef.current?.stop();
    oscillatorRef.current = null;
    await audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    await DeviceNotificationSound.stopPreview().catch(() => {});
    setPreviewing(false);
  }

  return <section className="card p-5" aria-labelledby="order-notification-settings-title">
    <div className="flex items-start gap-3">
      <div className="rounded-xl bg-brand-50 p-3 text-brand-700">{settings.soundEnabled ? <Bell size={20} /> : <BellOff size={20} />}</div>
      <div className="min-w-0 flex-1">
        <h3 id="order-notification-settings-title" className="text-lg font-black">Notifikasi order web</h3>
        <p className="mt-1 text-sm text-slate-500">Atur suara notifikasi saat order masuk ke outlet aktif.</p>
      </div>
    </div>
    <label className="label mt-4">Suara notifikasi</label>
    <select aria-label="Suara notifikasi order" value={draft.soundEnabled ? draft.soundName : 'off'} onChange={event => {
      const value = event.target.value;
      const selected = deviceSounds.find(sound => sound.id === value);
      if (selected) void DeviceNotificationSound.clearAppChannels().then(() => DeviceNotificationSound.createChannel({ channelId: selected.id, channelName: `Customer Web Orders - ${selected.name}`, soundUri: selected.uri })).catch(() => {});
      setDraft({ soundEnabled: value !== 'off', soundName: value === 'off' ? draft.soundName : value });
    }} className="input max-w-md">
      <option value="default">Suara perangkat (Default)</option>
      {deviceSounds.map(sound => <option key={sound.id} value={sound.id}>{sound.name}</option>)}
      <option value="chime">Chime</option>
      <option value="bell">Bell</option>
      <option value="off">Mati</option>
    </select>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void preview()} disabled={previewing || !draft.soundEnabled || draft.soundName === 'off'} className="btn-secondary inline-flex items-center gap-2"><Play size={16} /> Preview Suara</button>
      <button type="button" onClick={() => void stopPreview()} disabled={!previewing} className="btn-secondary inline-flex items-center gap-2">Stop Preview</button>
      <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary inline-flex items-center gap-2"><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</button>
    </div>
    {message && <p className="mt-2 text-sm text-slate-500" role="status">{message}</p>}
    <p className="mt-2 text-xs text-slate-400">Di Android, pilihan suara diambil dari ringtone/alarm perangkat dan tetap berlaku saat aplikasi berjalan di background. Chime dan Bell digunakan oleh browser.</p>
  </section>;
}
