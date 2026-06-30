DO $$ BEGIN
  CREATE TYPE "InventoryWarehouseType" AS ENUM ('CENTRAL', 'PRODUCTION', 'OUTLET', 'VIRTUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
  ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
  ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_IN';
  ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_OUT';
END $$;

ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "barcode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_barcode_key"
  ON "inventory_items"("barcode");

CREATE INDEX IF NOT EXISTS "inventory_items_barcode_idx"
  ON "inventory_items"("barcode");

CREATE TABLE IF NOT EXISTS "inventory_warehouses" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "InventoryWarehouseType" NOT NULL DEFAULT 'CENTRAL',
  "outlet_id" TEXT,
  "address" TEXT,
  "pic_name" TEXT,
  "phone" TEXT,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_warehouses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_warehouses_code_key" ON "inventory_warehouses"("code");

DO $$ BEGIN
  ALTER TABLE "inventory_warehouses"
    ADD CONSTRAINT "inventory_warehouses_outlet_id_fkey"
    FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "inventory_warehouses" ("id", "code", "name", "type", "updated_at")
VALUES ('wh_default', 'WH-DEFAULT', 'Gudang Utama', 'CENTRAL', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "inventory_stocks" (
  "id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "current_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "reserved_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "available_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "average_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "last_movement_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_stocks_warehouse_id_inventory_item_id_key"
  ON "inventory_stocks"("warehouse_id", "inventory_item_id");

CREATE INDEX IF NOT EXISTS "inventory_stocks_inventory_item_id_idx"
  ON "inventory_stocks"("inventory_item_id");

DO $$ BEGIN
  ALTER TABLE "inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "inventory_stocks"
    ADD CONSTRAINT "inventory_stocks_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "inventory_stocks" (
  "id", "warehouse_id", "inventory_item_id", "current_qty", "reserved_qty", "available_qty", "average_cost", "last_movement_at", "updated_at"
)
SELECT
  'stock_' || "id",
  'wh_default',
  "id",
  COALESCE("current_stock", 0),
  0,
  COALESCE("current_stock", 0),
  COALESCE("average_cost", 0),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "inventory_items"
ON CONFLICT ("warehouse_id", "inventory_item_id") DO NOTHING;

ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "movement_number" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouse_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reference_type" TEXT;

UPDATE "inventory_movements"
SET "warehouse_id" = 'wh_default'
WHERE "warehouse_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_movements_movement_number_key"
  ON "inventory_movements"("movement_number");

CREATE INDEX IF NOT EXISTS "inventory_movements_warehouse_id_created_at_idx"
  ON "inventory_movements"("warehouse_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id" TEXT NOT NULL,
  "transfer_number" TEXT NOT NULL,
  "from_warehouse_id" TEXT NOT NULL,
  "to_warehouse_id" TEXT NOT NULL,
  "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "completed_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_transfers_transfer_number_key" ON "stock_transfers"("transfer_number");
CREATE INDEX IF NOT EXISTS "stock_transfers_from_warehouse_id_created_at_idx" ON "stock_transfers"("from_warehouse_id", "created_at");
CREATE INDEX IF NOT EXISTS "stock_transfers_to_warehouse_id_created_at_idx" ON "stock_transfers"("to_warehouse_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey"
    FOREIGN KEY ("from_warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey"
    FOREIGN KEY ("to_warehouse_id") REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_completed_by_fkey"
    FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "stock_transfer_items" (
  "id" TEXT NOT NULL,
  "stock_transfer_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "qty" DECIMAL(14,3) NOT NULL,
  "unit_cost" DECIMAL(14,2),
  CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "stock_transfer_items"
    ADD CONSTRAINT "stock_transfer_items_stock_transfer_id_fkey"
    FOREIGN KEY ("stock_transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "stock_transfer_items"
    ADD CONSTRAINT "stock_transfer_items_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
