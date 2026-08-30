import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { prisma } from './lib.js';

export type CustomerWebOrderPush = {
  id: string;
  businessId: string;
  outletId: string;
  orderNumber: string | null;
  customerName: string | null;
  orderType: string;
  isPreOrder: boolean;
  scheduledAt: Date | null;
  grandTotal: unknown;
  outlet: { name: string; timezone: string };
};

function firebaseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return projectId && clientEmail && privateKey ? { projectId, clientEmail, privateKey } : null;
}

function messaging() {
  const serviceAccount = firebaseServiceAccount();
  if (!serviceAccount) return null;
  const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
  return getMessaging(app);
}

export function customerWebOrderPushContent(order: CustomerWebOrderPush) {
  const route = order.isPreOrder ? '/orders/preorder-recap' : `/orders/${order.id}`;
  const kind = order.isPreOrder ? 'Pre-Order' : 'Order Web';
  const total = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(order.grandTotal));
  const schedule = order.isPreOrder && order.scheduledAt
    ? ` • ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: order.outlet.timezone }).format(order.scheduledAt)}`
    : '';
  return {
    title: `${kind} Baru • ${order.outlet.name}`,
    body: `${order.orderNumber || 'Order baru'} • ${order.customerName || 'Customer'} • ${total}${schedule}`,
    data: {
      type: 'CUSTOMER_WEB_ORDER',
      orderId: order.id,
      outletId: order.outletId,
      isPreOrder: String(order.isPreOrder),
      route
    }
  };
}

export async function sendCustomerWebOrderPush(order: CustomerWebOrderPush) {
  const fcm = messaging();
  if (!fcm) return { skipped: true, reason: 'Firebase belum dikonfigurasi' };

  const devices = await prisma.pushDevice.findMany({
    where: {
      businessId: order.businessId,
      outletId: order.outletId,
      isActive: true,
      user: {
        status: 'ACTIVE',
        memberships: { some: { businessId: order.businessId, status: 'ACTIVE' } },
        OR: [
          { memberships: { some: { businessId: order.businessId, role: 'OWNER', status: 'ACTIVE' } } },
          { outlets: { some: { outletId: order.outletId, status: 'ACTIVE' } } }
        ]
      }
    },
    select: { token: true, soundEnabled: true, soundName: true }
  });
  if (!devices.length) return { skipped: true, reason: 'Tidak ada perangkat terdaftar' };

  const content = customerWebOrderPushContent(order);
  const invalidTokens: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let start = 0; start < devices.length; start += 500) {
    const batch = devices.slice(start, start + 500);
    const groups = new Map<string, typeof batch>();
    for (const device of batch) {
      const key = `${device.soundEnabled ? 'on' : 'off'}:${device.soundName || 'default'}`;
      const group = groups.get(key) || [];
      group.push(device);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const tokens = group.map(device => device.token);
      const soundName = group[0]?.soundName || 'default';
      const sound = group[0]?.soundEnabled && soundName === 'default' ? 'default' : undefined;
      const channelId = group[0]?.soundEnabled && soundName.startsWith('device-') ? soundName : (sound ? 'customer-web-orders' : 'customer-web-orders-silent');
      const response = await fcm.sendEachForMulticast({
        tokens,
        notification: { title: content.title, body: content.body },
        data: content.data,
        android: {
          priority: 'high',
          notification: { channelId, ...(sound ? { sound } : {}), tag: `web-order-${order.id}` }
        }
      });
      successCount += response.successCount;
      failureCount += response.failureCount;
      response.responses.forEach((item, index) => {
        const code = item.error?.code || '';
        const token = tokens[index];
        if (token && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) invalidTokens.push(token);
      });
    }
  }

  if (invalidTokens.length) {
    await prisma.pushDevice.updateMany({ where: { token: { in: invalidTokens } }, data: { isActive: false } });
  }
  return { skipped: false, successCount, failureCount };
}
