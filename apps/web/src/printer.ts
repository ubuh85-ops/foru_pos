import { Capacitor, registerPlugin } from '@capacitor/core';
import { api, dt, rupiah } from './api';

export type PrintDocType = 'customer-receipt' | 'kitchen-ticket' | 'customer-item-list';

type BluetoothPrinterPlugin = {
  printText: (options: { address: string; text: string }) => Promise<{ success: boolean; name: string; address: string }>;
};

const NativeBluetoothPrinter = registerPlugin<BluetoothPrinterPlugin>('BluetoothPrinter');
const LAST_BT_PRINTER_KEY = 'foru:lastBluetoothPrinter';

const isNativeAndroid = () => Capacitor.getPlatform() === 'android';
const value = (n: any) => Number(n || 0);
const outletIdOf = (doc: any) => doc.outletId || doc.outlet?.id;
const outletNameOf = (doc: any) => doc.outlet?.name || '-';
const cashierNameOf = (doc: any) => doc.cashier?.name || '-';
const docNumberOf = (doc: any) => doc.transactionNumber || doc.orderNumber || '-';
const customerNameOf = (doc: any) => doc.customerName || 'Walk In';

function pad(text: string, len: number) {
  const s = String(text ?? '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function right(text: string, len: number) {
  const s = String(text ?? '');
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
}

function center(text: string, width: number) {
  const s = String(text ?? '');
  if (s.length >= width) return s.slice(0, width);
  const left = Math.floor((width - s.length) / 2);
  return ' '.repeat(left) + s;
}

function pair(label: string, amount: string, width: number) {
  const rightWidth = Math.min(14, Math.max(10, amount.length));
  return pad(label, width - rightWidth) + right(amount, rightWidth);
}

function wrap(text: string, width: number) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let row = '';
  for (const word of words) {
    if (!row) row = word;
    else if ((row + ' ' + word).length <= width) row += ' ' + word;
    else {
      lines.push(row);
      row = word;
    }
  }
  if (row) lines.push(row);
  return lines.length ? lines : [''];
}

function itemSubtotal(item: any) {
  return value(item.subtotalAfterDiscount ?? item.subtotal ?? ((item.finalUnitPrice ?? item.sellingPrice ?? 0) * (item.qty ?? 0)));
}

function itemUnitPrice(item: any) {
  return value(item.finalUnitPrice ?? item.sellingPrice ?? item.priceBeforeDiscount ?? 0);
}

function buildItemLine(item: any, width: number, showAmount: boolean) {
  const lines: string[] = [];
  const qty = value(item.qty);
  const title = `${qty}x ${item.productName || item.name || 'Item'}`;
  if (showAmount) {
    const amount = rupiah(itemSubtotal(item));
    const rightWidth = Math.min(12, amount.length);
    lines.push(pad(title, width - rightWidth) + right(amount, rightWidth));
  } else {
    lines.push(title);
  }
  if (item.variantName || item.variant) lines.push(`  ${item.variantName || item.variant}`);
  if (Array.isArray(item.addons)) item.addons.forEach((a: any) => lines.push(`  + ${a.addonName || a.name}`));
  const selected = item.selectedVariantsJson;
  if (Array.isArray(selected)) selected.forEach((v: any) => v?.optionName && lines.push(`  + ${v.optionName}`));
  if (item.itemNote) wrap(`NOTE: ${String(item.itemNote).toUpperCase()}`, width - 2).forEach(line => lines.push(`  ${line}`));
  if (!showAmount) lines.push(`  @ ${rupiah(itemUnitPrice(item))}`);
  return lines;
}

function receiptText(doc: any, width: number) {
  const line = '-'.repeat(width);
  const lines = [
    center('FORU POS', width),
    center(outletNameOf(doc), width),
    docNumberOf(doc),
    doc.orderNumber && doc.transactionNumber ? `Order: ${doc.orderNumber}` : '',
    dt(doc.createdAt || doc.paidAt || new Date().toISOString()),
    `Customer: ${customerNameOf(doc)}`,
    `Kasir   : ${cashierNameOf(doc)}`,
    line,
    ...(doc.items || []).flatMap((item: any) => buildItemLine(item, width, true)),
    line,
    pair('Subtotal', rupiah(value(doc.subtotalBeforeDiscount)), width),
    pair('Diskon produk', rupiah(-value(doc.productDiscountTotal)), width),
    pair('Diskon transaksi', rupiah(-value(doc.transactionDiscountAmount)), width),
    pair('Diskon kupon', rupiah(-value(doc.couponDiscountAmount)), width),
    pair('TOTAL', rupiah(value(doc.grandTotal)), width),
    doc.paymentMethod ? `Metode: ${doc.paymentMethod}` : '',
    doc.cashReceived != null ? pair('Diterima', rupiah(value(doc.cashReceived)), width) : '',
    doc.changeAmount != null ? pair('Kembali', rupiah(value(doc.changeAmount)), width) : '',
    line,
    center('Terima kasih', width)
  ];
  return lines.filter(Boolean).join('\n');
}

