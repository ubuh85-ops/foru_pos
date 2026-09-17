-- CreateEnum
CREATE TYPE "ChecklistSection" AS ENUM ('OPENING', 'OPERATIONAL', 'CLOSING');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('PENDING', 'DONE');

-- CreateEnum
CREATE TYPE "ChecklistReviewStatus" AS ENUM ('NOT_REVIEWED', 'REVIEWED');

-- AlterTable
ALTER TABLE "outlets" ADD COLUMN     "checklistInitialized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "checklist_template_items" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "section" "ChecklistSection" NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_checklists" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reviewStatus" "ChecklistReviewStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "pendingAtReview" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_checklist_items" (
    "id" TEXT NOT NULL,
    "dailyChecklistId" TEXT NOT NULL,
    "templateItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" "ChecklistSection" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "daily_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklist_template_items_businessId_outletId_active_idx" ON "checklist_template_items"("businessId", "outletId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "daily_checklists_businessId_outletId_date_key" ON "daily_checklists"("businessId", "outletId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_checklist_items_dailyChecklistId_templateItemId_key" ON "daily_checklist_items"("dailyChecklistId", "templateItemId");

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklists" ADD CONSTRAINT "daily_checklists_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklists" ADD CONSTRAINT "daily_checklists_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklists" ADD CONSTRAINT "daily_checklists_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_dailyChecklistId_fkey" FOREIGN KEY ("dailyChecklistId") REFERENCES "daily_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "checklist_template_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
