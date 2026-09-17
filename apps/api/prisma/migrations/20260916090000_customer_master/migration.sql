CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "phone_display" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CUSTOMER_WEB',
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "first_order_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_order_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales" ADD COLUMN "customer_id" TEXT;

CREATE UNIQUE INDEX "customers_business_id_phone_normalized_key" ON "customers"("business_id", "phone_normalized");
CREATE INDEX "customers_business_id_name_idx" ON "customers"("business_id", "name");
CREATE INDEX "customers_business_id_last_order_at_idx" ON "customers"("business_id", "last_order_at");
CREATE INDEX "sales_customer_id_created_at_idx" ON "sales"("customer_id", "created_at");

ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill historical sales. The compound tenant/phone key prevents cross-business merging.
WITH normalized_sales AS (
  SELECT s."id", s."business_id", s."customer_name", s."customer_phone", s."created_at",
    CASE
      WHEN regexp_replace(s."customer_phone", '[^0-9]', '', 'g') LIKE '00%' THEN '+' || substring(regexp_replace(s."customer_phone", '[^0-9]', '', 'g') FROM 3)
      WHEN regexp_replace(s."customer_phone", '[^0-9]', '', 'g') LIKE '0%' THEN '+62' || substring(regexp_replace(s."customer_phone", '[^0-9]', '', 'g') FROM 2)
      WHEN regexp_replace(s."customer_phone", '[^0-9]', '', 'g') LIKE '8%' THEN '+62' || regexp_replace(s."customer_phone", '[^0-9]', '', 'g')
      ELSE '+' || regexp_replace(s."customer_phone", '[^0-9]', '', 'g')
    END AS phone_normalized
  FROM "sales" s
  WHERE s."customer_phone" IS NOT NULL
    AND s."order_source" = 'CUSTOMER_WEB'
    AND length(regexp_replace(s."customer_phone", '[^0-9]', '', 'g')) BETWEEN 8 AND 15
), latest_customer AS (
  SELECT DISTINCT ON ("business_id", phone_normalized) "business_id", phone_normalized, "customer_name", "customer_phone"
  FROM normalized_sales
  ORDER BY "business_id", phone_normalized, "created_at" DESC, "id" DESC
), customer_orders AS (
  SELECT "business_id", phone_normalized, min("created_at") AS first_order_at, max("created_at") AS last_order_at
  FROM normalized_sales GROUP BY "business_id", phone_normalized
)
INSERT INTO "customers" ("id", "business_id", "name", "phone_normalized", "phone_display", "source", "marketing_consent", "first_order_at", "last_order_at", "status", "created_at", "updated_at")
SELECT 'cust_' || md5(l."business_id" || ':' || l.phone_normalized), l."business_id", l."customer_name", l.phone_normalized, l."customer_phone", 'HISTORICAL_SALE', false, o.first_order_at, o.last_order_at, 'ACTIVE', o.first_order_at, CURRENT_TIMESTAMP
FROM latest_customer l
JOIN customer_orders o ON o."business_id" = l."business_id" AND o.phone_normalized = l.phone_normalized
ON CONFLICT ("business_id", "phone_normalized") DO NOTHING;

UPDATE "sales" s SET "customer_id" = c."id"
FROM "customers" c
WHERE s."customer_phone" IS NOT NULL AND s."order_source" = 'CUSTOMER_WEB' AND c."business_id" = s."business_id"
  AND c."phone_normalized" = CASE
    WHEN regexp_replace(s."customer_phone", '[^0-9]', '', 'g') LIKE '00%' THEN '+' || substring(regexp_replace(s."customer_phone", '[^0-9]', '', 'g') FROM 3)
    WHEN regexp_replace(s."customer_phone", '[^0-9]', '', 'g') LIKE '0%' THEN '+62' || substring(regexp_replace(s."customer_phone", '[^0-9]', '', 'g') FROM 2)
    WHEN regexp_replace(s."customer_phone", '[^0-9]', '', 'g') LIKE '8%' THEN '+62' || regexp_replace(s."customer_phone", '[^0-9]', '', 'g')
    ELSE '+' || regexp_replace(s."customer_phone", '[^0-9]', '', 'g')
  END;
