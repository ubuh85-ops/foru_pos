-- Connect POS products to outlet inventory warehouse through global product recipes.

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'SALE_DEDUCTION';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'SALE_VOID_RETURN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'SALE_REFUND_RETURN';

ALTER TABLE "outlets"
  ADD COLUMN IF NOT EXISTS "inventory_warehouse_id" TEXT,
  ADD COLUMN IF NOT EXISTS "block_sale_when_ingredient_out_of_stock" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allow_sale_without_recipe" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "outlets"
  ADD CONSTRAINT "outlets_inventory_warehouse_id_fkey"
  FOREIGN KEY ("inventory_warehouse_id") REFERENCES "inventory_warehouses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "product_recipes" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "usage_qty" DECIMAL(14,3) NOT NULL,
  "usage_unit_id" TEXT NOT NULL,
  "waste_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_recipes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_recipes_product_id_inventory_item_id_key"
  ON "product_recipes"("product_id", "inventory_item_id");
CREATE INDEX IF NOT EXISTS "product_recipes_inventory_item_id_idx"
  ON "product_recipes"("inventory_item_id");
CREATE INDEX IF NOT EXISTS "product_recipes_usage_unit_id_idx"
  ON "product_recipes"("usage_unit_id");

ALTER TABLE "product_recipes"
  ADD CONSTRAINT "product_recipes_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_recipes"
  ADD CONSTRAINT "product_recipes_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_recipes"
  ADD CONSTRAINT "product_recipes_usage_unit_id_fkey"
  FOREIGN KEY ("usage_unit_id") REFERENCES "inventory_units"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "product_id" TEXT,
  ADD COLUMN IF NOT EXISTS "order_item_id" TEXT;

CREATE INDEX IF NOT EXISTS "inventory_movements_product_id_created_at_idx"
  ON "inventory_movements"("product_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_movements_order_item_id_created_at_idx"
  ON "inventory_movements"("order_item_id", "created_at");

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "sale_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
