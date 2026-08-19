DO $$ BEGIN
  CREATE TYPE "BusinessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "businesses" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legal_name" TEXT,
  "logo_url" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "status" "BusinessStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "businesses_code_key" ON "businesses"("code");

INSERT INTO "businesses" ("id", "code", "name", "status")
VALUES ('business_foru', 'FORU', 'FORU', 'ACTIVE')
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "business_memberships" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_memberships_business_id_user_id_key" ON "business_memberships"("business_id", "user_id");
CREATE INDEX IF NOT EXISTS "business_memberships_user_id_idx" ON "business_memberships"("user_id");
CREATE INDEX IF NOT EXISTS "business_memberships_business_id_idx" ON "business_memberships"("business_id");

DO $$ BEGIN
  ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "business_memberships" ("id", "business_id", "user_id", "role", "status")
SELECT 'bm_' || "id", 'business_foru', "id", "role", "status"
FROM "users"
ON CONFLICT ("business_id", "user_id") DO NOTHING;

ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "variant_groups" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "printers" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "printer_logs" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "expense_categories" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "inventory_categories" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "inventory_units" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "inventory_warehouses" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "business_id" TEXT;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "business_id" TEXT;

UPDATE "outlets" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "products" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "categories" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "variant_groups" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "cash_sessions" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "sales" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "printers" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "printer_logs" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "audit_logs" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "expenses" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "expense_categories" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "inventory_categories" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "inventory_units" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "inventory_items" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "inventory_warehouses" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "inventory_movements" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "stock_transfers" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;
UPDATE "coupons" SET "business_id" = 'business_foru' WHERE "business_id" IS NULL;

CREATE INDEX IF NOT EXISTS "outlets_business_id_idx" ON "outlets"("business_id");
CREATE INDEX IF NOT EXISTS "products_business_id_idx" ON "products"("business_id");
CREATE INDEX IF NOT EXISTS "categories_business_id_idx" ON "categories"("business_id");
CREATE INDEX IF NOT EXISTS "variant_groups_business_id_idx" ON "variant_groups"("business_id");
CREATE INDEX IF NOT EXISTS "cash_sessions_business_id_outlet_id_opened_at_idx" ON "cash_sessions"("business_id", "outlet_id", "opened_at");
CREATE INDEX IF NOT EXISTS "sales_business_id_outlet_id_created_at_idx" ON "sales"("business_id", "outlet_id", "created_at");
CREATE INDEX IF NOT EXISTS "printers_business_id_outlet_id_idx" ON "printers"("business_id", "outlet_id");
CREATE INDEX IF NOT EXISTS "printer_logs_business_id_printed_at_idx" ON "printer_logs"("business_id", "printed_at");
CREATE INDEX IF NOT EXISTS "audit_logs_business_id_changed_at_idx" ON "audit_logs"("business_id", "changed_at");
CREATE INDEX IF NOT EXISTS "expenses_business_id_outlet_id_idx" ON "expenses"("business_id", "outlet_id");
CREATE INDEX IF NOT EXISTS "expense_categories_business_id_idx" ON "expense_categories"("business_id");
CREATE INDEX IF NOT EXISTS "inventory_categories_business_id_idx" ON "inventory_categories"("business_id");
CREATE INDEX IF NOT EXISTS "inventory_units_business_id_idx" ON "inventory_units"("business_id");
CREATE INDEX IF NOT EXISTS "inventory_items_business_id_idx" ON "inventory_items"("business_id");
CREATE INDEX IF NOT EXISTS "inventory_warehouses_business_id_idx" ON "inventory_warehouses"("business_id");
CREATE INDEX IF NOT EXISTS "inventory_movements_business_id_created_at_idx" ON "inventory_movements"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "stock_transfers_business_id_created_at_idx" ON "stock_transfers"("business_id", "created_at");
CREATE INDEX IF NOT EXISTS "coupons_business_id_idx" ON "coupons"("business_id");

DO $$ BEGIN
  ALTER TABLE "outlets" ADD CONSTRAINT "outlets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "categories" ADD CONSTRAINT "categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "variant_groups" ADD CONSTRAINT "variant_groups_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "printers" ADD CONSTRAINT "printers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "printer_logs" ADD CONSTRAINT "printer_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inventory_warehouses" ADD CONSTRAINT "inventory_warehouses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "coupons" ADD CONSTRAINT "coupons_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
