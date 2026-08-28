import { rupiah } from './api';

export function normalizeWhatsAppNumber(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return digits;
}

export function isValidWhatsAppNumber(value: string) {
  return /^62\d{8,13}$/.test(normalizeWhatsAppNumber(value));
}

export function invoiceWhatsAppText(sale: any) {
  const lines = [
    '*INVOICE FORU POS*', '',
    `Outlet: ${sale.outlet?.name || '-'}`,
    `No. Transaksi: ${sale.transactionNumber || sale.orderNumber || '-'}`,
    `Tanggal: ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(sale.paidAt || sale.createdAt || Date.now()))}`,
    `Pelanggan: ${sale.customerName || 'Walk In'}`, '', '*Pesanan*'
  ];
  for (const item of sale.items || []) {
    lines.push(`${item.qty}x ${item.productName} - ${rupiah(Number(item.subtotalAfterDiscount || 0))}`);
    if (item.variantName) lines.push(`   ${item.variantName}`);
    for (const addon of item.addons || []) lines.push(`   + ${addon.addonName}`);
    if (item.itemNote) lines.push(`   Catatan: ${item.itemNote}`);
  }
  lines.push('', `Subtotal: ${rupiah(Number(sale.subtotalBeforeDiscount || sale.subtotal || 0))}`);
  const discounts = [['Diskon Produk', sale.productDiscountTotal], ['Diskon Transaksi', sale.transactionDiscountAmount], ['Diskon Kupon', sale.couponDiscountAmount]] as const;
  for (const [label, amount] of discounts) if (Number(amount || 0) > 0) lines.push(`${label}: -${rupiah(Number(amount))}`);
  lines.push(`*Total: ${rupiah(Number(sale.grandTotal || 0))}*`);
  if (sale.paymentMethod) lines.push(`Pembayaran: ${sale.paymentMethod}`);
  lines.push(`Status: ${sale.status === 'PAID' ? 'LUNAS' : sale.status}`, '', `Terima kasih telah berbelanja di ${sale.outlet?.name || 'FORU POS'}.`);
  return lines.join('\n');
}

export function openWhatsAppInvoice(sale: any, phone: string) {
  const number = normalizeWhatsAppNumber(phone);
  if (!isValidWhatsAppNumber(number)) throw new Error('Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.');
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(invoiceWhatsAppText(sale))}`, '_blank', 'noopener,noreferrer');
}
