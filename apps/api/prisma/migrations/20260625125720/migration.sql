-- DropForeignKey
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_product_variant_id_fkey";

-- AlterTable
ALTER TABLE "product_outlets" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
