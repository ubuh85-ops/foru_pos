-- AlterTable
ALTER TABLE "outlets" ADD COLUMN     "checklistReviewRequired" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "daily_checklists" ADD COLUMN     "reviewRequired" BOOLEAN NOT NULL DEFAULT true;
