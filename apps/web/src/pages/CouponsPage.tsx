import { FormEvent, useEffect, useState } from 'react';
import { Edit, Plus, Tag, X } from 'lucide-react';
import { api, rupiah } from '../api';

type Coupon = {
  id: string;
  couponCode: string;
  couponName: string;
  discountType: 'NOMINAL' | 'PERCENTAGE';
  discountValue: number | string;
  maxDiscountAmount?: number | string | null;
  minimumTransactionAmount: number | string;
  startDate: string;
  endDate: string;
  usageLimit?: number | null;
  usagePerCustomer?: number | null;
  usedCount: number;
  status: 'ACTIVE' | 'INACTIVE';
  outlets: { outletId: string }[];
  products: { productId: string }[];
  categories: { category: string }[];
};

type Lookup = { id: string; name: string };

function dateTimeLocal(value?: string | Date) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function newCoupon(): Partial<Coupon> {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  return {
    discountType: 'PERCENTAGE',
    discountValue: 10,
    minimumTransactionAmount: 0,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    status: 'ACTIVE',
    outlets: [],
    products: [],
    categories: [],
  };
}

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [outlets, setOutlets] = useState<Lookup[]>([]);
  const [products, setProducts] = useState<Lookup[]>([]);
  const [editing, setEditing] = useState<Partial<Coupon> | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [couponRows, outletRows, productRows] = await Promise.all([
      api<Coupon[]>('/coupons'),
      api<Lookup[]>('/outlets'),
      api<Lookup[]>('/products'),
    ]);
    setCoupons(couponRows);
    setOutlets(outletRows);
    setProducts(productRows);
  }

  useEffect(() => {
    load().catch((loadError) => setError((loadError as Error).message));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    const form = new FormData(event.currentTarget);
    const body = {
      couponCode: String(form.get('couponCode') || '').trim().toUpperCase(),
      couponName: String(form.get('couponName') || '').trim(),
      discountType: form.get('discountType'),
      discountValue: Number(form.get('discountValue')),
      maxDiscountAmount: form.get('maxDiscountAmount')
        ? Number(form.get('maxDiscountAmount'))
        : null,
      minimumTransactionAmount: Number(form.get('minimumTransactionAmount') || 0),
      startDate: form.get('startDate'),
      endDate: form.get('endDate'),
      usageLimit: form.get('usageLimit') ? Number(form.get('usageLimit')) : null,
      usagePerCustomer: form.get('usagePerCustomer')
        ? Number(form.get('usagePerCustomer'))
        : null,
      outletIds: form.getAll('outletIds'),
      productIds: form.getAll('productIds'),
      categories: String(form.get('categories') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      status: form.get('status') || 'ACTIVE',
    };
    setSaving(true);
    setError('');
    try {
      await api(editing.id ? `/coupons/${editing.id}` : '/coupons', {
        method: editing.id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setEditing(null);
      await load();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-3xl font-black">Kupon &amp; promo</h2>
          <p className="text-slate-500">Atur insentif tanpa kehilangan kendali margin.</p>
        </div>
        <button
          onClick={() => {
            setError('');
            setEditing(newCoupon());
          }}
          className="btn-primary"
        >
          <Plus size={18} /> Tambah Baru
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {coupons.map((coupon) => (
          <article key={coupon.id} className="card overflow-hidden">
            <div className="flex items-center justify-between bg-ink p-5 text-white">
              <span className="font-mono text-lg font-black tracking-wider">
                {coupon.couponCode}
              </span>
              <Tag size={20} />
            </div>
            <div className="p-5">
              <h3 className="text-xl font-black">{coupon.couponName}</h3>
              <b className="mt-2 block text-2xl text-brand-700">
                {coupon.discountType === 'PERCENTAGE'
                  ? `${coupon.discountValue}%`
                  : rupiah(Number(coupon.discountValue))}
              </b>
              <p className="mt-2 text-sm text-slate-400">
                Min. {rupiah(Number(coupon.minimumTransactionAmount))} · Terpakai{' '}
                {coupon.usedCount}
                {coupon.usageLimit ? `/${coupon.usageLimit}` : ''}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {coupon.outlets.length ? `${coupon.outlets.length} outlet` : 'Semua outlet'} ·{' '}
                {coupon.products.length ? `${coupon.products.length} produk` : 'Semua produk'}
                {coupon.categories.length
                  ? ` · ${coupon.categories.map((row) => row.category).join(', ')}`
                  : ''}
              </p>
              <div className="mt-4 flex items-center justify-between">
                <span
                  className={`pill ${
                    coupon.status === 'ACTIVE'
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {coupon.status}
                </span>
                <span className="text-xs text-slate-400">
                  s/d {new Date(coupon.endDate).toLocaleDateString('id-ID')}
                </span>
              </div>
              <button
                onClick={() => {
                  setError('');
                  setEditing(coupon);
                }}
                className="mt-4 flex items-center gap-2 text-sm font-bold text-brand-600"
              >
                <Edit size={16} /> Edit kupon
              </button>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <CouponModal
          key={editing.id || 'new-coupon'}
          coupon={editing}
          outlets={outlets}
          products={products}
          saving={saving}
          onClose={() => setEditing(null)}
          onSubmit={save}
        />
      )}
    </div>
  );
}

function CouponModal({
  coupon,
  outlets,
  products,
  saving,
  onClose,
  onSubmit,
}: {
  coupon: Partial<Coupon>;
  outlets: Lookup[];
  products: Lookup[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const selectedOutlets = new Set((coupon.outlets || []).map((row) => row.outletId));
  const selectedProducts = new Set((coupon.products || []).map((row) => row.productId));

  return (
    <div
      data-back-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-auto bg-black/40 p-0 sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="section-title">{coupon.id ? 'Edit kupon' : 'Kupon baru'}</h3>
          <button data-back-close="true" onClick={onClose} className="rounded-xl p-2">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <Input name="couponCode" label="Kode kupon" defaultValue={coupon.couponCode} />
          <Input name="couponName" label="Nama kupon" defaultValue={coupon.couponName} />
          <label className="label">Tipe diskon</label>
          <select
            className="input mb-3"
            name="discountType"
            defaultValue={coupon.discountType || 'PERCENTAGE'}
          >
            <option value="PERCENTAGE">Persentase</option>
            <option value="NOMINAL">Nominal</option>
          </select>
          <Input name="discountValue" label="Nilai diskon" type="number" min="0.01" step="0.01" defaultValue={coupon.discountValue} />
          <Input name="maxDiscountAmount" label="Maksimum diskon (opsional)" type="number" min="0.01" step="0.01" defaultValue={coupon.maxDiscountAmount} optional />
          <Input name="minimumTransactionAmount" label="Minimum transaksi" type="number" min="0" step="0.01" defaultValue={coupon.minimumTransactionAmount ?? 0} />
          <Input name="usageLimit" label="Batas total penggunaan (opsional)" type="number" min="1" step="1" defaultValue={coupon.usageLimit} optional />
          <Input name="usagePerCustomer" label="Batas per pelanggan (opsional)" type="number" min="1" step="1" defaultValue={coupon.usagePerCustomer} optional />
          <Input name="startDate" label="Tanggal mulai" type="datetime-local" defaultValue={dateTimeLocal(coupon.startDate)} />
          <Input name="endDate" label="Tanggal selesai" type="datetime-local" defaultValue={dateTimeLocal(coupon.endDate)} />
          <label className="label">Status</label>
          <select className="input mb-3" name="status" defaultValue={coupon.status || 'ACTIVE'}>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
          <CheckList
            title="Outlet (kosong = semua)"
            name="outletIds"
            rows={outlets}
            selected={selectedOutlets}
          />
          <CheckList
            title="Produk (kosong = semua)"
            name="productIds"
            rows={products}
            selected={selectedProducts}
          />
          <label className="label mt-3">Kategori (pisahkan dengan koma)</label>
          <input
            className="input"
            name="categories"
            placeholder="Makanan, Minuman"
            defaultValue={(coupon.categories || []).map((row) => row.category).join(', ')}
          />
          <button disabled={saving} className="btn-primary mt-5 w-full disabled:opacity-50">
            {saving ? 'Menyimpan...' : coupon.id ? 'Simpan Perubahan' : 'Simpan Kupon'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Input({
  name,
  label,
  type = 'text',
  defaultValue,
  optional = false,
  min,
  step,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string | number | null;
  optional?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <div className="mb-3">
      <label className="label">{label}</label>
      <input
        className="input"
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        required={!optional}
        min={min}
        step={step}
      />
    </div>
  );
}

function CheckList({
  title,
  name,
  rows,
  selected,
}: {
  title: string;
  name: string;
  rows: Lookup[];
  selected: Set<string>;
}) {
  return (
    <div className="mt-3">
      <label className="label">{title}</label>
      <div className="max-h-36 space-y-1 overflow-auto rounded-xl border p-2">
        {rows.map((row) => (
          <label key={row.id} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              name={name}
              value={row.id}
              defaultChecked={selected.has(row.id)}
            />
            {row.name}
          </label>
        ))}
      </div>
    </div>
  );
}
