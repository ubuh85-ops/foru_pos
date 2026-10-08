import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const locks = source.split('\n').filter(line => line.includes('pg_advisory_xact_lock'));

describe('PostgreSQL advisory locks returning void', () => {
  it('never deserializes a void lock result with queryRaw', () => {
    expect(locks).toHaveLength(4);
    for (const line of locks) {
      expect(line).toContain('await tx.$executeRaw`SELECT pg_advisory_xact_lock');
      expect(line).not.toContain('$queryRaw');
    }
  });

  it('keeps both payment and void stock locks transaction-scoped', () => {
    expect(locks.filter(line => line.includes('sale-stock:'))).toHaveLength(2);
  });

  it('keeps POS and customer web-order idempotency locks', () => {
    expect(locks.some(line => line.includes('order-key:'))).toBe(true);
    expect(locks.some(line => line.includes('customerOrderRequestId'))).toBe(true);
  });
});
