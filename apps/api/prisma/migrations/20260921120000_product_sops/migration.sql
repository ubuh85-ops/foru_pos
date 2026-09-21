CREATE TYPE "ProductSopStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INACTIVE');

CREATE TABLE "product_sops" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "equipment" TEXT,
  "steps" JSONB NOT NULL,
  "serving_notes" TEXT,
  "status" "ProductSopStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_sops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_sops_product_id_key" ON "product_sops"("product_id");
CREATE UNIQUE INDEX "product_sops_business_id_product_id_key" ON "product_sops"("business_id", "product_id");
CREATE INDEX "product_sops_business_id_status_idx" ON "product_sops"("business_id", "status");

ALTER TABLE "product_sops"
  ADD CONSTRAINT "product_sops_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_sops"
  ADD CONSTRAINT "product_sops_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
