import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { API, rupiah } from '../api';

const publicFetch = async <T,>(path: string) => {
  const res = await fetch(`${API}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Permintaan gagal');
  return data as T;
};
const slug=(value='')=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

function statusInfo(status?: string) {
  if (status === 'PAID') return { title: 'Pesanan lunas', icon: CheckCircle2, className: 'bg-green-50 text-green-700' };
  if (status === 'REJECTED' || status === 'CANCELLED') return { title: 'Pesanan dibatalkan', icon: XCircle, className: 'bg-red-50 text-red-700' };
  if (status === 'PENDING_PAYMENT' || status === 'ACCEPTED') return { title: 'Pesanan diterima kasir', icon: CheckCircle2, className: 'bg-brand-50 text-brand-700' };
  return { title: 'Menunggu konfirmasi kasir', icon: Clock3, className: 'bg-amber-50 text-amber-700' };
}

export default function CustomerOrderStatusPage() {
  const { token = '' } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState('');
  const info = statusInfo(order?.status);
  const Icon = info.icon;

  useEffect(() => {
    const load = () => publicFetch<any>(`/public/order/status/${token}`).then(setOrder).catch(e => setError((e as Error).message));
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [token]);

  return <div className="grid min-h-screen place-items-center bg-slate-50 p-4 text-ink">
    <div className="w-full max-w-lg rounded-3xl bg-white p-6 text-center shadow-sm">
      {error ? <div className="rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{error}</div> : <>
        <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl ${info.className}`}><Icon size={32} /></div>
        <h1 className="text-2xl font-black">{order?.status === 'OPEN_ORDER' ? (order?.isPreOrder ? 'Pre-Order Berhasil' : 'Pesanan Berhasil') : info.title}</h1>
        <p className="mt-1 text-slate-500">{order?.orderNumber}</p>
        <p className="font-bold">{order?.customerName}</p>
        <p className="mt-2 font-bold">{String(order?.orderType || '').replace('_',' ')}</p>
        {order?.isPreOrder && order?.scheduledAt && <div className="mt-3 rounded-2xl bg-violet-50 p-3 text-violet-800"><p className="text-xs font-bold uppercase">Jadwal</p><b>{new Intl.DateTimeFormat('id-ID',{dateStyle:'long',timeStyle:'short',timeZone:order?.outlet?.timezone||'Asia/Jakarta'}).format(new Date(order.scheduledAt))}</b></div>}
        <div className="my-5 rounded-3xl bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Total</p>
          <b className="text-3xl text-brand-700">{rupiah(order?.grandTotal || 0)}</b>
        </div>
        <div className="space-y-2 text-left">
          {(order?.items || []).map((item: any) => <div key={item.id} className="flex justify-between rounded-2xl border p-3">
            <div><b>{item.productName}</b><p className="text-sm text-slate-500">{item.variantName || 'Base'}</p></div>
            <span>{item.qty}x</span>
          </div>)}
        </div>
        {order?.rejectionReason && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{order.rejectionReason}</p>}
        {order?.status === 'OPEN_ORDER' && <p className="mt-4 font-semibold text-slate-600">Pesanan sedang menunggu konfirmasi outlet.</p>}
        {order?.business && order?.outlet && <a href={`/order/${slug(order.business.code||order.business.name)}/${slug(order.outlet.code||order.outlet.name)}`} className="btn mt-4 inline-flex border">Buat Pesanan Baru</a>}
        <p className="mt-4 text-xs text-slate-400">Halaman ini otomatis diperbarui.</p>
      </>}
    </div>
  </div>;
}
