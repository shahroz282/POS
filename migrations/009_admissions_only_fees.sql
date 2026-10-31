CREATE TRIGGER admissions_only_fee_charge_insert
BEFORE INSERT ON admission_fee_charges
WHEN NEW.fee_type <> 'ADMISSION' OR NEW.fee_month IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Only one-time admission fee charges are supported');
END;

CREATE TRIGGER admissions_only_fee_charge_update
BEFORE UPDATE OF fee_type, fee_month ON admission_fee_charges
WHEN NEW.fee_type <> 'ADMISSION' OR NEW.fee_month IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Only one-time admission fee charges are supported');
END;

INSERT INTO schema_migrations(id, name) VALUES (9, '009_admissions_only_fees');
