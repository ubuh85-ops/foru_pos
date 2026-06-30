-- Inventory Management Phase 1 - standalone manual stock
CREATE TYPE "InventoryMovementType" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'OPNAME');

CREATE TABLE "inventory_categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_units" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_items" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "minimum_stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "current_stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "average_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "supplier" TEXT,
  "notes" TEXT,
  "photo_url" TEXT,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_movements" (
  "id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "movement_type" "InventoryMovementType" NOT NULL,
  "qty" DECIMAL(14,3) NOT NULL,
  "before_qty" DECIMAL(14,3) NOT NULL,
  "after_qty" DECIMAL(14,3) NOT NULL,
  "unit_cost" DECIMAL(14,2),
  "total_cost" DECIMAL(14,2),
  "reference" TEXT,
  "reference_id" TEXT,
  "remarks" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_categories_name_key" ON "inventory_categories"("name");
CREATE UNIQUE INDEX "inventory_units_name_key" ON "inventory_units"("name");
CREATE UNIQUE INDEX "inventory_items_code_key" ON "inventory_items"("code");
CREATE INDEX "inventory_items_name_idx" ON "inventory_items"("name");
CREATE INDEX "inventory_items_category_id_idx" ON "inventory_items"("category_id");
CREATE INDEX "inventory_movements_inventory_item_id_created_at_idx" ON "inventory_movements"("inventory_item_id", "created_at");
CREATE INDEX "inventory_movements_movement_type_created_at_idx" ON "inventory_movements"("movement_type", "created_at");

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventory_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "inventory_categories" ("id", "name", "sort_order", "updated_at") VALUES
  ('invcat_minuman', 'Minuman', 1, CURRENT_TIMESTAMP),
  ('invcat_makanan', 'Makanan', 2, CURRENT_TIMESTAMP),
  ('invcat_bumbu', 'Bumbu', 3, CURRENT_TIMESTAMP),
  ('invcat_packaging', 'Packaging', 4, CURRENT_TIMESTAMP),
  ('invcat_bahan_baku', 'Bahan Baku', 5, CURRENT_TIMESTAMP),
  ('invcat_lainnya', 'Lainnya', 99, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "inventory_units" ("id", "name", "sort_order", "updated_at") VALUES
  ('invunit_gram', 'Gram', 1, CURRENT_TIMESTAMP),
  ('invunit_kg', 'Kg', 2, CURRENT_TIMESTAMP),
  ('invunit_ml', 'Ml', 3, CURRENT_TIMESTAMP),
  ('invunit_liter', 'Liter', 4, CURRENT_TIMESTAMP),
  ('invunit_pcs', 'Pcs', 5, CURRENT_TIMESTAMP),
  ('invunit_box', 'Box', 6, CURRENT_TIMESTAMP),
  ('invunit_pack', 'Pack', 7, CURRENT_TIMESTAMP),
  ('invunit_botol', 'Botol', 8, CURRENT_TIMESTAMP),
  ('invunit_cup', 'Cup', 9, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
