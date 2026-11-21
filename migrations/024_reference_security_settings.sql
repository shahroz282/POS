BEGIN IMMEDIATE;

INSERT OR IGNORE INTO settings(key,value) VALUES ('delete_pin','1234');
INSERT OR IGNORE INTO settings(key,value) VALUES ('login_pin','1234');
UPDATE stamp_paper_transactions
SET issue_status = 'ISSUED',
    issued_date = COALESCE(issued_date, date(created_at))
WHERE transaction_id IS NOT NULL
  AND status != 'CANCELLED';

INSERT OR IGNORE INTO schema_migrations(id, name) VALUES (24, '024_reference_security_settings');
COMMIT;
