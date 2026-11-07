PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

ALTER TABLE schemes ADD COLUMN scheme_code TEXT;
ALTER TABLE schemes ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (lifecycle_status IN ('ACTIVE','CLOSED','SUSPENDED'));
ALTER TABLE schemes ADD COLUMN updated_at TEXT;

UPDATE schemes
SET scheme_code = 'SC' || printf('%04d', id),
    lifecycle_status = CASE WHEN is_active = 1 THEN 'ACTIVE' ELSE 'CLOSED' END,
    updated_at = datetime('now','localtime');

CREATE UNIQUE INDEX idx_schemes_code ON schemes(scheme_code);
CREATE INDEX idx_schemes_lifecycle ON schemes(lifecycle_status);

CREATE TABLE scheme_categories (
  id INTEGER PRIMARY KEY,
  scheme_id INTEGER NOT NULL REFERENCES schemes(id),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (scheme_id, name)
);

CREATE TABLE scheme_custom_fields (
  id INTEGER PRIMARY KEY,
  scheme_id INTEGER NOT NULL REFERENCES schemes(id),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('TEXT','NUMBER','DATE','SELECT','CHECKBOX')),
  options_json TEXT,
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scheme_id, field_key)
);

CREATE TABLE scheme_document_requirements (
  id INTEGER PRIMARY KEY,
  scheme_id INTEGER NOT NULL REFERENCES schemes(id),
  name TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scheme_id, name)
);

ALTER TABLE scheme_applications ADD COLUMN application_no TEXT;
ALTER TABLE scheme_applications ADD COLUMN father_name TEXT;
ALTER TABLE scheme_applications ADD COLUMN address TEXT;
ALTER TABLE scheme_applications ADD COLUMN city TEXT;
ALTER TABLE scheme_applications ADD COLUMN district TEXT;
ALTER TABLE scheme_applications ADD COLUMN purpose TEXT;
ALTER TABLE scheme_applications ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0 AND discount_amount <= application_fee);
ALTER TABLE scheme_applications ADD COLUMN custom_fields_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE scheme_applications ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
  CHECK (processing_status IN ('RECEIVED','UNDER_REVIEW','SUBMITTED','APPROVED','REJECTED','PENDING_DOCUMENTS','COMPLETED','CANCELLED'));

UPDATE scheme_applications
SET processing_status = CASE status
  WHEN 'APPROVED' THEN 'APPROVED'
  WHEN 'REJECTED' THEN 'REJECTED'
  WHEN 'CANCELLED' THEN 'CANCELLED'
  ELSE 'RECEIVED'
END;

UPDATE scheme_applications AS current
SET application_no = 'SCH-' ||
  (SELECT scheme_code FROM schemes WHERE schemes.id = current.scheme_id) || '-' ||
  substr(current.application_date, 1, 4) || '-' ||
  printf('%04d', (
    SELECT COUNT(*) FROM scheme_applications AS prior
    WHERE prior.scheme_id = current.scheme_id
      AND substr(prior.application_date, 1, 4) = substr(current.application_date, 1, 4)
      AND prior.id <= current.id
  ));

CREATE UNIQUE INDEX idx_scheme_app_application_no ON scheme_applications(application_no);
CREATE INDEX idx_scheme_app_status ON scheme_applications(processing_status, application_date);
CREATE INDEX idx_scheme_app_mobile ON scheme_applications(mobile);

CREATE TABLE scheme_application_counters (
  scheme_id INTEGER NOT NULL REFERENCES schemes(id),
  application_year TEXT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (scheme_id, application_year)
);

INSERT INTO scheme_application_counters (scheme_id, application_year, last_value)
SELECT scheme_id, substr(application_date, 1, 4), COUNT(*)
FROM scheme_applications
GROUP BY scheme_id, substr(application_date, 1, 4);

CREATE TABLE scheme_application_status_history (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES scheme_applications(id),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('RECEIVED','UNDER_REVIEW','SUBMITTED','APPROVED','REJECTED','PENDING_DOCUMENTS','COMPLETED','CANCELLED')),
  remarks TEXT,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT INTO scheme_application_status_history (application_id, from_status, to_status, changed_by)
SELECT id, NULL, processing_status, created_by FROM scheme_applications;

CREATE TABLE scheme_application_documents (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES scheme_applications(id),
  requirement_id INTEGER REFERENCES scheme_document_requirements(id),
  category TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  replaced_by INTEGER REFERENCES scheme_application_documents(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE scheme_payment_reversals (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),
  reason TEXT NOT NULL,
  reversed_by INTEGER NOT NULL REFERENCES users(id),
  reversed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE payments_new (
  id INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER REFERENCES sales(id),
  stamp_id INTEGER REFERENCES stamp_paper_transactions(id),
  admission_id INTEGER REFERENCES admissions(id),
  scheme_app_id INTEGER REFERENCES scheme_applications(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','BANK','EASYPAISA','JAZZCASH','OTHER')),
  reference_no TEXT,
  notes TEXT,
  paid_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  idempotency_key TEXT,
  balance_after INTEGER,
  CHECK ((sale_id IS NOT NULL) + (stamp_id IS NOT NULL) + (admission_id IS NOT NULL) + (scheme_app_id IS NOT NULL) = 1)
);

INSERT INTO payments_new (
  id, receipt_no, sale_id, stamp_id, admission_id, scheme_app_id, amount, method,
  reference_no, notes, paid_at, created_by, idempotency_key, balance_after
)
SELECT
  id, receipt_no, sale_id, stamp_id, admission_id, scheme_app_id, amount, method,
  reference_no, notes, paid_at, created_by, idempotency_key, balance_after
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX idx_payments_paid_at ON payments(paid_at);
CREATE UNIQUE INDEX idx_payments_idempotency_key
  ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_payments_scheme_app ON payments(scheme_app_id);

UPDATE payments
SET balance_after = MAX(0,
  (SELECT application_fee - discount_amount
   FROM scheme_applications WHERE id = payments.scheme_app_id)
  - (SELECT COALESCE(SUM(prior.amount), 0)
     FROM payments prior
     WHERE prior.scheme_app_id = payments.scheme_app_id AND prior.id <= payments.id))
WHERE scheme_app_id IS NOT NULL AND balance_after IS NULL;

INSERT INTO schema_migrations(id, name) VALUES (11, '011_schemes_management');
COMMIT;
PRAGMA foreign_keys = ON;
