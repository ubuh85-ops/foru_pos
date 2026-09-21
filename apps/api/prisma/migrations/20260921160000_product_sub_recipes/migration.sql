-- Allow a product recipe line to reference either a raw inventory item or
-- another product whose recipe is expanded recursively at sale time.
ALTER TABLE "product_recipes"
  ALTER COLUMN "inventory_item_id" DROP NOT NULL,
  ALTER COLUMN "usage_unit_id" DROP NOT NULL,
  ADD COLUMN "component_product_id" TEXT,
  ADD COLUMN "component_unit" TEXT;

CREATE UNIQUE INDEX "product_recipes_product_id_component_product_id_key"
  ON "product_recipes"("product_id", "component_product_id");

CREATE INDEX "product_recipes_component_product_id_idx"
  ON "product_recipes"("component_product_id");

ALTER TABLE "product_recipes"
  ADD CONSTRAINT "product_recipes_component_product_id_fkey"
  FOREIGN KEY ("component_product_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_recipes"
  ADD CONSTRAINT "product_recipes_source_check"
  CHECK (
    (
      "inventory_item_id" IS NOT NULL
      AND "usage_unit_id" IS NOT NULL
      AND "component_product_id" IS NULL
    )
    OR
    (
      "inventory_item_id" IS NULL
      AND "usage_unit_id" IS NULL
      AND "component_product_id" IS NOT NULL
      AND NULLIF(BTRIM("component_unit"), '') IS NOT NULL
    )
  );
