type ToastType = 'success' | 'error';

function ensureToastRoot() {
  let root = document.getElementById('foru-toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'foru-toast-root';
    root.className = 'fixed right-4 top-4 z-[9999] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 pointer-events-none';
    document.body.appendChild(root);
  }
  return root;
}

export function showToast(message: string, type: ToastType = 'success') {
  if (typeof document === 'undefined') return;
  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = [
    'pointer-events-auto rounded-2xl px-4 py-3 text-sm font-bold shadow-xl ring-1 transition',
    type === 'success'
      ? 'bg-brand-600 text-white ring-brand-700/20'
      : 'bg-red-600 text-white ring-red-700/20'
  ].join(' ');
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    window.setTimeout(() => el.remove(), 180);
  }, 2800);
}

export const toast = {
  success: (message: string) => showToast(message, 'success'),
  error: (message: string) => showToast(message, 'error')
};
