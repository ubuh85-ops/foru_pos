ALTER TABLE "sale_items" ADD COLUMN "item_type" TEXT NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "bundle_id" TEXT,
  ADD COLUMN "bundle_selections_json" JSONB;
CREATE INDEX "sale_items_bundle_id_idx" ON "sale_items"("bundle_id");
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_bundle_id_fkey"
  FOREIGN KEY ("bundle_id") REFERENCES "product_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
