BEGIN IMMEDIATE;

ALTER TABLE udhaar_entries ADD COLUMN receipt_no TEXT;
ALTER TABLE udhaar_entries ADD COLUMN idempotency_key TEXT;
ALTER TABLE udhaar_entries ADD COLUMN method TEXT CHECK (method IS NULL OR method IN ('CASH','BANK','EASYPAISA','JAZZCASH'));
ALTER TABLE udhaar_entries ADD COLUMN reference_no TEXT;

CREATE UNIQUE INDEX idx_udhaar_receipt_no ON udhaar_entries(receipt_no) WHERE receipt_no IS NOT NULL;
CREATE UNIQUE INDEX idx_udhaar_idempotency_key ON udhaar_entries(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_udhaar_entry_date ON udhaar_entries(entry_date, id);

INSERT INTO schema_migrations(id, name) VALUES (14, '014_udhaar_management');
COMMIT;
