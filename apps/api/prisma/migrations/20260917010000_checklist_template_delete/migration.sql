-- DropForeignKey
ALTER TABLE "daily_checklist_items" DROP CONSTRAINT "daily_checklist_items_templateItemId_fkey";

-- AlterTable
ALTER TABLE "daily_checklist_items" ALTER COLUMN "templateItemId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "checklist_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
