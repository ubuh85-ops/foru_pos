ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "auto_print_receipt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "auto_print_kitchen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "auto_print_customer_item_list" BOOLEAN NOT NULL DEFAULT false;
