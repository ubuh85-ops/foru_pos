CREATE TYPE "WebOrderMode" AS ENUM ('NORMAL_ONLY', 'PREORDER_ONLY', 'NORMAL_AND_PREORDER');
CREATE TYPE "OrderMode" AS ENUM ('NORMAL', 'PREORDER');
ALTER TABLE "outlets" ADD COLUMN "web_order_mode" "WebOrderMode" NOT NULL DEFAULT 'NORMAL_ONLY', ADD COLUMN "preorder_display_days" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "sales" ADD COLUMN "order_mode" "OrderMode" NOT NULL DEFAULT 'NORMAL', ADD COLUMN "quota_released_at" TIMESTAMP(3);
UPDATE "sales" SET "order_mode" = 'PREORDER' WHERE "is_pre_order" = true;
CREATE TABLE "daily_menu_schedules" (
 "id" TEXT NOT NULL PRIMARY KEY, "outlet_id" TEXT NOT NULL REFERENCES "outlets"("id"),
 "schedule_date" DATE NOT NULL, "product_id" TEXT NOT NULL REFERENCES "products"("id"),
 "price_override" DECIMAL(14,2), "quota" INTEGER, "sold_qty" INTEGER NOT NULL DEFAULT 0,
 "is_available" BOOLEAN NOT NULL DEFAULT true, "sort_order" INTEGER NOT NULL DEFAULT 0,
 "cutoff_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "daily_menu_quota_check" CHECK ("sold_qty" >= 0 AND ("quota" IS NULL OR "quota" >= "sold_qty")),
 CONSTRAINT "daily_menu_price_check" CHECK ("price_override" IS NULL OR "price_override" >= 0)
);
CREATE UNIQUE INDEX "daily_menu_schedules_outlet_id_schedule_date_product_id_key" ON "daily_menu_schedules"("outlet_id","schedule_date","product_id");
CREATE INDEX "daily_menu_schedules_outlet_id_schedule_date_is_available_idx" ON "daily_menu_schedules"("outlet_id","schedule_date","is_available");
ALTER TABLE "sale_items" ADD COLUMN "service_date" DATE, ADD COLUMN "daily_menu_schedule_id" TEXT REFERENCES "daily_menu_schedules"("id") ON DELETE RESTRICT,
 ADD COLUMN "fulfillment_status" TEXT NOT NULL DEFAULT 'PENDING', ADD COLUMN "fulfilled_at" TIMESTAMP(3);
CREATE INDEX "sale_items_outlet_id_service_date_idx" ON "sale_items"("outlet_id","service_date");
ALTER TABLE "coupon_usages" ALTER COLUMN "cashier_id" DROP NOT NULL;
