-- Reserve daily document numbers atomically; initialize each namespace lazily from sales.
CREATE TABLE "sale_document_counters" (
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    CONSTRAINT "sale_document_counters_pkey" PRIMARY KEY ("key")
);
