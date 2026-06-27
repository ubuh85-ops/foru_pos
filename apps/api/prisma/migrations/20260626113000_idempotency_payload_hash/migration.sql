ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "payload_hash" TEXT;
