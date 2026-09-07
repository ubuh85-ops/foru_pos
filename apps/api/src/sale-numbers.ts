import { Prisma } from '@prisma/client';
import { prisma } from './lib.js';

export async function nextSaleNumber(prefix: string, outletId: string, field: 'orderNumber' | 'transactionNumber', now = new Date()) {
  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId }, select: { code: true } });
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('');
  // Sale document numbers are globally unique, so outlets sharing a code share this namespace.
  const namespace = `${prefix}-${outlet.code}-${date}-`;
  const column = field === 'orderNumber' ? Prisma.sql`order_number` : Prisma.sql`transaction_number`;
  // Reserve outside the sale transaction: rollback may leave gaps but never reuses a number.
  // The first reservation seeds from the document's date, not sale.created_at: an older order
  // can be paid today. ON CONFLICT serializes reservations, including concurrent first use.
  const rows = await prisma.$queryRaw<{ value: bigint }[]>(Prisma.sql`
    INSERT INTO sale_document_counters (key, value)
    VALUES (${namespace}, COALESCE(
      (SELECT value + 1 FROM sale_document_counters WHERE key = ${namespace}),
      (SELECT COALESCE(MAX(CASE WHEN substring(${column} FROM length(${namespace}) + 1) ~ '^[0-9]+$'
        THEN substring(${column} FROM length(${namespace}) + 1)::bigint END), 0) + 1
       FROM sales WHERE starts_with(${column}, ${namespace}))
    ))
    ON CONFLICT (key) DO UPDATE SET value = sale_document_counters.value + 1
    RETURNING value
  `);
  const value = rows[0]?.value;
  if (value === undefined || value < 1n) throw new Error('Nomor transaksi tidak dapat dialokasikan');
  return `${namespace}${String(value).padStart(4, '0')}`;
}
