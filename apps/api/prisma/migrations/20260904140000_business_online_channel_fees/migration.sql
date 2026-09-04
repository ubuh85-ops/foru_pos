ALTER TABLE "businesses"
ADD COLUMN "gofood_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN "grabfood_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN "shopeefood_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 0;
