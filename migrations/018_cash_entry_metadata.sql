ALTER TABLE cash_entries ADD COLUMN department TEXT NOT NULL DEFAULT 'GENERAL'
  CHECK (department IN ('GENERAL','SALES','STAMP_PAPER','ADMISSIONS','SCHEMES','PHOTOCOPY','INVENTORY','FILER_CUSTOMERS','UDHAAR'));
ALTER TABLE cash_entries ADD COLUMN reference TEXT;
CREATE INDEX idx_cash_entries_date_department ON cash_entries(entry_date, department, type);

INSERT INTO schema_migrations(id, name) VALUES (18, '018_cash_entry_metadata');
