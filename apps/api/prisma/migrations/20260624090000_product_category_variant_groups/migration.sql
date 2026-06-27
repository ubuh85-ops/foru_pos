-- Product category and reusable variant group enhancement.

CREATE TABLE "categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

ALTER TABLE "products"
  ADD COLUMN "category_id" TEXT,
  ADD COLUMN "base_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "base_hpp" DECIMAL(14,2) NOT NULL DEFAULT 0;

INSERT INTO "categories" ("id", "name", "description", "sort_order", "status", "created_at", "updated_at")
SELECT concat('cat_', md5("category")), "category", NULL, row_number() OVER (ORDER BY "category"), 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "category" FROM "products" WHERE "category" IS NOT NULL AND "category" <> '') c
ON CONFLICT ("name") DO NOTHING;

UPDATE "products" p
SET "category_id" = c."id"
FROM "categories" c
WHERE p."category" = c."name";

UPDATE "products" p
SET
  "base_price" = COALESCE((
    SELECT "selling_price"
    FROM "product_variants"
    WHERE "product_id" = p."id"
    ORDER BY "variant_name" ASC
    LIMIT 1
  ), 0),
  "base_hpp" = COALESCE((
    SELECT "hpp"
    FROM "product_variants"
    WHERE "product_id" = p."id"
    ORDER BY "variant_name" ASC
    LIMIT 1
  ), 0);

ALTER TABLE "products"
  ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "variant_groups" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "min_select" INTEGER NOT NULL DEFAULT 0,
  "max_select" INTEGER NOT NULL DEFAULT 1,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "variant_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "variant_options" (
  "id" TEXT NOT NULL,
  "variant_group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "additional_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "hpp" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "variant_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variant_groups" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "variant_group_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "product_variant_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_variant_groups_product_id_variant_group_id_key" ON "product_variant_groups"("product_id", "variant_group_id");

ALTER TABLE "variant_options"
  ADD CONSTRAINT "variant_options_variant_group_id_fkey" FOREIGN KEY ("variant_group_id") REFERENCES "variant_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_variant_groups"
  ADD CONSTRAINT "product_variant_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "product_variant_groups_variant_group_id_fkey" FOREIGN KEY ("variant_group_id") REFERENCES "variant_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sale_items"
  ALTER COLUMN "product_variant_id" DROP NOT NULL,
  ADD COLUMN "selected_variants_json" JSONB,
  ADD COLUMN "base_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "variant_price_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "final_unit_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "base_hpp" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "variant_hpp_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "final_unit_hpp" DECIMAL(14,2) NOT NULL DEFAULT 0;

UPDATE "sale_items"
SET
  "base_price" = "selling_price",
  "final_unit_price" = "selling_price",
  "base_hpp" = "hpp",
  "final_unit_hpp" = "hpp";
