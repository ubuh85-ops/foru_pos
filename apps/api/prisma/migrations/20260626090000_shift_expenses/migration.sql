-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PaymentSource" AS ENUM ('CASH_DRAWER', 'NON_CASH', 'OWNER_TRANSFER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "expense_categories" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_name_key" ON "expense_categories"("name");

-- Seed default categories
INSERT INTO "expense_categories" ("id", "name", "description", "sort_order")
VALUES
  ('exp_cat_es_batu', 'Es Batu', 'Default kategori pengeluaran', 10),
  ('exp_cat_transport', 'Transport', 'Default kategori pengeluaran', 20),
  ('exp_cat_packaging', 'Packaging', 'Default kategori pengeluaran', 30),
  ('exp_cat_bahan_baku', 'Bahan Baku', 'Default kategori pengeluaran', 40),
  ('exp_cat_gas', 'Gas', 'Default kategori pengeluaran', 50),
  ('exp_cat_maintenance', 'Maintenance', 'Default kategori pengeluaran', 60),
  ('exp_cat_refund', 'Refund', 'Default kategori pengeluaran', 70),
  ('exp_cat_lain_lain', 'Lain-lain', 'Default kategori pengeluaran', 80)
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "expense_categories" ALTER COLUMN "updated_at" DROP DEFAULT;

-- Alter existing expenses table from older minimal implementation
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "cashier_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "category_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "category_name" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "payment_source" "PaymentSource" NOT NULL DEFAULT 'CASH_DRAWER';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "receipt_image_url" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "expenses" ALTER COLUMN "updated_at" DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'created_by'
  ) THEN
    EXECUTE 'UPDATE "expenses" SET "cashier_id" = COALESCE("cashier_id", "created_by") WHERE "cashier_id" IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'category'
  ) THEN
    EXECUTE 'UPDATE "expenses" SET "category_name" = COALESCE("category_name", "category", ''Lain-lain''), "description" = COALESCE("description", "category", ''Pengeluaran'') WHERE "category_name" IS NULL OR "description" IS NULL';
  ELSE
    UPDATE "expenses"
    SET
      "category_name" = COALESCE("category_name", 'Lain-lain'),
      "description" = COALESCE("description", 'Pengeluaran')
    WHERE "category_name" IS NULL OR "description" IS NULL;
  END IF;
END $$;

ALTER TABLE "expenses" DROP COLUMN IF EXISTS "category";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "created_by";

ALTER TABLE "expenses" ALTER COLUMN "cashier_id" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "category_name" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "description" SET NOT NULL;

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
