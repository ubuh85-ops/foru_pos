ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TYPE "PrintType" ADD VALUE IF NOT EXISTS 'CUSTOMER_ITEM_LIST';

ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "order_number" TEXT,
  ADD COLUMN IF NOT EXISTS "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;

UPDATE "sales"
SET "order_number" = COALESCE("order_number", "transaction_number"),
    "paid_at" = COALESCE("paid_at", "created_at")
WHERE "order_number" IS NULL;

ALTER TABLE "sales" ALTER COLUMN "transaction_number" DROP NOT NULL;
ALTER TABLE "sales" ALTER COLUMN "payment_method" DROP NOT NULL;

ALTER TABLE "sale_items"
  ADD COLUMN IF NOT EXISTS "item_note" VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'sales_order_number_key'
  ) THEN
    CREATE UNIQUE INDEX "sales_order_number_key" ON "sales"("order_number");
  END IF;
END $$;
