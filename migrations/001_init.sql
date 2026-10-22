-- SAQIB PHOTO STATE - initial schema. Money = INTEGER rupees. Dates = local ISO text.
-- Connection must run: PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;

CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));

CREATE TABLE users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','CASHIER')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE counters (name TEXT NOT NULL, day TEXT NOT NULL, last_value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (name, day)); -- name: INV, STP, ADM, SCH

CREATE TABLE customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sku TEXT UNIQUE, barcode TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price INTEGER NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0,
  low_stock_level INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
CREATE INDEX idx_products_name ON products(name);

CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT);
CREATE TABLE purchases (
  id INTEGER PRIMARY KEY, supplier_id INTEGER REFERENCES suppliers(id),
  purchase_date TEXT NOT NULL, total INTEGER NOT NULL CHECK (total >= 0), note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0), unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0), discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total INTEGER NOT NULL CHECK (total >= 0), received_amount INTEGER NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','PARTIAL','RETURNED')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (discount <= subtotal), CHECK (total = subtotal - discount)
);
CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sales_customer ON sales(customer_id);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  unit_cost INTEGER NOT NULL DEFAULT 0, -- purchase price at time of sale, for profit reports
  line_total INTEGER NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE sale_returns (
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
  refund_amount INTEGER NOT NULL CHECK (refund_amount >= 0), refund_method TEXT CHECK (refund_method IN ('CASH','BANK','EASYPAISA','JAZZCASH','UDHAAR_ADJUST')),
  reason TEXT, created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE sale_return_items (
  id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id), quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('PURCHASE','SALE','RETURN','ADJUSTMENT')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0), -- signed: + adds stock, - removes stock
  ref_type TEXT, ref_id INTEGER, note TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_stock_mov_product ON stock_movements(product_id);

CREATE TABLE udhaar_entries (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER REFERENCES sales(id),
  type TEXT NOT NULL CHECK (type IN ('CHARGE','REPAYMENT')),
  amount INTEGER NOT NULL CHECK (amount > 0), note TEXT,
  entry_date TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_udhaar_customer ON udhaar_entries(customer_id);

CREATE TABLE stamp_paper_transactions (
  id INTEGER PRIMARY KEY, txn_no TEXT NOT NULL UNIQUE, bank_employee_name TEXT NOT NULL, customer_name TEXT NOT NULL,
  register_no TEXT NOT NULL, price INTEGER NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','CANCELLED')),
  remarks TEXT, created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_stamp_created ON stamp_paper_transactions(created_at);

CREATE TABLE class_folders (id INTEGER PRIMARY KEY, class_name TEXT NOT NULL, academic_year TEXT NOT NULL, UNIQUE (class_name, academic_year));
CREATE TABLE students (
  id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, father_name TEXT, phone TEXT, date_of_birth TEXT,
  class_id INTEGER REFERENCES class_folders(id)
);
CREATE INDEX idx_students_name ON students(full_name);
CREATE TABLE admissions (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
  class_id INTEGER NOT NULL REFERENCES class_folders(id), admission_date TEXT NOT NULL,
  fee INTEGER NOT NULL CHECK (fee >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  remarks TEXT, created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE schemes (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT,
  start_date TEXT, end_date TEXT, eligibility TEXT, default_fee INTEGER NOT NULL DEFAULT 0 CHECK (default_fee >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
CREATE TABLE scheme_applications (
  id INTEGER PRIMARY KEY, scheme_id INTEGER NOT NULL REFERENCES schemes(id),
  customer_id INTEGER REFERENCES customers(id),
  applicant_name TEXT NOT NULL, cnic TEXT NOT NULL, mobile TEXT, category TEXT,
  application_date TEXT NOT NULL, application_fee INTEGER NOT NULL DEFAULT 0 CHECK (application_fee >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  remarks TEXT, created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_scheme_app_scheme ON scheme_applications(scheme_id);
CREATE INDEX idx_scheme_app_cnic ON scheme_applications(cnic);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY, receipt_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER REFERENCES sales(id),
  stamp_id INTEGER REFERENCES stamp_paper_transactions(id),
  admission_id INTEGER REFERENCES admissions(id),
  scheme_app_id INTEGER REFERENCES scheme_applications(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  reference_no TEXT, notes TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  CHECK ((sale_id IS NOT NULL) + (stamp_id IS NOT NULL) + (admission_id IS NOT NULL) + (scheme_app_id IS NOT NULL) = 1)
);
CREATE INDEX idx_payments_paid_at ON payments(paid_at);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY, category TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH')),
  expense_date TEXT NOT NULL, note TEXT, created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE cash_entries (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('CASH_IN','CASH_OUT')),
  amount INTEGER NOT NULL CHECK (amount > 0), reason TEXT NOT NULL, entry_date TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE daily_closings (
  id INTEGER PRIMARY KEY, closing_date TEXT NOT NULL UNIQUE,
  opening_cash INTEGER NOT NULL CHECK (opening_cash >= 0), expected_cash INTEGER, actual_cash INTEGER,
  difference INTEGER, is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0,1)),
  closed_by INTEGER REFERENCES users(id), closed_at TEXT
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER, details TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE TABLE backup_logs (
  id INTEGER PRIMARY KEY, backup_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  file_path TEXT NOT NULL, size_bytes INTEGER, kind TEXT CHECK (kind IN ('MANUAL','AUTO','USB')),
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED')), message TEXT
);

-- Derived views
CREATE VIEW v_udhaar_balance AS
SELECT customer_id,
  SUM(CASE type WHEN 'CHARGE' THEN amount ELSE -amount END) AS balance
FROM udhaar_entries GROUP BY customer_id;

CREATE VIEW v_low_stock AS
SELECT id, name, stock_qty, low_stock_level FROM products WHERE is_active = 1 AND stock_qty <= low_stock_level;

INSERT INTO settings(key,value) VALUES
 ('shop_name','SAQIB PHOTO STATE'),('allow_negative_stock','0'),('max_cashier_discount_percent','5'),
 ('receipt_width_mm','80'),('tax_rate_percent','0'),('auto_backup_enabled','1');
INSERT INTO schema_migrations(id,name) VALUES (1,'001_init');
