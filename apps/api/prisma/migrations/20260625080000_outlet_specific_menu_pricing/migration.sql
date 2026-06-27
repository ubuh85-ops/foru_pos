ALTER TABLE "product_outlets"
  ADD COLUMN "is_available" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "outlet_price" DECIMAL(14,2),
  ADD COLUMN "outlet_hpp" DECIMAL(14,2),
  ADD COLUMN "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "product_outlets"
SET
  "is_available" = COALESCE("is_active", true),
  "status" = CASE WHEN COALESCE("is_active", true) THEN 'ACTIVE'::"Status" ELSE 'INACTIVE'::"Status" END;

CREATE TABLE "variant_option_outlets" (
  "id" TEXT NOT NULL,
  "variant_option_id" TEXT NOT NULL,
  "outlet_id" TEXT NOT NULL,
  "additional_price" DECIMAL(14,2),
  "hpp" DECIMAL(14,2),
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "variant_option_outlets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_option_outlets_variant_option_id_outlet_id_key" ON "variant_option_outlets"("variant_option_id", "outlet_id");

ALTER TABLE "variant_option_outlets"
  ADD CONSTRAINT "variant_option_outlets_variant_option_id_fkey" FOREIGN KEY ("variant_option_id") REFERENCES "variant_options"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "variant_option_outlets_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sale_items"
  ADD COLUMN "outlet_id" TEXT,
  ADD COLUMN "outlet_price" DECIMAL(14,2),
  ADD COLUMN "outlet_hpp" DECIMAL(14,2);

UPDATE "sale_items" si
SET "outlet_id" = s."outlet_id"
FROM "sales" s
WHERE si."sale_id" = s."id";

ALTER TABLE "sale_items"
  ALTER COLUMN "outlet_id" SET NOT NULL,
  ADD CONSTRAINT "sale_items_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
