-- Harden tenant isolation for master data.
-- Legacy rows without business_id are assigned to the default FORU business
-- before business_id is made mandatory and unique constraints become per-business.

DO $$
DECLARE
  foru_business_id text;
BEGIN
  SELECT id INTO foru_business_id FROM businesses WHERE code = 'FORU' LIMIT 1;

  IF foru_business_id IS NULL THEN
    INSERT INTO businesses (id, code, name, status, created_at, updated_at)
    VALUES ('business_foru', 'FORU', 'FORU', 'ACTIVE', now(), now())
    RETURNING id INTO foru_business_id;
  END IF;

  UPDATE categories SET business_id = foru_business_id WHERE business_id IS NULL;
  UPDATE variant_groups SET business_id = foru_business_id WHERE business_id IS NULL;
  UPDATE expense_categories SET business_id = foru_business_id WHERE business_id IS NULL;
  UPDATE inventory_categories SET business_id = foru_business_id WHERE business_id IS NULL;
  UPDATE inventory_units SET business_id = foru_business_id WHERE business_id IS NULL;
  UPDATE inventory_items SET business_id = foru_business_id WHERE business_id IS NULL;
  UPDATE inventory_warehouses SET business_id = foru_business_id WHERE business_id IS NULL;
END $$;

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;
DROP INDEX IF EXISTS categories_name_key;

ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_name_key;
DROP INDEX IF EXISTS expense_categories_name_key;

ALTER TABLE inventory_categories DROP CONSTRAINT IF EXISTS inventory_categories_name_key;
DROP INDEX IF EXISTS inventory_categories_name_key;

ALTER TABLE inventory_units DROP CONSTRAINT IF EXISTS inventory_units_name_key;
DROP INDEX IF EXISTS inventory_units_name_key;

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_code_key;
DROP INDEX IF EXISTS inventory_items_code_key;
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_sku_key;
DROP INDEX IF EXISTS inventory_items_sku_key;
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_barcode_key;
DROP INDEX IF EXISTS inventory_items_barcode_key;

ALTER TABLE inventory_warehouses DROP CONSTRAINT IF EXISTS inventory_warehouses_code_key;
DROP INDEX IF EXISTS inventory_warehouses_code_key;

ALTER TABLE categories ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE variant_groups ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE expense_categories ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE inventory_categories ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE inventory_units ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE inventory_items ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE inventory_warehouses ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE categories ADD CONSTRAINT categories_business_id_name_key UNIQUE (business_id, name);
ALTER TABLE variant_groups ADD CONSTRAINT variant_groups_business_id_name_key UNIQUE (business_id, name);
ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_business_id_name_key UNIQUE (business_id, name);
ALTER TABLE inventory_categories ADD CONSTRAINT inventory_categories_business_id_name_key UNIQUE (business_id, name);
ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_business_id_name_key UNIQUE (business_id, name);
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_business_id_code_key UNIQUE (business_id, code);
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_business_id_sku_key UNIQUE (business_id, sku);
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_business_id_barcode_key UNIQUE (business_id, barcode);
ALTER TABLE inventory_warehouses ADD CONSTRAINT inventory_warehouses_business_id_code_key UNIQUE (business_id, code);
