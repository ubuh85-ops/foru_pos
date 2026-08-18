CREATE TABLE "product_channel_prices" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "channel" "PaymentMethod" NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_channel_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_channel_prices_product_id_outlet_id_channel_key" ON "product_channel_prices"("product_id", "outlet_id", "channel");
CREATE INDEX "product_channel_prices_outlet_id_channel_idx" ON "product_channel_prices"("outlet_id", "channel");

ALTER TABLE "product_channel_prices"
  ADD CONSTRAINT "product_channel_prices_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_channel_prices"
  ADD CONSTRAINT "product_channel_prices_outlet_id_fkey"
  FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sale_items" ADD COLUMN "channel" "PaymentMethod";
ALTER TABLE "sale_items" ADD COLUMN "dine_in_price_snapshot" DECIMAL(14,2);
ALTER TABLE "sale_items" ADD COLUMN "channel_price_snapshot" DECIMAL(14,2);
ALTER TABLE "sale_items" ADD COLUMN "price_source" TEXT;
ALTER TABLE "sale_items" ADD COLUMN "base_margin_percent_snapshot" DECIMAL(8,2);
ALTER TABLE "sale_items" ADD COLUMN "actual_margin_percent" DECIMAL(8,2);
