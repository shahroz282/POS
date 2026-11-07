BEGIN IMMEDIATE;

CREATE TABLE filer_customers (
  id INTEGER PRIMARY KEY,
  customer_name TEXT NOT NULL,
  cnic TEXT NOT NULL,
  mobile TEXT,
  filing_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('FRESH_FILER','ANNUAL_RETURN','OTHER_SERVICES')),
  total_fee INTEGER NOT NULL CHECK (total_fee >= 0),
  advance_paid INTEGER NOT NULL CHECK (advance_paid >= 0 AND advance_paid <= total_fee),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_filer_customers_cnic ON filer_customers(cnic);
CREATE INDEX idx_filer_customers_filing_date ON filer_customers(filing_date);

CREATE TABLE filer_customer_documents (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES filer_customers(id),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_filer_customer_documents_customer
  ON filer_customer_documents(customer_id, is_active, uploaded_at);

INSERT INTO schema_migrations(id, name) VALUES (13, '013_filer_customers');
COMMIT;
