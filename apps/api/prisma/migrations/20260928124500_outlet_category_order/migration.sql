CREATE TABLE "outlet_categories" (
    "outlet_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outlet_categories_pkey" PRIMARY KEY ("outlet_id", "category_id")
);

CREATE INDEX "outlet_categories_category_id_idx"
    ON "outlet_categories"("category_id");

ALTER TABLE "outlet_categories"
    ADD CONSTRAINT "outlet_categories_outlet_id_fkey"
    FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outlet_categories"
    ADD CONSTRAINT "outlet_categories_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "outlet_categories" ("outlet_id", "category_id", "sort_order")
SELECT DISTINCT po."outlet_id", pc."category_id", c."sort_order"
FROM "product_outlets" po
JOIN "products" p ON p."id" = po."product_id"
JOIN "product_categories" pc ON pc."product_id" = p."id"
JOIN "categories" c ON c."id" = pc."category_id"
WHERE p."status" = 'ACTIVE'
  AND po."is_active" = TRUE
  AND po."status" = 'ACTIVE'
ON CONFLICT ("outlet_id", "category_id") DO NOTHING;
