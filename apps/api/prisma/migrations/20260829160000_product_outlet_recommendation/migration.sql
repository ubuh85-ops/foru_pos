ALTER TABLE "product_outlets"
  ADD COLUMN "is_recommended" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "product_outlets_outlet_id_is_recommended_idx"
  ON "product_outlets"("outlet_id", "is_recommended");
