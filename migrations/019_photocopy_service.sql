CREATE TABLE photocopy_sales (
  id INTEGER PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  service_type TEXT NOT NULL CHECK (service_type IN ('MONO','COLOR')),
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  copy_count INTEGER NOT NULL CHECK (copy_count > 0),
  duplex INTEGER NOT NULL CHECK (duplex IN (0,1)),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  customer_name TEXT,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','CANCELLED')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_photocopy_sales_created ON photocopy_sales(created_at);

CREATE TABLE photocopy_payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES photocopy_sales(id),
  receipt_number TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  paid_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_photocopy_payments_date ON photocopy_payments(paid_at, method);

CREATE TABLE photocopy_refunds (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL UNIQUE REFERENCES photocopy_sales(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_photocopy_refunds_date ON photocopy_refunds(created_at, method);

INSERT INTO schema_migrations(id, name) VALUES (19, '019_photocopy_service');
