CREATE TYPE "ProductionPartnerType" AS ENUM ('INTERNAL_KITCHEN', 'EXTERNAL_VENDOR');

CREATE TABLE "production_partners" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "outlet_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "ProductionPartnerType" NOT NULL DEFAULT 'INTERNAL_KITCHEN',
  "contact_name" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_partners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_partners_outlet_id_name_key" ON "production_partners"("outlet_id", "name");
CREATE INDEX "production_partners_business_id_outlet_id_status_idx" ON "production_partners"("business_id", "outlet_id", "status");
ALTER TABLE "production_partners" ADD CONSTRAINT "production_partners_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_partners" ADD CONSTRAINT "production_partners_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_outlets" ADD COLUMN "production_partner_id" TEXT;
ALTER TABLE "daily_menu_schedules" ADD COLUMN "production_partner_id" TEXT;
ALTER TABLE "sale_items" ADD COLUMN "production_partner_id" TEXT,
  ADD COLUMN "production_partner_name_snapshot" TEXT,
  ADD COLUMN "production_partner_type_snapshot" "ProductionPartnerType";

CREATE INDEX "product_outlets_production_partner_id_idx" ON "product_outlets"("production_partner_id");
CREATE INDEX "daily_menu_schedules_production_partner_id_schedule_date_idx" ON "daily_menu_schedules"("production_partner_id", "schedule_date");
CREATE INDEX "sale_items_production_partner_id_service_date_idx" ON "sale_items"("production_partner_id", "service_date");
ALTER TABLE "product_outlets" ADD CONSTRAINT "product_outlets_production_partner_id_fkey" FOREIGN KEY ("production_partner_id") REFERENCES "production_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_menu_schedules" ADD CONSTRAINT "daily_menu_schedules_production_partner_id_fkey" FOREIGN KEY ("production_partner_id") REFERENCES "production_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_production_partner_id_fkey" FOREIGN KEY ("production_partner_id") REFERENCES "production_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
