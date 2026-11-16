CREATE TABLE simple_stamp_refunds (
  id INTEGER PRIMARY KEY,
  stamp_id INTEGER NOT NULL UNIQUE REFERENCES stamp_paper_transactions(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_simple_stamp_refunds_date ON simple_stamp_refunds(created_at, method);

INSERT INTO schema_migrations(id, name) VALUES (20, '020_simple_stamp_refunds');
