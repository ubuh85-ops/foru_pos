ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "sku" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_sku_key"
  ON "inventory_items"("sku")
  WHERE "sku" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "inventory_items_sku_idx"
  ON "inventory_items"("sku");
