ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'TRANSFER';

ALTER TABLE "outlets"
  ADD COLUMN "customer_order_qris_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customer_order_qris_image_url" TEXT DEFAULT '/images/qris-payment.png',
  ADD COLUMN "customer_order_bank_transfer_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customer_order_bank_name" TEXT,
  ADD COLUMN "customer_order_bank_account_number" TEXT,
  ADD COLUMN "customer_order_bank_account_holder" TEXT;
