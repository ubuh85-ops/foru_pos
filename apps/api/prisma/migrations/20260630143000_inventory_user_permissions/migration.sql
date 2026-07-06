ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "inventory_permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "users"
SET "inventory_permissions" = ARRAY[
  'inventory.view',
  'inventory.stock_in',
  'inventory.stock_out',
  'inventory.adjustment',
  'inventory.opname',
  'inventory.transfer',
  'inventory.report',
  'inventory.warehouse',
  'inventory.item_management'
]::TEXT[]
WHERE "role" IN ('OWNER', 'SUPERVISOR')
  AND (COALESCE(array_length("inventory_permissions", 1), 0) = 0);
