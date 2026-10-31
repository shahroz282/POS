ALTER TABLE students ADD COLUMN student_no TEXT;
ALTER TABLE students ADD COLUMN father_cnic TEXT;
ALTER TABLE students ADD COLUMN father_phone TEXT;
ALTER TABLE students ADD COLUMN b_form_number TEXT;
ALTER TABLE students ADD COLUMN gender TEXT CHECK (gender IS NULL OR gender IN ('MALE','FEMALE','OTHER'));
ALTER TABLE students ADD COLUMN whatsapp TEXT;
ALTER TABLE students ADD COLUMN address TEXT;
ALTER TABLE students ADD COLUMN previous_school TEXT;
ALTER TABLE students ADD COLUMN previous_qualification TEXT;
ALTER TABLE students ADD COLUMN previous_roll_number TEXT;
CREATE UNIQUE INDEX idx_students_student_no ON students(student_no) WHERE student_no IS NOT NULL;

CREATE TABLE class_sections (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES class_folders(id),
  section_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (class_id, section_name)
);

ALTER TABLE class_folders ADD COLUMN admission_fee INTEGER NOT NULL DEFAULT 0 CHECK (admission_fee >= 0);
ALTER TABLE class_folders ADD COLUMN monthly_fee INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0);
ALTER TABLE admissions ADD COLUMN section_id INTEGER REFERENCES class_sections(id);
ALTER TABLE admissions ADD COLUMN program TEXT;
ALTER TABLE admissions ADD COLUMN education_board TEXT;
ALTER TABLE admissions ADD COLUMN previous_school TEXT;
ALTER TABLE admissions ADD COLUMN academic_session TEXT;
CREATE INDEX idx_admissions_class_date ON admissions(class_id, admission_date);
CREATE INDEX idx_admissions_student ON admissions(student_id, id);

CREATE TABLE admission_fee_charges (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admissions(id),
  fee_type TEXT NOT NULL CHECK (fee_type IN ('ADMISSION','TUITION','REGISTRATION','EXAMINATION','OTHER')),
  description TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0 AND discount_amount <= amount),
  fee_month TEXT,
  due_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (fee_month IS NULL OR (length(fee_month) = 7 AND fee_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'))
);
CREATE UNIQUE INDEX idx_admission_monthly_charge
  ON admission_fee_charges(admission_id, fee_type, fee_month)
  WHERE fee_month IS NOT NULL;
CREATE UNIQUE INDEX idx_admission_one_time_charge
  ON admission_fee_charges(admission_id, fee_type)
  WHERE fee_month IS NULL;

CREATE TABLE admission_payment_allocations (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  charge_id INTEGER NOT NULL REFERENCES admission_fee_charges(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  UNIQUE (payment_id, charge_id)
);
CREATE INDEX idx_admission_allocations_charge ON admission_payment_allocations(charge_id);

ALTER TABLE payments ADD COLUMN idempotency_key TEXT;
ALTER TABLE payments ADD COLUMN balance_after INTEGER;
CREATE UNIQUE INDEX idx_payments_idempotency_key ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

INSERT INTO admission_fee_charges (admission_id, fee_type, description, amount, created_by)
SELECT id, 'ADMISSION', 'Original admission fee', fee, created_by
FROM admissions
WHERE fee > 0;

WITH ranked_payments AS (
  SELECT p.id AS payment_id, c.id AS charge_id, p.amount,
    c.amount - c.discount_amount AS charge_total,
    SUM(p.amount) OVER (PARTITION BY c.id ORDER BY p.id ROWS UNBOUNDED PRECEDING) AS running_paid
  FROM payments p
  JOIN admission_fee_charges c ON c.admission_id = p.admission_id AND c.fee_type = 'ADMISSION'
  WHERE p.admission_id IS NOT NULL
), allocated AS (
  SELECT payment_id, charge_id,
    MIN(amount, MAX(0, charge_total - (running_paid - amount))) AS allocated_amount
  FROM ranked_payments
)
INSERT INTO admission_payment_allocations (payment_id, charge_id, amount)
SELECT payment_id, charge_id, allocated_amount FROM allocated WHERE allocated_amount > 0;

UPDATE payments
SET balance_after =
  COALESCE((SELECT SUM(c.amount - c.discount_amount) FROM admission_fee_charges c WHERE c.admission_id = payments.admission_id), 0)
  - COALESCE((SELECT SUM(prior.amount) FROM payments prior
    WHERE prior.admission_id = payments.admission_id AND prior.id <= payments.id), 0)
WHERE admission_id IS NOT NULL;

INSERT INTO schema_migrations(id, name) VALUES (8, '008_admissions_fee_management');
