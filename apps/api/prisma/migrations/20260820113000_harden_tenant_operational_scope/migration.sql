-- Harden tenant isolation for operational records.
-- Backfill business_id from related tenant-owned records, then make business_id mandatory.

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

  IF to_regclass('public.cash_sessions') IS NOT NULL THEN
    UPDATE cash_sessions cs
    SET business_id = o.business_id
    FROM outlets o
    WHERE cs.outlet_id = o.id AND cs.business_id IS NULL;
  END IF;

  IF to_regclass('public.sales') IS NOT NULL THEN
    UPDATE sales s
    SET business_id = o.business_id
    FROM outlets o
    WHERE s.outlet_id = o.id AND s.business_id IS NULL;
  END IF;

  IF to_regclass('public.printers') IS NOT NULL THEN
    UPDATE printers p
    SET business_id = o.business_id
    FROM outlets o
    WHERE p.outlet_id = o.id AND p.business_id IS NULL;
  END IF;

  IF to_regclass('public.printer_logs') IS NOT NULL THEN
    UPDATE printer_logs pl
    SET business_id = COALESCE(
      (SELECT s.business_id FROM sales s WHERE s.id = pl.sale_id),
      (SELECT cs.business_id FROM cash_sessions cs WHERE cs.id = pl.cash_session_id),
      o.business_id
    )
    FROM outlets o
    WHERE pl.outlet_id = o.id AND pl.business_id IS NULL;
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    UPDATE audit_logs al
    SET business_id = bm.business_id
    FROM business_memberships bm
    WHERE al.changed_by = bm.user_id AND al.business_id IS NULL;

    UPDATE audit_logs SET business_id = foru_business_id WHERE business_id IS NULL;
  END IF;

  IF to_regclass('public.inventory_movements') IS NOT NULL THEN
    UPDATE inventory_movements im
    SET business_id = COALESCE(
      (SELECT i.business_id FROM inventory_items i WHERE i.id = im.inventory_item_id),
      (SELECT w.business_id FROM inventory_warehouses w WHERE w.id = im.warehouse_id)
    )
    WHERE im.business_id IS NULL;
  END IF;

  IF to_regclass('public.stock_transfers') IS NOT NULL THEN
    UPDATE stock_transfers st
    SET business_id = fw.business_id
    FROM inventory_warehouses fw
    WHERE st.from_warehouse_id = fw.id AND st.business_id IS NULL;
  END IF;

  IF to_regclass('public.coupons') IS NOT NULL THEN
    UPDATE coupons SET business_id = foru_business_id WHERE business_id IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.coupons') IS NOT NULL THEN
    ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_coupon_code_key;
    DROP INDEX IF EXISTS coupons_coupon_code_key;
  END IF;

  IF to_regclass('public.cash_sessions') IS NOT NULL THEN
    ALTER TABLE cash_sessions ALTER COLUMN business_id SET NOT NULL;
  END IF;
  IF to_regclass('public.sales') IS NOT NULL THEN
    ALTER TABLE sales ALTER COLUMN business_id SET NOT NULL;
  END IF;
  IF to_regclass('public.printers') IS NOT NULL THEN
    ALTER TABLE printers ALTER COLUMN business_id SET NOT NULL;
  END IF;
  IF to_regclass('public.printer_logs') IS NOT NULL THEN
    ALTER TABLE printer_logs ALTER COLUMN business_id SET NOT NULL;
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    ALTER TABLE audit_logs ALTER COLUMN business_id SET NOT NULL;
  END IF;
  IF to_regclass('public.inventory_movements') IS NOT NULL THEN
    ALTER TABLE inventory_movements ALTER COLUMN business_id SET NOT NULL;
  END IF;
  IF to_regclass('public.stock_transfers') IS NOT NULL THEN
    ALTER TABLE stock_transfers ALTER COLUMN business_id SET NOT NULL;
  END IF;
  IF to_regclass('public.coupons') IS NOT NULL THEN
    ALTER TABLE coupons ALTER COLUMN business_id SET NOT NULL;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'coupons_business_id_coupon_code_key'
    ) THEN
      ALTER TABLE coupons ADD CONSTRAINT coupons_business_id_coupon_code_key UNIQUE (business_id, coupon_code);
    END IF;
  END IF;
END $$;
