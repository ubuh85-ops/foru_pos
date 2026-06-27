ALTER TABLE "sales" ALTER COLUMN "status" SET DEFAULT 'PAID';

UPDATE "sales"
SET "status" = 'PAID'
WHERE "status" = 'COMPLETED';
