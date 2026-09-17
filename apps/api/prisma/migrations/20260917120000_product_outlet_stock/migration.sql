CREATE TYPE "ProductStockMode" AS ENUM ('UNLIMITED', 'MANUAL', 'RECIPE');
CREATE TYPE "ProductStockMovementType" AS ENUM ('MANUAL_SET', 'SALE_DEDUCTION', 'SALE_VOID_RETURN');

ALTER TABLE "product_outlets"
  ADD COLUMN "stock_mode" "ProductStockMode" NOT NULL DEFAULT 'UNLIMITED',
  ADD COLUMN "stock_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "stock_updated_at" TIMESTAMP(3),
  ADD COLUMN "stock_updated_by" TEXT;

CREATE TABLE "product_stock_movements" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "outlet_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "sale_id" TEXT,
  "movement_type" "ProductStockMovementType" NOT NULL,
  "qty" INTEGER NOT NULL,
  "before_qty" INTEGER NOT NULL,
  "after_qty" INTEGER NOT NULL,
  "reason" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_stock_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_stock_movements_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_stock_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "product_stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "product_stock_movements_business_id_outlet_id_created_at_idx" ON "product_stock_movements"("business_id", "outlet_id", "created_at");
CREATE INDEX "product_stock_movements_product_id_outlet_id_created_at_idx" ON "product_stock_movements"("product_id", "outlet_id", "created_at");
CREATE INDEX "product_stock_movements_sale_id_movement_type_idx" ON "product_stock_movements"("sale_id", "movement_type");
