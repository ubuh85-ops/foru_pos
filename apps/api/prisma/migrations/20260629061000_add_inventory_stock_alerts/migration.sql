DO $$ BEGIN
  CREATE TYPE "InventoryStockAlertType" AS ENUM ('OUT_OF_STOCK', 'LOW_STOCK', 'CUSTOM_THRESHOLD');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InventoryStockAlertState" AS ENUM ('NORMAL', 'ALERTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "InventoryAlertLogStatus" AS ENUM ('SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "stock_alert_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stock_alert_type" "InventoryStockAlertType" NOT NULL DEFAULT 'LOW_STOCK',
  ADD COLUMN IF NOT EXISTS "stock_alert_threshold" DECIMAL(14,3),
  ADD COLUMN IF NOT EXISTS "last_stock_alert_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stock_alert_state" "InventoryStockAlertState" NOT NULL DEFAULT 'NORMAL';

CREATE TABLE IF NOT EXISTS "inventory_alert_logs" (
  "id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "alert_type" "InventoryStockAlertType" NOT NULL,
  "current_stock" DECIMAL(14,3) NOT NULL,
  "threshold" DECIMAL(14,3),
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "InventoryAlertLogStatus" NOT NULL DEFAULT 'SENT',
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error_message" TEXT,
  CONSTRAINT "inventory_alert_logs_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "inventory_alert_logs"
    ADD CONSTRAINT "inventory_alert_logs_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "inventory_alert_logs_inventory_item_id_sent_at_idx" ON "inventory_alert_logs"("inventory_item_id", "sent_at");
CREATE INDEX IF NOT EXISTS "inventory_alert_logs_status_sent_at_idx" ON "inventory_alert_logs"("status", "sent_at");
