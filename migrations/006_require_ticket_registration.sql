CREATE TRIGGER validate_simple_stamp_ticket_insert
BEFORE INSERT ON stamp_paper_transactions
WHEN NEW.transaction_id IS NOT NULL AND (NEW.ticket_number IS NULL OR length(trim(NEW.ticket_number)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'Ticket number is required. Enter the ticket number.');
END;

CREATE TRIGGER validate_simple_stamp_registration_insert
BEFORE INSERT ON stamp_paper_transactions
WHEN NEW.transaction_id IS NOT NULL AND (NEW.register_no IS NULL OR length(trim(NEW.register_no)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'Registration is required. Enter the registration.');
END;

CREATE TRIGGER validate_simple_stamp_ticket_update
BEFORE UPDATE OF ticket_number ON stamp_paper_transactions
WHEN NEW.transaction_id IS NOT NULL AND (NEW.ticket_number IS NULL OR length(trim(NEW.ticket_number)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'Ticket number is required. Enter the ticket number.');
END;

CREATE TRIGGER validate_simple_stamp_registration_update
BEFORE UPDATE OF register_no ON stamp_paper_transactions
WHEN NEW.transaction_id IS NOT NULL AND (NEW.register_no IS NULL OR length(trim(NEW.register_no)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'Registration is required. Enter the registration.');
END;

INSERT INTO schema_migrations(id, name) VALUES (6, '006_require_ticket_registration');