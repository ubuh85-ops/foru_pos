import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useOutlet } from '../OutletContext';

const TOKEN_KEY = 'foru:android_push_token';
const allowedRoute = /^\/orders(?:\/preorder-recap|\/[A-Za-z0-9_-]+)$/;

export async function deactivateAndroidOrderPush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || !localStorage.getItem('token')) return;
  await api('/push-devices/current', { method: 'DELETE', body: JSON.stringify({ token }) });
}

export default function AndroidOrderPush() {
  const navigate = useNavigate();
  const { selectedOutletId, setSelectedOutletId } = useOutlet();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    let active = true;
    let registrationHandle: { remove: () => Promise<void> } | undefined;
    let errorHandle: { remove: () => Promise<void> } | undefined;
    let actionHandle: { remove: () => Promise<void> } | undefined;
    let receivedHandle: { remove: () => Promise<void> } | undefined;
    let localActionHandle: { remove: () => Promise<void> } | undefined;

    const openNotification = (data: Record<string, unknown>) => {
      const outletId = typeof data.outletId === 'string' ? data.outletId : '';
      const route = typeof data.route === 'string' && allowedRoute.test(data.route) ? data.route : '/orders';
      if (outletId) setSelectedOutletId(outletId);
      navigate(route);
    };

    const registerToken = async (token: string) => {
      localStorage.setItem(TOKEN_KEY, token);
      if (!selectedOutletId || !localStorage.getItem('token')) return;
      await api('/push-devices', {
        method: 'POST',
        body: JSON.stringify({ token, outletId: selectedOutletId, platform: 'ANDROID', deviceName: navigator.userAgent.slice(0, 120) })
      });
    };

    void (async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      if (!active) return;
      registrationHandle = await PushNotifications.addListener('registration', token => { void registerToken(token.value).catch(() => {}); });
      errorHandle = await PushNotifications.addListener('registrationError', error => console.warn('Push registration failed', error));
      actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', event => openNotification(event.notification.data || {}));
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      receivedHandle = await PushNotifications.addListener('pushNotificationReceived', notification => {
        void LocalNotifications.schedule({ notifications: [{
          id: Math.floor(Date.now() % 2147483000),
          title: notification.title || 'Order Web Baru',
          body: notification.body || 'Ada order baru dari Customer Web Order.',
          channelId: 'customer-web-orders',
          extra: notification.data || {}
        }] }).catch(() => {});
      });
      localActionHandle = await LocalNotifications.addListener('localNotificationActionPerformed', event => openNotification(event.notification.extra || {}));
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') return;
      await PushNotifications.createChannel({
        id: 'customer-web-orders',
        name: 'Customer Web Orders',
        description: 'Notifikasi order baru dari Customer Web Order',
        importance: 5,
        visibility: 1,
        sound: 'default'
      });
      const existingToken = localStorage.getItem(TOKEN_KEY);
      if (existingToken) await registerToken(existingToken).catch(() => {});
      await PushNotifications.register();
    })().catch(error => console.warn('Push notification setup failed', error));

    return () => {
      active = false;
      void registrationHandle?.remove();
      void errorHandle?.remove();
      void actionHandle?.remove();
      void receivedHandle?.remove();
      void localActionHandle?.remove();
    };
  }, [navigate, selectedOutletId, setSelectedOutletId]);

  return null;
}
