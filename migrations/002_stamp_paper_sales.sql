CREATE TABLE stamp_paper_inventory (
  id INTEGER PRIMARY KEY,
  item_type TEXT NOT NULL,
  denomination_paisa INTEGER NOT NULL CHECK (denomination_paisa > 0),
  serial_number TEXT NOT NULL UNIQUE,
  register_number TEXT,
  book_number TEXT,
  issuing_source TEXT,
  vendor_employee_name TEXT,
  purchase_cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK (purchase_cost_paisa >= 0),
  sale_price_paisa INTEGER NOT NULL CHECK (sale_price_paisa >= 0),
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','SOLD','VOID')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_stamp_inventory_status ON stamp_paper_inventory(status, item_type, denomination_paisa);

CREATE TABLE parties (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  father_or_husband_name TEXT,
  cnic_number TEXT,
  mobile_number TEXT,
  address TEXT,
  city TEXT,
  district TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_parties_name ON parties(full_name);
CREATE INDEX idx_parties_mobile ON parties(mobile_number);
CREATE INDEX idx_parties_cnic ON parties(cnic_number);

CREATE TABLE stamp_paper_sales (
  id INTEGER PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL UNIQUE,
  transaction_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','CANCELLED')),
  inventory_id INTEGER NOT NULL REFERENCES stamp_paper_inventory(id),
  document_purpose TEXT NOT NULL,
  document_reference_number TEXT,
  service_charges_paisa INTEGER NOT NULL DEFAULT 0 CHECK (service_charges_paisa >= 0),
  other_fees_paisa INTEGER NOT NULL DEFAULT 0 CHECK (other_fees_paisa >= 0),
  total_payable_paisa INTEGER NOT NULL CHECK (total_payable_paisa >= 0),
  remarks TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cancelled_by INTEGER REFERENCES users(id),
  cancelled_at TEXT,
  cancellation_reason TEXT
);
CREATE INDEX idx_stamp_sales_date ON stamp_paper_sales(transaction_date);
CREATE INDEX idx_stamp_sales_status ON stamp_paper_sales(status);

CREATE TABLE stamp_paper_sale_parties (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES stamp_paper_sales(id),
  party_id INTEGER NOT NULL REFERENCES parties(id),
  party_role TEXT NOT NULL CHECK (party_role IN ('FIRST_PARTY','SECOND_PARTY')),
  full_name TEXT NOT NULL,
  father_or_husband_name TEXT,
  cnic_number TEXT,
  mobile_number TEXT,
  address TEXT,
  city TEXT,
  district TEXT,
  UNIQUE (sale_id, party_role)
);
CREATE INDEX idx_stamp_sale_parties_party ON stamp_paper_sale_parties(party_id);

CREATE TABLE stamp_paper_payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES stamp_paper_sales(id),
  receipt_number TEXT NOT NULL UNIQUE,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  reference_number TEXT,
  remarks TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX idx_stamp_payments_sale ON stamp_paper_payments(sale_id, paid_at);
CREATE INDEX idx_stamp_payments_date ON stamp_paper_payments(paid_at, method);

CREATE TABLE stamp_paper_documents (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES stamp_paper_sales(id),
  party_id INTEGER REFERENCES parties(id),
  category TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL UNIQUE,
  relative_storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_stamp_documents_sale ON stamp_paper_documents(sale_id);
CREATE INDEX idx_stamp_documents_party ON stamp_paper_documents(party_id);

CREATE TABLE stamp_paper_inventory_movements (
  id INTEGER PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES stamp_paper_inventory(id),
  sale_id INTEGER NOT NULL REFERENCES stamp_paper_sales(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('SOLD','SALE_REVERSED')),
  reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (sale_id, movement_type)
);
CREATE INDEX idx_stamp_inventory_movements_item ON stamp_paper_inventory_movements(inventory_id, created_at);

INSERT INTO schema_migrations(id, name) VALUES (2, '002_stamp_paper_sales');