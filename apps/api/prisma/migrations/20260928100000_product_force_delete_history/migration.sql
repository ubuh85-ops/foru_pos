-- Preserve immutable sale snapshots when a master product is force-deleted.
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_product_id_fkey";
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_product_variant_id_fkey";
ALTER TABLE "sale_item_addons" DROP CONSTRAINT "sale_item_addons_addon_id_fkey";

ALTER TABLE "sale_items" ALTER COLUMN "product_id" DROP NOT NULL;
ALTER TABLE "sale_item_addons" ALTER COLUMN "addon_id" DROP NOT NULL;

ALTER TABLE "sale_items"
  ADD COLUMN "product_category_id_snapshot" TEXT,
  ADD COLUMN "product_category_name_snapshot" TEXT;

UPDATE "sale_items" AS si
SET
  "product_category_id_snapshot" = p."category_id",
  "product_category_name_snapshot" = COALESCE(c."name", p."category")
FROM "products" AS p
LEFT JOIN "categories" AS c ON c."id" = p."category_id"
WHERE si."product_id" = p."id";

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_product_variant_id_fkey"
  FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sale_item_addons"
  ADD CONSTRAINT "sale_item_addons_addon_id_fkey"
  FOREIGN KEY ("addon_id") REFERENCES "product_addons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
