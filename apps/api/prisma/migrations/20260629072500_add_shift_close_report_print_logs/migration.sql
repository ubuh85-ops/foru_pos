ALTER TABLE "cash_sessions"
  ADD COLUMN IF NOT EXISTS "closed_by_user_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "cash_sessions"
    ADD CONSTRAINT "cash_sessions_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "printer_logs"
  ADD COLUMN IF NOT EXISTS "cash_session_id" TEXT;

ALTER TABLE "printer_logs"
  ALTER COLUMN "sale_id" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "printer_logs"
    ADD CONSTRAINT "printer_logs_cash_session_id_fkey"
    FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "PrintType" ADD VALUE 'SHIFT_CLOSE_REPORT';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "printer_logs_cash_session_id_print_type_idx" ON "printer_logs"("cash_session_id", "print_type");
