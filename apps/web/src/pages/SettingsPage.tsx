import OrderNotificationSettings from '../components/OrderNotificationSettings';

export default function SettingsPage() {
  return <main className="mx-auto w-full max-w-4xl p-4 md:p-6 lg:p-8">
    <div className="mb-6">
      <h1 className="text-3xl font-black text-slate-900">Settings</h1>
      <p className="mt-1 text-slate-500">Atur preferensi aplikasi dan notifikasi device.</p>
    </div>
    <OrderNotificationSettings />
  </main>;
}
