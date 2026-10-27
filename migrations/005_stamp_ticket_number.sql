ALTER TABLE stamp_paper_transactions ADD COLUMN ticket_number TEXT;
CREATE INDEX idx_stamp_ticket_number ON stamp_paper_transactions(ticket_number);

INSERT INTO schema_migrations(id, name) VALUES (5, '005_stamp_ticket_number');