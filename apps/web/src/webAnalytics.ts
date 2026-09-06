import { API } from './api';

export type WebAttribution = { visitorId: string; sessionId: string; source: string };
type Session = WebAttribution & { lastSeen: number };
const sessions = new Map<string, Session>();
let memoryVisitor: string | undefined;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
function secureId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
export function webAttribution(businessSlug: string, outletSlug: string): WebAttribution | undefined {
  try {
    let visitorId = memoryVisitor;
    try {
      const stored = localStorage.getItem('foru_web_visitor_id');
      if (validId(stored)) visitorId = stored;
    } catch { /* Storage may be disabled. Keep a document-local identity. */ }
    visitorId ||= `foru_web_${secureId()}`;
    memoryVisitor = visitorId;
    try { localStorage.setItem('foru_web_visitor_id', visitorId); } catch { /* Non-blocking. */ }
    const key = `foru_web_session:${encodeURIComponent(businessSlug)}:${encodeURIComponent(outletSlug)}`;
    let session = sessions.get(key);
    if (!session) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(key) || 'null') as Session | null;
        if (stored && validId(stored.visitorId) && validId(stored.sessionId) && typeof stored.source === 'string' && stored.source.length <= 50 && Number.isFinite(stored.lastSeen)) session = stored;
      } catch { /* Invalid or unavailable storage starts a new session. */ }
    }
    const now = Date.now();
    if (!session || session.visitorId !== visitorId || now - session.lastSeen >= 30 * 60_000 || session.lastSeen > now) {
      const source = (new URLSearchParams(window.location.search).get('src') || 'direct').trim().toLowerCase();
      session = { visitorId, sessionId: secureId(), source: ['qr', 'whatsapp', 'instagram', 'table', 'flyer', 'direct'].includes(source) ? source : 'other', lastSeen: now };
    }
    session.lastSeen = now;
    sessions.set(key, session);
    try { sessionStorage.setItem(key, JSON.stringify(session)); } catch { /* Memory fallback. */ }
    return { visitorId, sessionId: session.sessionId, source: session.source };
  } catch { return undefined; }
}

export function trackWebEvent(businessSlug: string, outletSlug: string, eventType: 'PAGE_VIEW' | 'ADD_TO_CART', productId?: string) {
  try {
    const attribution = webAttribution(businessSlug, outletSlug);
    if (!attribution) return;
    void fetch(`${API}/public/web-analytics/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ ...attribution, businessSlug, outletSlug, eventType, productId, eventId: secureId() }),
    }).catch(() => {});
  } catch { /* Analytics must never interrupt ordering. */ }
}
