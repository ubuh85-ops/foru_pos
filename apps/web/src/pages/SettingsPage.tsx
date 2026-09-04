import { useEffect, useState } from 'react';
import OrderNotificationSettings from '../components/OrderNotificationSettings';
import { api } from '../api';

type OnlineFees = { gofoodFeePercent: number; grabfoodFeePercent: number; shopeefoodFeePercent: number };

function OnlineFeeSettings() {
  const [fees, setFees] = useState<OnlineFees>({ gofoodFeePercent: 0, grabfoodFeePercent: 0, shopeefoodFeePercent: 0 });
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api<OnlineFees>('/settings/online-fees').then(setFees).catch(e => setMessage((e as Error).message)); }, []);
  const fields: Array<[keyof OnlineFees, string]> = [['gofoodFeePercent', 'GoFood'], ['grabfoodFeePercent', 'GrabFood'], ['shopeefoodFeePercent', 'ShopeeFood']];
  async function save() {
    try { setSaving(true); setMessage(''); setFees(await api('/settings/online-fees', { method: 'PUT', body: JSON.stringify(fees) })); setMessage('Pengaturan fee online berhasil disimpan.'); }
    catch (e) { setMessage((e as Error).message); }
    finally { setSaving(false); }
  }
  return <section className="card p-5">
    <h3 className="text-lg font-black">Fee online</h3>
    <p className="mt-1 text-sm text-slate-500">Fee dipotong dari penjualan online saat menghitung profit laporan. Nilai penjualan dan pembayaran tidak berubah.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">{fields.map(([key, label]) => <label key={key}><span className="label">{label} (%)</span><input className="input" type="number" min="0" max="100" step="0.01" value={fees[key]} onChange={e => setFees(v => ({ ...v, [key]: Number(e.target.value) }))} /></label>)}</div>
    <button className="btn-primary mt-4" disabled={saving} onClick={save}>{saving ? 'Menyimpan...' : 'Simpan Fee Online'}</button>
    {message && <p className="mt-3 text-sm text-slate-500">{message}</p>}
  </section>;
}

export default function SettingsPage() {
  return <main className="mx-auto w-full max-w-4xl p-4 md:p-6 lg:p-8">
    <div className="mb-6">
      <h1 className="text-3xl font-black text-slate-900">Settings</h1>
      <p className="mt-1 text-slate-500">Atur preferensi aplikasi dan notifikasi device.</p>
    </div>
    <div className="space-y-5"><OnlineFeeSettings /><OrderNotificationSettings /></div>
  </main>;
}
