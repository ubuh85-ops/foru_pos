import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from '../api';
import { useOutlet } from '../OutletContext';
import { getOrderNotificationSettings, ORDER_NOTIFICATION_SETTINGS_CHANGED, type OrderNotificationSettings } from '../orderNotificationSettings';

type OpenOrder = {
  id: string;
  orderNumber?: string | null;
  customerName?: string | null;
};

const POLL_INTERVAL_MS = 10_000;

function showPassiveOrderToast(message: string) {
  if (typeof document === 'undefined') return;
  let root = document.getElementById('foru-order-toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'foru-order-toast-root';
    root.className = 'fixed right-4 top-4 z-[9998] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 pointer-events-none';
    document.body.appendChild(root);
  }

  const el = document.createElement('div');
  el.className = [
    'pointer-events-auto rounded-2xl px-4 py-3 text-sm font-black shadow-xl ring-1 transition',
    'bg-brand-600 text-white ring-brand-700/20'
  ].join(' ');
  el.textContent = message;
  root.appendChild(el);

  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    window.setTimeout(() => el.remove(), 180);
  }, 5_000);
}

function playNewOrderSound(soundName: string) {
  if (typeof window === 'undefined') return;
  const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;

  const context = new AudioCtor();
  const playTone = (start: number, frequency: number, duration: number) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
    gain.gain.setValueAtTime(0.001, context.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime + start);
    oscillator.stop(context.currentTime + start + duration);
  };

  if (soundName === 'bell') {
    playTone(0, 659.25, 0.18);
    playTone(0.22, 783.99, 0.28);
  } else if (soundName === 'chime') {
    playTone(0, 880, 0.12);
    playTone(0.16, 1174.66, 0.2);
  } else {
    playTone(0, 880, 0.14);
    playTone(0.18, 1174.66, 0.18);
  }
  window.setTimeout(() => context.close().catch(() => {}), 700);
}

export default function NewOrderNotifier() {
  const { selectedOutletId } = useOutlet();
  const baselineReadyRef = useRef(false);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const soundAllowedRef = useRef(false);
  const soundSettingsRef = useRef<OrderNotificationSettings>(getOrderNotificationSettings());

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      soundSettingsRef.current = (event as CustomEvent<OrderNotificationSettings>).detail;
    };
    window.addEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onSettingsChanged);
    return () => window.removeEventListener(ORDER_NOTIFICATION_SETTINGS_CHANGED, onSettingsChanged);
  }, []);

  useEffect(() => {
    const enableSound = () => {
      soundAllowedRef.current = true;
      window.removeEventListener('pointerdown', enableSound);
      window.removeEventListener('keydown', enableSound);
      window.removeEventListener('touchstart', enableSound);
    };
    window.addEventListener('pointerdown', enableSound, { once: true });
    window.addEventListener('keydown', enableSound, { once: true });
    window.addEventListener('touchstart', enableSound, { once: true });
    return () => {
      window.removeEventListener('pointerdown', enableSound);
      window.removeEventListener('keydown', enableSound);
      window.removeEventListener('touchstart', enableSound);
    };
  }, []);

  useEffect(() => {
    baselineReadyRef.current = false;
    knownOrderIdsRef.current = new Set();

    if (!selectedOutletId || !localStorage.getItem('token')) return;

    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const orders = await api<OpenOrder[]>(`/orders/open?outletId=${selectedOutletId}&_=${Date.now()}`);
        if (cancelled) return;

        const nextIds = new Set(orders.map(order => order.id));
        if (!baselineReadyRef.current) {
          knownOrderIdsRef.current = nextIds;
          baselineReadyRef.current = true;
          return;
        }

        const newOrders = orders.filter(order => !knownOrderIdsRef.current.has(order.id));
        knownOrderIdsRef.current = nextIds;

        if (!newOrders.length) return;

        // Android uses the native FCM/LocalNotifications channel so the
        // device-selected sound is respected. Do not also play the browser
        // Web Audio tone, otherwise the popup tone masks/duplicates it.
        const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
        if (!isNativeAndroid && soundAllowedRef.current && soundSettingsRef.current.soundEnabled) {
          try { playNewOrderSound(soundSettingsRef.current.soundName); } catch { /* ignore audio device/browser issues */ }
        }

        const first = newOrders[0];
        const message = newOrders.length === 1
          ? `Order baru masuk: ${first.orderNumber || 'Open Bill'} • ${first.customerName || 'Walk In'}`
          : `${newOrders.length} order baru masuk.`;
        showPassiveOrderToast(message);
      } catch {
        // Silent by design: order notification must never disturb cashier flow.
      } finally {
        inFlight = false;
      }
    };

    poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedOutletId]);

  return null;
}
