const apiUrl = import.meta.env.VITE_API_URL;

if (!apiUrl) {
  throw new Error('VITE_API_URL is missing');
}

console.log('API URL =', apiUrl);

export const API = apiUrl;
export const SERVER_UNAVAILABLE_MESSAGE = 'Server tidak tersedia. Silakan cek koneksi atau backend.';
export const SESSION_EXPIRED_EVENT = 'foru:session-expired';
const PUBLIC_AUTH_PATHS = new Set(['/auth/login', '/auth/register-business']);

export function clearAuthSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('outletId');
  localStorage.removeItem('foru:business_id');
  localStorage.removeItem('foru:must_select_outlet');
}

export function handleUnauthorizedSession(message = 'Sesi tidak valid atau telah berakhir') {
  clearAuthSession();
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));
}

export type User = {
  id: string;
  businessId?: string;
  business?: {
    id: string;
    name: string;
    code?: string;
    status?: string;
  };
  membership?: {
    id: string;
    businessId: string;
    role: 'OWNER' | 'SUPERVISOR' | 'CASHIER';
    status: string;
  };
  name: string;
  role: 'OWNER' | 'SUPERVISOR' | 'CASHIER';
  outletIds: string[];
  inventoryPermissions?: string[];
  assignedWarehouseId?: string | null;
};

export async function api<T = any>(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');

  let res: Response;
  try {
    res = await fetch(API + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(SERVER_UNAVAILABLE_MESSAGE);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && !PUBLIC_AUTH_PATHS.has(path)) handleUnauthorizedSession(data.message);
    throw new Error(data.message || 'Permintaan gagal');
  }

  return data as T;
}

export const rupiah = (n: number | string = 0) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n));

export const dt = (s: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s));
