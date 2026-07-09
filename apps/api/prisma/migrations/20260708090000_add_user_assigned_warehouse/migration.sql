ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "assigned_warehouse_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_assigned_warehouse_id_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_assigned_warehouse_id_fkey"
      FOREIGN KEY ("assigned_warehouse_id")
      REFERENCES "inventory_warehouses"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_assigned_warehouse_id_idx"
  ON "users"("assigned_warehouse_id");
