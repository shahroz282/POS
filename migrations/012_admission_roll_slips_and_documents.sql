BEGIN IMMEDIATE;

ALTER TABLE admissions ADD COLUMN subjects TEXT;
ALTER TABLE admissions ADD COLUMN roll_number TEXT;
ALTER TABLE admissions ADD COLUMN registration_number TEXT;
ALTER TABLE admissions ADD COLUMN expected_slip_date TEXT;
ALTER TABLE admissions ADD COLUMN slip_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (slip_status IN ('PENDING','READY_TO_CALL','CALLED_INFORMED','SLIP_DELIVERED'));

CREATE UNIQUE INDEX idx_admissions_roll_number
  ON admissions(class_id, roll_number) WHERE roll_number IS NOT NULL AND roll_number <> '';
CREATE UNIQUE INDEX idx_admissions_registration_number
  ON admissions(registration_number) WHERE registration_number IS NOT NULL AND registration_number <> '';
CREATE INDEX idx_admissions_slip_reminders
  ON admissions(slip_status, expected_slip_date);

CREATE TABLE admission_documents (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admissions(id),
  category TEXT NOT NULL CHECK (category IN ('BANK_CHALLAN','ADMISSION_FORM','ROLL_NUMBER_SLIP')),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','application/pdf')),
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_admission_documents_admission
  ON admission_documents(admission_id, is_active, uploaded_at);

INSERT INTO schema_migrations(id, name) VALUES (12, '012_admission_roll_slips_and_documents');
COMMIT;
