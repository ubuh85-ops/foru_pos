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
  if (type === 'success') {
    showSuccessNotice(message);
    return;
  }
  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = [
    'pointer-events-auto rounded-2xl px-4 py-3 text-sm font-bold shadow-xl ring-1 transition',
    'bg-red-600 text-white ring-red-700/20'
  ].join(' ');
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    window.setTimeout(() => el.remove(), 180);
  }, 2800);
}

export function showSuccessNotice(message: string) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('foru-success-notice');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'foru-success-notice';
  overlay.className = 'fixed inset-0 z-[10000] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]';

  const card = document.createElement('div');
  card.className = 'w-full max-w-[20rem] rounded-[1.5rem] bg-white p-5 text-center shadow-2xl ring-1 ring-slate-200 sm:max-w-sm sm:rounded-[1.75rem] sm:p-6';

  const icon = document.createElement('div');
  icon.className = 'mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-green-50 text-2xl font-black text-green-600 sm:mb-4 sm:h-14 sm:w-14 sm:text-3xl';
  icon.textContent = '✓';
  icon.textContent = '✓';

  icon.textContent = String.fromCharCode(10003);

  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-slate-900 sm:text-xl';
  title.textContent = 'Berhasil';

  const body = document.createElement('p');
  body.className = 'mt-2 text-sm font-medium leading-5 text-slate-500 sm:leading-6';
  body.textContent = message;

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'mt-5 h-11 w-full rounded-xl bg-brand-500 px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-600 sm:mt-6 sm:h-12';
  ok.textContent = 'OK';
  ok.onclick = () => overlay.remove();

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(ok);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  ok.focus();
}

export const toast = {
  success: (message: string) => showToast(message, 'success'),
  error: (message: string) => showToast(message, 'error')
};
