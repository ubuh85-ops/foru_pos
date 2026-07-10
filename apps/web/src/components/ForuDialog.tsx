import { AlertTriangle, BadgeDollarSign, FileText, Percent, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

export type ForuDialogTone = 'danger' | 'warning' | 'success' | 'payment' | 'info';
export type DiscountKind = 'PERCENTAGE' | 'NOMINAL';

const toneClass: Record<ForuDialogTone, string> = {
  danger: 'bg-red-50 text-red-600',
  warning: 'bg-amber-50 text-amber-600',
  success: 'bg-green-50 text-green-600',
  payment: 'bg-green-50 text-green-600',
  info: 'bg-brand-50 text-brand-700'
};

function ToneIcon({ tone }: { tone: ForuDialogTone }) {
  if (tone === 'danger') return <Trash2 size={26} />;
  if (tone === 'warning') return <AlertTriangle size={28} />;
  if (tone === 'success') return <FileText size={26} />;
  if (tone === 'payment') return <BadgeDollarSign size={28} />;
  return <AlertTriangle size={26} />;
}

export function ForuDialogShell({
  tone = 'info',
  title,
  description,
  onClose,
  children,
  footer
}: {
  tone?: ForuDialogTone;
  title: string;
  description?: string;
  onClose?: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
    <div className="w-full max-w-[21rem] rounded-[1.5rem] bg-white p-4 shadow-2xl ring-1 ring-slate-200 sm:max-w-xl sm:rounded-[1.75rem] sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl sm:h-12 sm:w-12 ${toneClass[tone]}`}>
            <ToneIcon tone={tone} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">{title}</h2>
            {description && <p className="mt-1 text-xs font-medium leading-5 text-slate-500 sm:text-sm sm:leading-6">{description}</p>}
          </div>
        </div>
        {onClose && <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-50">
          <X size={22} />
        </button>}
      </div>
      {children}
      <div className="mt-5 flex items-center justify-end gap-2 sm:mt-6 sm:gap-3">{footer}</div>
    </div>
  </div>;
}

export function ConfirmDialog({
  tone = 'danger',
  title,
  description,
  detail,
  cancelText = 'Batal',
  confirmText = 'OK',
  onCancel,
  onConfirm
}: {
  tone?: ForuDialogTone;
  title: string;
  description?: string;
  detail?: string;
  cancelText?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <ForuDialogShell
    tone={tone}
    title={title}
    description={description}
    onClose={onCancel}
    footer={<>
      <button onClick={onCancel} className="h-11 min-w-24 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 sm:h-12 sm:min-w-28 sm:px-5">{cancelText}</button>
      <button onClick={onConfirm} className="h-11 min-w-24 rounded-xl bg-brand-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-600 sm:h-12 sm:min-w-28 sm:px-5">{confirmText}</button>
    </>}
  >
    {detail && <div className="rounded-2xl bg-slate-50 p-4 text-center text-sm font-medium text-slate-600">{detail}</div>}
  </ForuDialogShell>;
}

export function TextInputDialog({
  title,
  description,
  label,
  defaultValue = '',
  placeholder,
  onCancel,
  onSubmit
}: {
  title: string;
  description?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return <ForuDialogShell
    tone="info"
    title={title}
    description={description}
    onClose={onCancel}
    footer={<>
      <button onClick={onCancel} className="h-11 min-w-24 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 sm:h-12 sm:min-w-28 sm:px-5">Batal</button>
      <button onClick={() => onSubmit(value)} className="h-11 min-w-24 rounded-xl bg-brand-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-600 sm:h-12 sm:min-w-28 sm:px-5">Simpan</button>
    </>}
  >
    <label className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
    <textarea className="input min-h-28 w-full rounded-xl" value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} autoFocus />
  </ForuDialogShell>;
}

export function DiscountDialog({
  title = 'Diskon Transaksi',
  description = 'Pilih jenis diskon dan isi nilainya',
  initialType = 'PERCENTAGE',
  initialValue = 0,
  onCancel,
  onSubmit
}: {
  title?: string;
  description?: string;
  initialType?: DiscountKind;
  initialValue?: number;
  onCancel: () => void;
  onSubmit: (discount: { type: DiscountKind; value: number }) => void;
}) {
  const [type, setType] = useState<DiscountKind>(initialType);
  const [value, setValue] = useState(String(initialValue || ''));
  const numeric = Number(value || 0);
  const invalid = Number.isNaN(numeric) || numeric < 0 || (type === 'PERCENTAGE' && numeric > 100);

  return <ForuDialogShell
    tone="info"
    title={title}
    description={description}
    onClose={onCancel}
    footer={<>
      <button onClick={onCancel} className="h-11 min-w-24 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 sm:h-12 sm:min-w-28 sm:px-5">Batal</button>
      <button disabled={invalid} onClick={() => onSubmit({ type, value: numeric })} className="h-11 min-w-24 rounded-xl bg-brand-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-600 disabled:bg-slate-300 sm:h-12 sm:min-w-28 sm:px-5">OK</button>
    </>}
  >
    <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 sm:bg-transparent sm:p-0">
      <button onClick={() => setType('PERCENTAGE')} className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold transition sm:h-12 sm:text-sm ${type === 'PERCENTAGE' ? 'bg-brand-500 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 sm:bg-white'}`}>
        <Percent size={18} /> Persentase<span className="hidden sm:inline"> (%)</span>
      </button>
      <button onClick={() => setType('NOMINAL')} className={`flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold transition sm:h-12 sm:text-sm ${type === 'NOMINAL' ? 'bg-brand-500 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 sm:bg-white'}`}>
        <BadgeDollarSign size={18} /> Nominal<span className="hidden sm:inline"> (Rp)</span>
      </button>
    </div>
    <label className="mb-2 block text-sm font-semibold text-slate-700">Nilai diskon</label>
    <div className="relative">
      <input className={`input h-14 w-full rounded-xl pr-14 text-lg font-semibold ${invalid ? 'border-red-300 focus:border-red-500' : ''}`} type="number" min="0" max={type === 'PERCENTAGE' ? 100 : undefined} value={value} onChange={event => setValue(event.target.value)} autoFocus />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-700">{type === 'PERCENTAGE' ? '%' : 'Rp'}</span>
    </div>
    <p className={`mt-2 text-sm font-medium ${invalid ? 'text-red-600' : 'text-slate-400'}`}>
      {type === 'PERCENTAGE' ? 'Masukkan nilai 0 - 100' : 'Masukkan nominal diskon'}
    </p>
  </ForuDialogShell>;
}
