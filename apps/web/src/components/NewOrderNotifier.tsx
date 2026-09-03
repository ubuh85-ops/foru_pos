import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';
import { api, API } from '../api';
import { useOutlet } from '../OutletContext';
import { getOrderNotificationSettings, ORDER_NOTIFICATION_SETTINGS_CHANGED, type OrderNotificationSettings } from '../orderNotificationSettings';

type OpenOrder = { orderId: string; orderNumber?: string | null; outletId: string; customerName?: string | null; orderType?: string | null; totalItems?: number; grandTotal?: number; createdAt?: string };
type IncomingOrder = OpenOrder & { repeats: number };
const POLL_INTERVAL_MS = 10_000;
const REPEAT_INTERVAL_MS = 10_000;
const MAX_REPEATS = 3;

function playNewOrderSound(soundName: string) {
  if (typeof window === 'undefined') return;
  const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  const context = new AudioCtor();
  const tones = soundName === 'bell' ? [[659.25, 0], [783.99, 0.22]] : soundName === 'chime' ? [[880, 0], [1174.66, 0.16]] : [[880, 0], [1174.66, 0.18]];
  tones.forEach(([frequency, start]) => {
    const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + start); gain.gain.setValueAtTime(0.001, context.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + start + 0.02); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + start + 0.2);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(context.currentTime + start); oscillator.stop(context.currentTime + start + 0.25);
  });
  window.setTimeout(() => context.close().catch(() => {}), 700);
}

function socketOrigin() { try { return new URL(API).origin; } catch { return window.location.origin; } }

