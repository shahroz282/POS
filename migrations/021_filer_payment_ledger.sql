CREATE TABLE filer_customer_payments (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES filer_customers(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('RECEIVED','REVERSED')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH','UNCLASSIFIED')),
  payment_date TEXT NOT NULL,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_filer_customer_payments_date ON filer_customer_payments(payment_date, method);
CREATE INDEX idx_filer_customer_payments_customer ON filer_customer_payments(customer_id, payment_date, id);

INSERT INTO filer_customer_payments (
  customer_id, idempotency_key, entry_type, amount, method, payment_date, note, created_by
)
SELECT id, 'LEGACY-FILER-' || id, 'RECEIVED', advance_paid, 'UNCLASSIFIED',
  filing_date, 'Imported existing advance balance; original payment method/date unavailable', created_by
FROM filer_customers WHERE advance_paid > 0;

INSERT INTO schema_migrations(id, name) VALUES (21, '021_filer_payment_ledger');
