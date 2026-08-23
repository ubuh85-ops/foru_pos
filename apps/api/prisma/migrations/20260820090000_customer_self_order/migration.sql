ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'OPEN_ORDER';
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "outlets"
  ADD COLUMN IF NOT EXISTS "customer_ordering_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customer_ordering_slug" TEXT,
  ADD COLUMN IF NOT EXISTS "accepting_customer_orders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "customer_order_allow_dine_in" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "customer_order_allow_take_away" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "customer_order_request_phone" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customer_order_sound_enabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "outlets"
SET "customer_ordering_slug" = lower(regexp_replace(coalesce(nullif("code", ''), "name"), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE "customer_ordering_slug" IS NULL OR trim("customer_ordering_slug") = '';

ALTER TABLE "sales"
  ALTER COLUMN "cashier_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "customer_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "table_number" TEXT,
  ADD COLUMN IF NOT EXISTS "order_note" TEXT,
  ADD COLUMN IF NOT EXISTS "order_type" TEXT NOT NULL DEFAULT 'DINE_IN',
  ADD COLUMN IF NOT EXISTS "order_source" TEXT NOT NULL DEFAULT 'POS',
  ADD COLUMN IF NOT EXISTS "customer_order_request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "public_order_token" TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accepted_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "outlets_business_id_customer_ordering_slug_key" ON "outlets"("business_id","customer_ordering_slug");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_customer_order_request_id_key" ON "sales"("customer_order_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_public_order_token_key" ON "sales"("public_order_token");
CREATE INDEX IF NOT EXISTS "sales_business_id_outlet_id_status_order_source_created_at_idx" ON "sales"("business_id","outlet_id","status","order_source","created_at");