export default function NewOrderNotifier() {
  const navigate = useNavigate(); const { selectedOutletId } = useOutlet();
  const [incoming, setIncoming] = useState<IncomingOrder[]>([]);
  const knownOrderIdsRef = useRef<Set<string>>(new Set()); const baselineReadyRef = useRef(false); const repeatTimerRef = useRef<number | undefined>(undefined);
  const soundAllowedRef = useRef(false); const soundSettingsRef = useRef<OrderNotificationSettings>(getOrderNotificationSettings());

  const announce = useCallback((orders: OpenOrder[], playSound = true) => {
    const unique = orders.filter(order => order.outletId === selectedOutletId && !knownOrderIdsRef.current.has(order.orderId)); if (!unique.length) return;
    unique.forEach(order => knownOrderIdsRef.current.add(order.orderId));
    setIncoming(current => { const ids = new Set(current.map(order => order.orderId)); return [...current, ...unique.filter(order => !ids.has(order.orderId)).map(order => ({ ...order, repeats: 1 }))].slice(-5); });
    window.dispatchEvent(new CustomEvent('foru:web-order-count', { detail: { delta: unique.length } }));
    const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    if (playSound && !nativeAndroid && soundAllowedRef.current && soundSettingsRef.current.soundEnabled) { try { playNewOrderSound(soundSettingsRef.current.soundName); } catch { /* ignore browser audio errors */ } }
  }, [selectedOutletId]);

  const acknowledge = useCallback((orderId: string, open = false) => { setIncoming(current => current.filter(order => order.orderId !== orderId)); window.dispatchEvent(new CustomEvent('foru:web-order-count', { detail: { delta: -1 } })); if (open) navigate(`/orders/${orderId}`); }, [navigate]);

  useEffect(() => {
    const enableSound = () => { soundAllowedRef.current = true; window.removeEventListener('pointerdown', enableSound); window.removeEventListener('keydown', enableSound); window.removeEventListener('touchstart', enableSound); };
    window.addEventListener('pointerdown', enableSound, { once: true }); window.addEventListener('keydown', enableSound, { once: true }); window.addEventListener('touchstart', enableSound, { once: true });
    const onSettingsChanged = (event: Event) => { soundSettingsRef.current = (event as CustomEvent<OrderNotificationSettings>).detail; };
    window.addEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onSettingsChanged);
    return () => { window.removeEventListener('pointerdown', enableSound); window.removeEventListener('keydown', enableSound); window.removeEventListener('touchstart', enableSound); window.removeEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onSettingsChanged); };
  }, []);

  useEffect(() => {
    baselineReadyRef.current = false; knownOrderIdsRef.current = new Set(); setIncoming([]);
    if (!selectedOutletId || !localStorage.getItem('token')) return;
    const socket = io(socketOrigin(), { auth: { token: localStorage.getItem('token') }, transports: ['websocket', 'polling'], reconnection: true });
    socket.on('connect', () => socket.emit('outlet:join', { outletId: selectedOutletId })); socket.on('web-order:new', (order: OpenOrder) => announce(order ? [order] : []));
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const orders = await api<Array<{ id: string; orderNumber?: string; customerName?: string; outletId: string; orderType?: string; grandTotal?: number; createdAt?: string; items?: { qty: number }[] }>>(`/orders/open?outletId=${encodeURIComponent(selectedOutletId)}&_=${Date.now()}`);
        const nextIds = new Set(orders.map(order => order.id));
        if (!baselineReadyRef.current) { knownOrderIdsRef.current = nextIds; baselineReadyRef.current = true; return; }
        announce(orders.filter(order => !knownOrderIdsRef.current.has(order.id)).map(order => ({ orderId: order.id, orderNumber: order.orderNumber, outletId: order.outletId, customerName: order.customerName, orderType: order.orderType, grandTotal: order.grandTotal, createdAt: order.createdAt, totalItems: order.items?.reduce((sum, item) => sum + item.qty, 0) })));
        knownOrderIdsRef.current = new Set([...knownOrderIdsRef.current, ...nextIds]);
      } catch { /* notification failure must not interrupt cashier flow */ }
    };
    void poll(); const timer = window.setInterval(poll, POLL_INTERVAL_MS); return () => { window.clearInterval(timer); socket.disconnect(); };
  }, [announce, selectedOutletId]);

  useEffect(() => {
    if (!incoming.length || repeatTimerRef.current) return;
    repeatTimerRef.current = window.setInterval(() => { setIncoming(current => { const repeatable = current.filter(order => order.repeats < MAX_REPEATS); if (!repeatable.length) { if (repeatTimerRef.current) window.clearInterval(repeatTimerRef.current); repeatTimerRef.current = undefined; return current; } const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'; if (!nativeAndroid && soundAllowedRef.current && soundSettingsRef.current.soundEnabled) { try { playNewOrderSound(soundSettingsRef.current.soundName); } catch { /* ignore */ } } return current.map(order => order.repeats < MAX_REPEATS ? { ...order, repeats: order.repeats + 1 } : order); }); }, REPEAT_INTERVAL_MS);
    return () => { if (repeatTimerRef.current && !incoming.length) window.clearInterval(repeatTimerRef.current); };
  }, [incoming.length]);

  if (!incoming.length) return null; const first = incoming[0];
  return <div className="fixed right-4 top-4 z-[9998] w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-brand-200 bg-white p-4 shadow-2xl" role="status" aria-live="assertive"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-brand-600">Order web baru</p><h3 className="mt-1 text-base font-black text-ink">{first.orderNumber || 'Open Bill'}</h3><p className="text-sm text-slate-500">{first.customerName || 'Walk In'} · {first.totalItems || 0} item</p></div><button type="button" onClick={() => acknowledge(first.orderId)} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-brand-50" aria-label="Tutup notifikasi">×</button></div>{incoming.length > 1 && <p className="mt-2 text-xs font-bold text-brand-700">+{incoming.length - 1} order baru lainnya</p>}<div className="mt-3 flex gap-2"><button type="button" onClick={() => acknowledge(first.orderId, true)} className="btn-primary flex-1">Lihat Order</button><button type="button" onClick={() => acknowledge(first.orderId)} className="btn-soft">Tutup</button></div></div>;
}
