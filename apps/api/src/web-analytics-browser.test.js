import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../web/src/api', () => ({ API: 'http://analytics.test/api' }));
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('window', { location: { search: '?src=qr' } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const load = () => import('../../web/src/webAnalytics.ts');
describe('anonymous browser tracking', () => {
  it('keeps a visitor across reloads while each page view has a new event ID', async () => {
    let analytics = await load();
    const first = analytics.webAttribution('foru', 'huis');
    analytics.trackWebEvent('foru', 'huis', 'PAGE_VIEW');
    vi.resetModules(); analytics = await load();
    expect(analytics.webAttribution('foru', 'huis')).toEqual(first);
    analytics.trackWebEvent('foru', 'huis', 'PAGE_VIEW');
    const bodies = fetch.mock.calls.map(([, request]) => JSON.parse(request.body));
    expect(bodies[0].visitorId).toBe(bodies[1].visitorId);
    expect(bodies[0].eventId).not.toBe(bodies[1].eventId);
  });
  it('preserves the first source for later cart and order attribution', async () => {
    const analytics = await load();
    const first = analytics.webAttribution('foru', 'huis');
    window.location.search = '?src=instagram';
    analytics.trackWebEvent('foru', 'huis', 'ADD_TO_CART', 'product_a');
    expect(analytics.webAttribution('foru', 'huis')).toEqual(first);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ source: 'qr', productId: 'product_a', sessionId: first.sessionId });
  });
  it('isolates sessions and attribution across outlets', async () => {
    const analytics = await load();
    const first = analytics.webAttribution('foru', 'huis');
    window.location.search = '?src=whatsapp';
    const second = analytics.webAttribution('foru', 'lrt');
    expect(second.visitorId).toBe(first.visitorId);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.source).toBe('whatsapp');
  });
  it('starts a new session after 30 minutes of inactivity', async () => {
    vi.useFakeTimers();
    const analytics = await load();
    const first = analytics.webAttribution('foru', 'huis');
    vi.advanceTimersByTime(30 * 60_000);
    window.location.search = '';
    const second = analytics.webAttribution('foru', 'huis');
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.visitorId).toBe(first.visitorId);
    expect(second.source).toBe('direct');
  });
  it('uses stable memory fallback when storage is unavailable', async () => {
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    vi.stubGlobal('localStorage', blocked); vi.stubGlobal('sessionStorage', blocked);
    const analytics = await load();
    const first = analytics.webAttribution('foru', 'huis');
    expect(first.visitorId).toMatch(/^foru_web_[0-9a-f]{32}$/);
    expect(analytics.webAttribution('foru', 'huis')).toEqual(first);
  });
  it('never waits for a tracking request and swallows network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const analytics = await load();
    expect(analytics.trackWebEvent('foru', 'huis', 'ADD_TO_CART', 'product_a')).toBeUndefined();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('tolerates unavailable secure randomness', async () => {
    vi.stubGlobal('crypto', undefined);
    const analytics = await load();
    expect(analytics.webAttribution('foru', 'huis')).toBeUndefined();
    expect(() => analytics.trackWebEvent('foru', 'huis', 'PAGE_VIEW')).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
