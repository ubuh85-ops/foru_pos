-- Inventory stock must be unique by warehouse + item, not by item/SKU alone.
-- These drops are defensive for databases that were patched manually or had an older wrong index.
DROP INDEX IF EXISTS "inventory_stocks_inventory_item_id_key";
DROP INDEX IF EXISTS "inventory_stocks_inventory_item_id_unique";
DROP INDEX IF EXISTS "inventory_stocks_sku_key";
DROP INDEX IF EXISTS "inventory_stocks_barcode_key";

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_stocks_warehouse_id_inventory_item_id_key"
  ON "inventory_stocks"("warehouse_id", "inventory_item_id");

CREATE INDEX IF NOT EXISTS "inventory_stocks_inventory_item_id_idx"
  ON "inventory_stocks"("inventory_item_id");

CREATE INDEX IF NOT EXISTS "inventory_stocks_warehouse_id_idx"
  ON "inventory_stocks"("warehouse_id");
