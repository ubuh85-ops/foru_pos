-- Harden tenant isolation for outlets and products.
-- Existing legacy rows without business_id are assigned to the default FORU business
-- before business_id is made mandatory.

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

  UPDATE outlets
  SET business_id = foru_business_id
  WHERE business_id IS NULL;

  UPDATE products
  SET business_id = foru_business_id
  WHERE business_id IS NULL;
END $$;

ALTER TABLE outlets DROP CONSTRAINT IF EXISTS outlets_code_key;
DROP INDEX IF EXISTS outlets_code_key;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
DROP INDEX IF EXISTS products_sku_key;

ALTER TABLE outlets ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE outlets ADD CONSTRAINT outlets_business_id_code_key UNIQUE (business_id, code);
ALTER TABLE products ADD CONSTRAINT products_business_id_sku_key UNIQUE (business_id, sku);
