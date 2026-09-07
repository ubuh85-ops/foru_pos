-- Monthly PAID aggregation and daily drill-down, for all or one tenant outlet.
CREATE INDEX "sales_business_id_status_created_at_idx" ON "sales"("business_id", "status", "created_at");
CREATE INDEX "sales_business_id_outlet_id_status_created_at_idx" ON "sales"("business_id", "outlet_id", "status", "created_at");
