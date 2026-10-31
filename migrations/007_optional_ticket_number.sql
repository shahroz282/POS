DROP TRIGGER validate_simple_stamp_ticket_insert;
DROP TRIGGER validate_simple_stamp_ticket_update;

ALTER TABLE stamp_paper_transactions
  ADD COLUMN has_ticket_number INTEGER NOT NULL DEFAULT 0 CHECK (has_ticket_number IN (0, 1));

UPDATE stamp_paper_transactions
SET has_ticket_number = CASE WHEN ticket_number IS NOT NULL AND length(trim(ticket_number)) > 0 THEN 1 ELSE 0 END;

INSERT INTO schema_migrations(id, name) VALUES (7, '007_optional_ticket_number');
