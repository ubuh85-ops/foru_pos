CREATE TYPE "PrinterType" AS ENUM ('THERMAL');
CREATE TYPE "ConnectionType" AS ENUM ('BLUETOOTH', 'USB', 'NETWORK', 'BROWSER');
CREATE TYPE "PaperSize" AS ENUM ('MM58', 'MM80');
CREATE TYPE "PrintType" AS ENUM ('CUSTOMER_RECEIPT', 'KITCHEN_TICKET');
CREATE TYPE "PrintStatus" AS ENUM ('SUCCESS', 'FAILED');

ALTER TABLE "sales"
  ADD COLUMN "customer_name" TEXT NOT NULL DEFAULT 'Walk In';

CREATE TABLE "printers" (
  "id" TEXT NOT NULL,
  "outlet_id" TEXT NOT NULL,
  "printer_name" TEXT NOT NULL,
  "printer_type" "PrinterType" NOT NULL DEFAULT 'THERMAL',
  "connection_type" "ConnectionType" NOT NULL,
  "paper_size" "PaperSize" NOT NULL DEFAULT 'MM58',
  "ip_address" TEXT,
  "port" INTEGER,
  "bluetooth_address" TEXT,
  "usb_vendor_id" TEXT,
  "usb_product_id" TEXT,
  "is_customer_receipt" BOOLEAN NOT NULL DEFAULT false,
  "is_kitchen_printer" BOOLEAN NOT NULL DEFAULT false,
  "status" "Status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "printer_logs" (
  "id" TEXT NOT NULL,
  "outlet_id" TEXT NOT NULL,
  "sale_id" TEXT NOT NULL,
  "printer_id" TEXT,
  "print_type" "PrintType" NOT NULL,
  "status" "PrintStatus" NOT NULL,
  "error_message" TEXT,
  "printed_by" TEXT NOT NULL,
  "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "printer_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "old_value" JSONB,
  "new_value" JSONB,
  "changed_by" TEXT NOT NULL,
  "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "printer_logs_sale_id_print_type_idx" ON "printer_logs"("sale_id", "print_type");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

ALTER TABLE "printers"
  ADD CONSTRAINT "printers_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "printer_logs"
  ADD CONSTRAINT "printer_logs_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "printer_logs_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "printer_logs_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "printer_logs_printed_by_fkey" FOREIGN KEY ("printed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
