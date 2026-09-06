ALTER TABLE "sales" ADD COLUMN "web_analytics" JSONB;

CREATE TABLE "web_analytics_events" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "outlet_id" TEXT NOT NULL,
  "visitor_id" TEXT NOT NULL,
  "session_id" TEXT,
  "event_id" TEXT,
  "event_type" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'direct',
  "product_id" TEXT,
  "order_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_analytics_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_analytics_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "web_analytics_events_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "web_analytics_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "web_analytics_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "web_analytics_events_event_id_key" ON "web_analytics_events"("event_id");
CREATE UNIQUE INDEX "web_analytics_events_order_id_key" ON "web_analytics_events"("order_id");
CREATE INDEX "web_analytics_events_business_id_outlet_id_created_at_idx" ON "web_analytics_events"("business_id", "outlet_id", "created_at");
CREATE INDEX "web_analytics_events_business_id_created_at_idx" ON "web_analytics_events"("business_id", "created_at");
CREATE INDEX "web_analytics_events_visitor_id_idx" ON "web_analytics_events"("visitor_id");
CREATE INDEX "web_analytics_events_event_type_created_at_idx" ON "web_analytics_events"("event_type", "created_at");
