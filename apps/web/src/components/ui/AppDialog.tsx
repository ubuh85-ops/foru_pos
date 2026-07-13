import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

export type AppDialogTone = 'info' | 'success' | 'warning' | 'danger';

const toneIcon: Record<AppDialogTone, ReactNode> = {
  info: <Info size={24} />,
  success: <CheckCircle2 size={24} />,
  warning: <AlertTriangle size={24} />,
  danger: <AlertTriangle size={24} />
};

const toneClass: Record<AppDialogTone, string> = {
  info: 'bg-brand-50 text-brand-700',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700'
};

type DialogButton = {
  label: string;
  onClick?: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
};

export function AppDialog({
  open = true,
  tone = 'info',
  title,
  description,
  children,
  buttons,
  onClose
}: {
  open?: boolean;
  tone?: AppDialogTone;
  title: string;
  description?: string;
  children?: ReactNode;
  buttons?: DialogButton[];
  onClose?: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('textarea, input, select, button:not([disabled])');
      first?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
      if (event.key !== 'Tab') return;
      const focusables = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return <div data-back-modal="true" className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-[2px]">
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] overflow-y-auto rounded-[24px] bg-white p-5 shadow-2xl ring-1 ring-slate-200 sm:p-6"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${toneClass[tone]}`}>
            {toneIcon[tone]}
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-sm font-medium leading-6 text-slate-500">{description}</p>}
          </div>
        </div>
        {onClose && <button data-back-close="true" type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-50" aria-label="Tutup dialog">
          <X size={22} />
        </button>}
      </div>
      {children}
      {!!buttons?.length && <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-end">
        {buttons.map((button, index) => <button
          key={`${button.label}-${index}`}
          data-back-close={button.variant === 'secondary' ? 'true' : undefined}
          type={button.type || 'button'}
          disabled={button.disabled || button.loading}
          onClick={button.onClick}
          className={[
            'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:min-w-32',
            button.variant === 'danger' ? 'bg-red-700 text-white hover:bg-red-800' :
              button.variant === 'secondary' ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' :
                'bg-brand-500 text-white hover:bg-brand-600'
          ].join(' ')}
        >
          {button.loading && <Loader2 className="animate-spin" size={16} />}
          {button.label}
        </button>)}
      </div>}
    </div>
  </div>;
}

function mountDialog(render: (finish: () => void) => ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const finish = () => {
    root.unmount();
    host.remove();
  };
  root.render(<>{render(finish)}</>);
}

export function appAlert(message: string, options?: { title?: string; tone?: AppDialogTone }) {
  return new Promise<void>(resolve => {
    mountDialog(close => <AppDialog
      title={options?.title || (options?.tone === 'danger' ? 'Terjadi kesalahan' : 'Informasi')}
      description={message}
      tone={options?.tone || 'info'}
      onClose={() => { close(); resolve(); }}
      buttons={[{ label: 'OK', variant: 'primary', onClick: () => { close(); resolve(); } }]}
    />);
  });
}

export function appConfirm(message: string, options?: { title?: string; tone?: AppDialogTone; confirmText?: string; cancelText?: string; danger?: boolean }) {
  return new Promise<boolean>(resolve => {
    mountDialog(close => {
      const done = (value: boolean) => { close(); resolve(value); };
      return <AppDialog
        title={options?.title || 'Konfirmasi'}
        description={message}
        tone={options?.tone || (options?.danger ? 'danger' : 'warning')}
        onClose={() => done(false)}
        buttons={[
          { label: options?.cancelText || 'Batal', variant: 'secondary', onClick: () => done(false) },
          { label: options?.confirmText || 'OK', variant: options?.danger ? 'danger' : 'primary', onClick: () => done(true) }
        ]}
      />;
    });
  });
}

export function appPrompt(message: string, defaultValue = '', options?: { title?: string; label?: string; placeholder?: string; multiline?: boolean; minLength?: number; maxLength?: number }) {
  return new Promise<string | null>(resolve => {
    mountDialog(close => <PromptDialog
      title={options?.title || message}
      description={options?.title ? message : undefined}
      label={options?.label || 'Input'}
      defaultValue={defaultValue}
      placeholder={options?.placeholder}
      multiline={options?.multiline}
      minLength={options?.minLength}
      maxLength={options?.maxLength}
      onCancel={() => { close(); resolve(null); }}
      onSubmit={value => { close(); resolve(value); }}
    />);
  });
}

function PromptDialog({
  title,
  description,
  label,
  defaultValue,
  placeholder,
  multiline,
  minLength = 0,
  maxLength,
  onCancel,
  onSubmit
}: {
  title: string;
  description?: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const trimmed = value.trim();
  const invalid = trimmed.length < minLength || (maxLength != null && trimmed.length > maxLength);
  return <AppDialog
    title={title}
    description={description}
    tone="info"
    onClose={onCancel}
    buttons={[
      { label: 'Batal', variant: 'secondary', onClick: onCancel },
      { label: 'OK', variant: 'primary', disabled: invalid, onClick: () => onSubmit(trimmed) }
    ]}
  >
    <label className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
    {multiline ? <textarea className="input min-h-28 w-full resize-y rounded-xl" value={value} maxLength={maxLength} onChange={event => setValue(event.target.value)} placeholder={placeholder} autoFocus /> :
      <input className="input w-full rounded-xl" value={value} maxLength={maxLength} onChange={event => setValue(event.target.value)} placeholder={placeholder} autoFocus />}
    {invalid && <p className="mt-2 text-sm font-semibold text-red-600">{trimmed ? `Minimal ${minLength} karakter dan maksimal ${maxLength || '-'} karakter.` : 'Input wajib diisi.'}</p>}
  </AppDialog>;
}

