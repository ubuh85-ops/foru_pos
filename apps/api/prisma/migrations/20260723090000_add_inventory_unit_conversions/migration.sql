CREATE TABLE IF NOT EXISTS "inventory_unit_conversions" (
  "id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "from_unit_id" TEXT NOT NULL,
  "to_unit_id" TEXT NOT NULL,
  "multiplier" DECIMAL(18,6) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_unit_conversions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_unit_conversions_inventory_item_id_from_unit_id_to_unit_id_key"
  ON "inventory_unit_conversions"("inventory_item_id", "from_unit_id", "to_unit_id");

CREATE INDEX IF NOT EXISTS "inventory_unit_conversions_from_unit_id_idx"
  ON "inventory_unit_conversions"("from_unit_id");

CREATE INDEX IF NOT EXISTS "inventory_unit_conversions_to_unit_id_idx"
  ON "inventory_unit_conversions"("to_unit_id");

ALTER TABLE "inventory_unit_conversions"
  ADD CONSTRAINT "inventory_unit_conversions_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_unit_conversions"
  ADD CONSTRAINT "inventory_unit_conversions_from_unit_id_fkey"
  FOREIGN KEY ("from_unit_id") REFERENCES "inventory_units"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_unit_conversions"
  ADD CONSTRAINT "inventory_unit_conversions_to_unit_id_fkey"
  FOREIGN KEY ("to_unit_id") REFERENCES "inventory_units"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
