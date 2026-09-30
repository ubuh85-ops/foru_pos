-- Critical relation indexes used by product, sale, and inventory queries.
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");
CREATE INDEX "variant_options_variant_group_id_idx" ON "variant_options"("variant_group_id");
CREATE INDEX "product_addons_product_id_idx" ON "product_addons"("product_id");
CREATE INDEX "sale_item_addons_sale_item_id_idx" ON "sale_item_addons"("sale_item_id");
CREATE INDEX "stock_transfer_items_stock_transfer_id_idx" ON "stock_transfer_items"("stock_transfer_id");
CREATE INDEX "cash_sessions_business_id_outlet_id_status_opened_at_idx"
  ON "cash_sessions"("business_id", "outlet_id", "status", "opened_at");

-- Tenant-scoped, device-aware inventory alert delivery.
ALTER TYPE "InventoryAlertLogStatus" ADD VALUE IF NOT EXISTS 'PENDING';

ALTER TABLE "inventory_alert_logs"
  ADD COLUMN "business_id" TEXT,
  ADD COLUMN "device_id" TEXT,
  ADD COLUMN "dedupe_key" TEXT;

UPDATE "inventory_alert_logs" AS log
SET "business_id" = item."business_id"
FROM "inventory_items" AS item
WHERE item."id" = log."inventory_item_id";

ALTER TABLE "inventory_alert_logs" ALTER COLUMN "business_id" SET NOT NULL;
ALTER TABLE "inventory_alert_logs"
  ADD CONSTRAINT "inventory_alert_logs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "inventory_alert_logs_dedupe_key_key" ON "inventory_alert_logs"("dedupe_key");
CREATE INDEX "inventory_alert_logs_business_id_sent_at_idx"
  ON "inventory_alert_logs"("business_id", "sent_at");

-- Keep operational alert history bounded. Runtime cleanup maintains this window.
DELETE FROM "inventory_alert_logs" WHERE "sent_at" < NOW() - INTERVAL '90 days';
