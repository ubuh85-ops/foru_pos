-- Additive migration: legacy bundles and normal products are not modified.
CREATE TABLE "product_bundles" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "image_url" TEXT,
  "base_price" DECIMAL(14,2) NOT NULL,
  "status" "Status" NOT NULL DEFAULT 'INACTIVE',
  "available_pos" BOOLEAN NOT NULL DEFAULT true,
  "available_web_order" BOOLEAN NOT NULL DEFAULT true,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_bundles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_bundles_price_check" CHECK ("base_price" >= 0),
  CONSTRAINT "product_bundles_period_check" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "start_date" <= "end_date")
);
CREATE TABLE "product_bundle_outlets" (
  "bundle_id" TEXT NOT NULL,
  "outlet_id" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "price" DECIMAL(14,2),
  "gofood_price" DECIMAL(14,2),
  "grabfood_price" DECIMAL(14,2),
  "shopeefood_price" DECIMAL(14,2),
  CONSTRAINT "product_bundle_outlets_pkey" PRIMARY KEY ("bundle_id", "outlet_id"),
  CONSTRAINT "product_bundle_outlets_price_check" CHECK (
    ("price" IS NULL OR "price" >= 0) AND ("gofood_price" IS NULL OR "gofood_price" >= 0) AND
    ("grabfood_price" IS NULL OR "grabfood_price" >= 0) AND ("shopeefood_price" IS NULL OR "shopeefood_price" >= 0))
);
CREATE TABLE "product_bundle_groups" (
  "id" TEXT NOT NULL,
  "bundle_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "is_fixed" BOOLEAN NOT NULL DEFAULT false,
  "min_select" INTEGER NOT NULL DEFAULT 1,
  "max_select" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_bundle_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_bundle_groups_limits_check" CHECK ("min_select" >= 0 AND "max_select" >= 1 AND "min_select" <= "max_select")
);
CREATE TABLE "product_bundle_choices" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_id" TEXT,
  "fixed_option_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "qty" INTEGER NOT NULL DEFAULT 1,
  "additional_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_bundle_choices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_bundle_choices_qty_check" CHECK ("qty" >= 1 AND "additional_price" >= 0)
);
CREATE UNIQUE INDEX "product_bundles_business_id_name_key" ON "product_bundles"("business_id", "name");
CREATE INDEX "product_bundles_business_id_status_sort_order_idx" ON "product_bundles"("business_id", "status", "sort_order");
CREATE INDEX "product_bundles_category_id_idx" ON "product_bundles"("category_id");
CREATE INDEX "product_bundle_outlets_outlet_id_is_active_idx" ON "product_bundle_outlets"("outlet_id", "is_active");
CREATE INDEX "product_bundle_groups_bundle_id_sort_order_idx" ON "product_bundle_groups"("bundle_id", "sort_order");
CREATE INDEX "product_bundle_choices_group_id_sort_order_idx" ON "product_bundle_choices"("group_id", "sort_order");
CREATE INDEX "product_bundle_choices_product_id_idx" ON "product_bundle_choices"("product_id");
CREATE INDEX "product_bundle_choices_variant_id_idx" ON "product_bundle_choices"("variant_id");
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_bundle_outlets" ADD CONSTRAINT "product_bundle_outlets_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "product_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_bundle_outlets" ADD CONSTRAINT "product_bundle_outlets_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_bundle_groups" ADD CONSTRAINT "product_bundle_groups_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "product_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_bundle_choices" ADD CONSTRAINT "product_bundle_choices_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_bundle_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_bundle_choices" ADD CONSTRAINT "product_bundle_choices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_bundle_choices" ADD CONSTRAINT "product_bundle_choices_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
