import { Capacitor, registerPlugin } from '@capacitor/core';
import { api, dt, rupiah } from './api';

export type PrintDocType = 'customer-receipt' | 'kitchen-ticket' | 'customer-item-list' | 'shift-close-report';

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

function shiftCloseReportText(doc: any, width: number) {
  const line = '-'.repeat(width);
  const cash = doc.cashSummary || {};
  const omset = doc.omsetSummary || {};
  const pay = doc.paymentBreakdown || {};
  const order = doc.orderSummary || {};
  const lines = [
    center('FORU POS', width),
    center('LAPORAN TUTUP SHIFT', width),
    line,
    `Outlet: ${outletNameOf(doc)}`,
    `Shift : ${doc.shiftNumber || doc.id}`,
    `Open  : ${dt(doc.openedAt)}`,
    `Close : ${dt(doc.closedAt)}`,
    `Opened: ${doc.openedBy?.name || '-'}`,
    `Closed: ${doc.closedBy?.name || '-'}`,
    line,
    'CASH SUMMARY',
    pair('Opening Cash', rupiah(value(cash.openingCash)), width),
    pair('Cash Sales', rupiah(value(cash.cashSales)), width),
    pair('Expense Cash', rupiah(value(cash.cashDrawerExpenses)), width),
    pair('Cash Refund', rupiah(value(cash.cashRefund)), width),
    pair('Expected Cash', rupiah(value(cash.expectedCash)), width),
    pair('Actual Cash', rupiah(value(cash.actualCash)), width),
    pair('Variance', rupiah(value(cash.variance)), width),
    line,
    'OMSET SUMMARY',
    pair('Gross Sales', rupiah(value(omset.grossSales)), width),
    pair('Discount', rupiah(value(omset.discount)), width),
    pair('Net Sales', rupiah(value(omset.netSales)), width),
    pair('HPP', rupiah(value(omset.totalHpp)), width),
    pair('Gross Profit', rupiah(value(omset.grossProfit)), width),
    line,
    'PAYMENT',
    ...Object.entries(pay).filter(([, v]) => value(v) > 0).map(([k, v]) => pair(k, rupiah(value(v)), width)),
    line,
    'ITEM SOLD',
    ...((doc.itemSold || []).length ? (doc.itemSold || []).flatMap((i: any) => [`${i.productName} - ${i.variantName || 'Base'}`, pair(`${i.qty} x`, rupiah(value(i.grossSales)), width)]) : ['-']),
    line,
    'EXPENSE',
    ...((doc.expenseDetails || []).length ? (doc.expenseDetails || []).map((e: any) => pair(e.description || e.categoryName, rupiah(value(e.amount)), width)) : ['-']),
    line,
    'ORDER SUMMARY',
    pair('Paid', String(order.paidOrder || 0), width),
    pair('Pending', String(order.pendingOrder || 0), width),
    pair('Cancelled', String(order.cancelledOrder || 0), width),
    pair('Void', String(order.voidOrder || 0), width),
    line
  ];
  return lines.filter(Boolean).join('\n');
}

function buildPrintText(doc: any, type: PrintDocType, paperSize = 'MM58') {
  const width = paperSize === 'MM80' ? 48 : 32;
  if (type === 'shift-close-report') return shiftCloseReportText(doc, width);
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

export async function printShiftCloseReport(report: any) {
  try {
    const printed = await tryNativeBluetoothPrint(report, 'shift-close-report');
    if (printed) return true;
  } catch (e) {
    if (isNativeAndroid()) throw e;
  }
  if (isNativeAndroid()) throw new Error('Printer Bluetooth aktif tidak ditemukan untuk laporan shift.');
  const text = shiftCloseReportText(report, 32);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup print diblokir browser.');
  win.document.write(`<pre style="font-family:monospace;white-space:pre-wrap;font-size:12px">${text.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c] || c))}</pre><script>window.print()</script>`);
  win.document.close();
  return true;
}