function kitchenText(doc: any, width: number) {
  const line = '-'.repeat(width);
  const lines = [
    center('KITCHEN TICKET', width),
    center(String(customerNameOf(doc)).toUpperCase(), width),
    outletNameOf(doc),
    docNumberOf(doc),
    dt(doc.createdAt || new Date().toISOString()),
    `Kasir: ${cashierNameOf(doc)}`,
    line,
    ...(doc.items || []).flatMap((item: any) => buildItemLine(item, width, false)),
    line
  ];
  return lines.filter(Boolean).join('\n');
}

function customerItemListText(doc: any, width: number) {
  const line = '-'.repeat(width);
  const lines = [
    center('FORU POS', width),
    center('CUSTOMER ITEM LIST', width),
    outletNameOf(doc),
    docNumberOf(doc),
    dt(doc.createdAt || new Date().toISOString()),
    `Customer: ${customerNameOf(doc)}`,
    `Kasir   : ${cashierNameOf(doc)}`,
    line,
    ...(doc.items || []).flatMap((item: any) => buildItemLine(item, width, true)),
    line,
    pair('Total sementara', rupiah(value(doc.grandTotal)), width),
    center('STATUS: BELUM DIBAYAR', width)
  ];
  return lines.filter(Boolean).join('\n');
}

function buildPrintText(doc: any, type: PrintDocType, paperSize = 'MM58') {
  const width = paperSize === 'MM80' ? 48 : 32;
  if (type === 'kitchen-ticket') return kitchenText(doc, width);
  if (type === 'customer-item-list') return customerItemListText(doc, width);
  return receiptText(doc, width);
}

function rememberBluetoothPrinter(printer: any) {
  if (!printer?.bluetoothAddress) return;
  localStorage.setItem(LAST_BT_PRINTER_KEY, JSON.stringify({
    printerName: printer.printerName || printer.name || 'Bluetooth Printer',
    bluetoothAddress: printer.bluetoothAddress,
    paperSize: printer.paperSize || 'MM58',
    isCustomerReceipt: !!printer.isCustomerReceipt,
    isKitchenPrinter: !!printer.isKitchenPrinter
  }));
}

function lastBluetoothPrinter() {
  try {
    const raw = localStorage.getItem(LAST_BT_PRINTER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p?.bluetoothAddress ? p : null;
  } catch {
    return null;
  }
}

export async function tryNativeBluetoothPrint(doc: any, type: PrintDocType) {
  if (!isNativeAndroid()) return false;
  const oid = outletIdOf(doc);
  const printers = await api<any[]>(oid ? `/printers?outlet_id=${oid}` : '/printers');
  const activeBluetoothPrinters = printers.filter(p =>
    p.status === 'ACTIVE' &&
    p.connectionType === 'BLUETOOTH' &&
    p.bluetoothAddress &&
    (!oid || p.outletId === oid || p.outlet?.id === oid)
  );
  const printer = activeBluetoothPrinters.find(p =>
    (type === 'kitchen-ticket' ? p.isKitchenPrinter : p.isCustomerReceipt)
  ) || activeBluetoothPrinters[0] || lastBluetoothPrinter();
  if (!printer) return false;
  await NativeBluetoothPrinter.printText({
    address: printer.bluetoothAddress,
    text: buildPrintText(doc, type, printer.paperSize || 'MM58')
  });
  rememberBluetoothPrinter(printer);
  return true;
}

export async function printWithBluetoothFallback(doc: any, type: PrintDocType, browserUrl: string) {
  try {
    const printed = await tryNativeBluetoothPrint(doc, type);
    if (printed) return;
  } catch (e) {
    if (isNativeAndroid()) {
      alert(`Gagal print Bluetooth: ${(e as Error).message}`);
      return;
    }
    alert(`Gagal print Bluetooth: ${(e as Error).message}. Membuka browser print fallback.`);
  }
  if (isNativeAndroid()) {
    alert('Printer Bluetooth aktif tidak ditemukan. Buka menu Printer, pilih device, isi MAC address, centang Customer Receipt/Kitchen, lalu Simpan Printer.');
    return;
  }
  window.open(browserUrl, '_blank');
}
