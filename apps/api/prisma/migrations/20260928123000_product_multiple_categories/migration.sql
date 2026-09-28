CREATE TABLE "product_categories" (
    "product_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("product_id", "category_id")
);

CREATE INDEX "product_categories_category_id_sort_order_idx"
    ON "product_categories"("category_id", "sort_order");

ALTER TABLE "product_categories"
    ADD CONSTRAINT "product_categories_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_categories"
    ADD CONSTRAINT "product_categories_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "product_categories" ("product_id", "category_id", "sort_order")
SELECT "id", "category_id", 0
FROM "products"
WHERE "category_id" IS NOT NULL
ON CONFLICT ("product_id", "category_id") DO NOTHING;
