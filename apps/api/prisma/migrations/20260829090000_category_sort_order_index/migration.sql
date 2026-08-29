-- Support efficient tenant-scoped category ordering.
CREATE INDEX "categories_business_id_sort_order_idx" ON "categories"("business_id", "sort_order");
