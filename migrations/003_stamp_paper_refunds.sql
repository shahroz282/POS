CREATE TABLE stamp_paper_refunds (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES stamp_paper_sales(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  reference_number TEXT,
  remarks TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_stamp_refunds_sale ON stamp_paper_refunds(sale_id, created_at);
CREATE INDEX idx_stamp_refunds_date ON stamp_paper_refunds(created_at, method);

INSERT INTO schema_migrations(id, name) VALUES (3, '003_stamp_paper_refunds');