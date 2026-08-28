ALTER TABLE "outlets"
  ADD COLUMN "customer_order_allow_delivery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pre_order_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pre_order_min_lead_minutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "pre_order_max_days_ahead" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "pre_order_slot_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "customer_order_open_time" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN "customer_order_close_time" TEXT NOT NULL DEFAULT '21:00',
  ADD COLUMN "customer_order_operating_days" INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::INTEGER[],
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta';

ALTER TABLE "sales"
  ADD COLUMN "is_pre_order" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scheduled_at" TIMESTAMP(3);

CREATE INDEX "sales_business_id_outlet_id_status_scheduled_at_idx"
  ON "sales"("business_id", "outlet_id", "status", "scheduled_at");
