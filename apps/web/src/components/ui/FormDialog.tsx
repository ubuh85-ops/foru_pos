import { useState } from 'react';
import { AppDialog } from './AppDialog';
import { showToast } from '../../toast';

const cancelReasons = [
  'Pelanggan membatalkan',
  'Salah input',
  'Produk tidak tersedia',
  'Pesanan duplikat',
  'Lainnya'
];

export function CancelOrderDialog({
  open,
  onClose,
  onSubmit
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const trimmed = reason.trim();
  const error = trimmed.length === 0 ? 'Alasan pembatalan wajib diisi.' : trimmed.length < 3 ? 'Alasan minimal 3 karakter.' : trimmed.length > 250 ? 'Alasan maksimal 250 karakter.' : '';

  async function submit() {
    if (error || submitting) return;
    try {
      setSubmitting(true);
      await onSubmit(trimmed);
      showToast('Order berhasil dibatalkan.', 'success');
      onClose();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return <AppDialog
    open={open}
    tone="danger"
    title="Batalkan Order"
    description="Masukkan alasan pembatalan order."
    onClose={submitting ? undefined : onClose}
    buttons={[
      { label: 'Kembali', variant: 'secondary', disabled: submitting, onClick: onClose },
      { label: submitting ? 'Membatalkan...' : 'Batalkan Order', variant: 'danger', loading: submitting, disabled: !!error, onClick: submit }
    ]}
  >
    <div className="mb-4 flex flex-wrap gap-2">
      {cancelReasons.map(option => <button key={option} type="button" onClick={() => setReason(option)} className={`min-h-10 rounded-full border px-3 text-xs font-bold ${reason === option ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
        {option}
      </button>)}
    </div>
    <label className="mb-2 block text-sm font-semibold text-slate-700">Alasan Pembatalan</label>
    <textarea
      value={reason}
      onChange={event => setReason(event.target.value)}
      maxLength={250}
      className="input min-h-32 w-full resize-y rounded-xl"
      placeholder="Contoh: pelanggan membatalkan pesanan"
      autoFocus
    />
    <div className="mt-2 flex items-center justify-between gap-3">
      <p className={`text-sm font-semibold ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || ' '}</p>
      <span className="shrink-0 text-xs font-semibold text-slate-400">{trimmed.length}/250</span>
    </div>
  </AppDialog>;
}

export { appPrompt } from './AppDialog';

