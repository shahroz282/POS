ALTER TABLE stamp_paper_transactions ADD COLUMN reference_name TEXT;
ALTER TABLE stamp_paper_transactions ADD COLUMN transaction_id TEXT;
ALTER TABLE stamp_paper_transactions ADD COLUMN idempotency_key TEXT;
ALTER TABLE stamp_paper_transactions ADD COLUMN sale_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_paisa >= 0);
ALTER TABLE stamp_paper_transactions ADD COLUMN service_charges_paisa INTEGER NOT NULL DEFAULT 0 CHECK (service_charges_paisa >= 0);
ALTER TABLE stamp_paper_transactions ADD COLUMN other_fees_paisa INTEGER NOT NULL DEFAULT 0 CHECK (other_fees_paisa >= 0);
ALTER TABLE stamp_paper_transactions ADD COLUMN total_payable_paisa INTEGER NOT NULL DEFAULT 0 CHECK (total_payable_paisa >= 0);
CREATE UNIQUE INDEX idx_stamp_transaction_id ON stamp_paper_transactions(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stamp_idempotency_key ON stamp_paper_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE stamp_transaction_payments (
  id INTEGER PRIMARY KEY,
  stamp_id INTEGER NOT NULL REFERENCES stamp_paper_transactions(id),
  receipt_number TEXT NOT NULL UNIQUE,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  reference_number TEXT,
  remarks TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_stamp_transaction_payments_id ON stamp_transaction_payments(stamp_id, paid_at);
CREATE INDEX idx_stamp_transaction_payments_date ON stamp_transaction_payments(paid_at, method);

CREATE TABLE stamp_transaction_documents (
  id INTEGER PRIMARY KEY,
  stamp_id INTEGER NOT NULL REFERENCES stamp_paper_transactions(id),
  category TEXT NOT NULL DEFAULT 'SUPPORTING',
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL UNIQUE,
  relative_storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_stamp_transaction_documents_stamp ON stamp_transaction_documents(stamp_id);

INSERT INTO schema_migrations(id, name) VALUES (4, '004_simple_stamp_transactions');