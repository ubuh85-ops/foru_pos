import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dt, rupiah } from '../api';
import { printWithBluetoothFallback } from '../printer';

const Page = ({ children }: { children: any }) => <div className="p-4 lg:p-8">{children}</div>;
const Loading = () => <div className="p-10 text-center text-slate-400">Memuat data...</div>;
const Err = ({ v }: { v: string }) => v ? <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{v}</div> : null;
const Empty = () => <div className="p-10 text-center text-sm text-slate-400">Belum ada data pada periode ini.</div>;
const statusPill = (status: string) => status === 'PAID' ? 'bg-brand-50 text-brand-700' : status === 'PENDING_PAYMENT' ? 'bg-amber-50 text-amber-700' : status === 'VOID' ? 'bg-red-50 text-red-700' : 'bg-slate-100';

export function Orders() {
  const tabs = ['PENDING_PAYMENT', 'PAID', 'CANCELLED', 'VOID'];
  const [status, setStatus] = useState('PENDING_PAYMENT');
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState('');
  const load = () => api<any[]>(`/orders?status=${status}`).then(setData).catch(e => setError(e.message));
  useEffect(() => { load(); }, [status]);

  async function pay(o: any) {
    try {
      const paymentMethod = prompt('Payment method: CASH, QRIS, GOFOOD, GRABFOOD, SHOPEEFOOD, VOUCHER', 'CASH') || 'CASH';
      const cashReceived = paymentMethod === 'CASH' ? Number(prompt('Cash received', String(o.grandTotal)) || 0) : undefined;
      const active = await api<any>('/cash-sessions/active');
      await api(`/orders/${o.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod, cashReceived, cashSessionId: active?.id }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function cancel(o: any) {
    try {
      const reason = prompt('Alasan cancel', 'Customer batal') || 'Customer batal';
      await api(`/orders/${o.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function voidOrder(o: any) {
    try {
      const reason = prompt('Alasan void', 'Void transaksi') || 'Void transaksi';
      await api(`/sales/${o.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function print(o: any, type: 'customer-item-list' | 'kitchen-ticket' | 'customer-receipt') {
    try {
      if (type === 'customer-receipt') await api(`/print/customer-receipt/${o.id}`, { method: 'POST' });
      else await api(`/orders/${o.id}/print/${type}`, { method: 'POST' });
      const doc = type === 'customer-receipt' ? await api(`/sales/${o.id}`) : await api(`/orders/${o.id}`);
      await printWithBluetoothFallback(doc, type, type === 'customer-item-list' ? `/customer-item-list/${o.id}` : type === 'customer-receipt' ? `/receipt/${o.id}` : `/kitchen-ticket/${o.id}`);
    } catch (e) { alert((e as Error).message); }
  }

  return <Page>
    <div className="mb-6"><h2 className="text-3xl font-black">Orders</h2><p className="text-slate-500">Pending order, paid, cancelled, dan void.</p></div>
    <div className="mb-5 flex gap-2 overflow-auto">{tabs.map(t => <button key={t} onClick={() => setStatus(t)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold ${status === t ? 'bg-ink text-white' : 'bg-white text-slate-500'}`}>{t.replace('_', ' ')}</button>)}</div>
    <Err v={error} />
    <div className="card overflow-hidden"><div className="overflow-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Order', 'Customer', 'Outlet', 'Cashier', 'Time', 'Total', 'Status', 'Actions'].map(x => <th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{data.map(o => <tr className="border-t" key={o.id}><td className="p-4 font-bold">{o.orderNumber || o.transactionNumber}<p className="font-normal text-slate-400">{o.transactionNumber || '-'}</p></td><td className="font-bold">{o.customerName || 'Walk In'}</td><td>{o.outlet.name}</td><td>{o.cashier.name}</td><td>{dt(o.createdAt)}</td><td className="font-bold">{rupiah(o.grandTotal)}</td><td><span className={`pill ${statusPill(o.status)}`}>{o.status}</span></td><td><div className="flex flex-wrap gap-2">
        <Link className="font-bold text-brand-600" to={`/orders/${o.id}`}>View</Link>
        {o.status === 'PENDING_PAYMENT' && <Link className="font-bold text-brand-600" to={`/pos?editOrderId=${o.id}`}>Edit</Link>}
        {o.status === 'PENDING_PAYMENT' && <button className="font-bold text-brand-600" onClick={() => pay(o)}>Pay</button>}
        {o.status === 'PENDING_PAYMENT' && <button className="font-bold text-brand-600" onClick={() => print(o, 'customer-item-list')}>Item List</button>}
        <button className="font-bold text-brand-600" onClick={() => print(o, 'kitchen-ticket')}>Kitchen</button>
        {o.status === 'PAID' && <button className="font-bold text-brand-600" onClick={() => print(o, 'customer-receipt')}>Receipt</button>}
        {o.status === 'PAID' && <button className="font-bold text-red-600" onClick={() => voidOrder(o)}>Void</button>}
        {o.status === 'PENDING_PAYMENT' && <button className="font-bold text-red-600" onClick={() => cancel(o)}>Cancel</button>}
      </div></td></tr>)}</tbody></table></div>{!data.length && <Empty />}</div>
  </Page>;
}

export function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>();
  const [error, setError] = useState('');
  const load = () => api(`/orders/${id}`).then(setOrder).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <Page><Err v={error} /></Page>;
  if (!order) return <Loading />;

  async function pay() {
    try {
      const paymentMethod = prompt('Payment method: CASH, QRIS, GOFOOD, GRABFOOD, SHOPEEFOOD, VOUCHER', 'CASH') || 'CASH';
      const cashReceived = paymentMethod === 'CASH' ? Number(prompt('Cash received', String(order.grandTotal)) || 0) : undefined;
      const active = await api<any>('/cash-sessions/active');
      const updated = await api<any>(`/orders/${order.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod, cashReceived, cashSessionId: active?.id }) });
      setOrder(updated);
    } catch (e) { alert((e as Error).message); }
  }
  async function cancel() {
    try {
      const reason = prompt('Alasan cancel', 'Customer batal') || 'Customer batal';
      await api(`/orders/${order.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function voidOrder() {
    try {
      const reason = prompt('Alasan void', 'Void transaksi') || 'Void transaksi';
      await api(`/sales/${order.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      load();
    } catch (e) { alert((e as Error).message); }
  }
  async function print(type: 'customer-item-list' | 'kitchen-ticket' | 'customer-receipt') {
    if (type === 'customer-receipt') await api(`/print/customer-receipt/${order.id}`, { method: 'POST' });
    else await api(`/orders/${order.id}/print/${type}`, { method: 'POST' });
    await printWithBluetoothFallback(order, type, type === 'customer-item-list' ? `/customer-item-list/${order.id}` : type === 'customer-receipt' ? `/receipt/${order.id}` : `/kitchen-ticket/${order.id}`);
    load();
  }

  return <Page>
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row"><div><h2 className="text-3xl font-black">{order.orderNumber || order.transactionNumber}</h2><p className="text-slate-500">{order.outlet.name} · {dt(order.createdAt)} · {order.status}</p></div><Link to="/orders" className="btn-soft">Kembali</Link></div>
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="card p-5 xl:col-span-2">
        <div className="mb-5 grid gap-3 sm:grid-cols-2"><div><p className="text-sm text-slate-400">Customer</p><h3 className="text-2xl font-black">{order.customerName || 'Walk In'}</h3></div><div className="text-sm text-slate-500"><p>Transaction: <b>{order.transactionNumber || '-'}</b></p><p>Cashier: <b>{order.cashier?.name}</b></p>{order.paidAt && <p>Paid: <b>{dt(order.paidAt)}</b></p>}{order.paymentMethod && <p>Payment: <b>{order.paymentMethod}</b></p>}{order.couponCode && <p>Coupon: <b>{order.couponCode}</b></p>}</div></div>
        {order.items.map((i: any) => <div className="border-t py-3 text-sm" key={i.id}><div className="flex justify-between gap-4"><div><b>{i.qty}x {i.productName}</b><p className="text-slate-400">{i.variantName}</p>{i.addons?.map((a: any) => <p className="text-slate-400" key={a.id}>+ {a.addonName}</p>)}{i.itemNote && <p className="mt-1 font-bold text-amber-700">NOTE: {i.itemNote}</p>}{Number(i.discountAmount) > 0 && <p className="text-xs text-brand-600">Diskon item: {rupiah(i.discountAmount)}</p>}</div><span>{rupiah(i.subtotalAfterDiscount)}</span></div></div>)}
        <div className="mt-5 space-y-1 border-t pt-4 text-right"><p>Product discount: {rupiah(order.productDiscountTotal)}</p><p>Transaction discount: {rupiah(order.transactionDiscountAmount)}</p><p>Coupon discount: {rupiah(order.couponDiscountAmount)}</p><p className="text-sm text-slate-400">Total</p><b className="text-2xl text-brand-700">{rupiah(order.grandTotal)}</b></div>
      </div>
      <div className="card p-5"><h3 className="section-title mb-4">Actions</h3>
        {order.status === 'PENDING_PAYMENT' && <button onClick={() => navigate(`/pos?editOrderId=${order.id}`)} className="btn-primary mb-2 w-full">Edit Order</button>}
        {order.status === 'PENDING_PAYMENT' && <button onClick={pay} className="btn-soft mb-2 w-full">Pay</button>}
        {order.status === 'PENDING_PAYMENT' && <button onClick={() => print('customer-item-list')} className="btn-soft mb-2 w-full">Customer Item List</button>}
        <button onClick={() => print('kitchen-ticket')} className="btn-soft mb-2 w-full">Kitchen Ticket</button>
        {order.status === 'PAID' && <button onClick={() => print('customer-receipt')} className="btn-soft mb-2 w-full">Print Receipt</button>}
        {order.status === 'PAID' && <button onClick={voidOrder} className="w-full rounded-xl bg-red-50 px-4 py-3 font-bold text-red-700">Void Transaction</button>}
        {order.status === 'PENDING_PAYMENT' && <button onClick={cancel} className="mt-2 w-full rounded-xl bg-red-50 px-4 py-3 font-bold text-red-700">Cancel Order</button>}
      </div>
    </div>
  </Page>;
}
