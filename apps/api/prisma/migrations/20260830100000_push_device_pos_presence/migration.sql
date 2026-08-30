ALTER TABLE "push_devices"
  ADD COLUMN "is_pos_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pos_last_seen_at" TIMESTAMP(3),
  ADD COLUMN "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sound_name" TEXT;

CREATE INDEX "push_devices_business_id_outlet_id_is_active_is_pos_active_pos_last_seen_at_idx"
  ON "push_devices"("business_id", "outlet_id", "is_active", "is_pos_active", "pos_last_seen_at");
