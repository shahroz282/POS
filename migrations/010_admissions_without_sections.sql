CREATE TRIGGER admissions_reject_section_insert
BEFORE INSERT ON admissions
WHEN NEW.section_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Sections are not supported for admissions');
END;

CREATE TRIGGER admissions_reject_section_update
BEFORE UPDATE OF section_id ON admissions
WHEN NEW.section_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Sections are not supported for admissions');
END;

INSERT INTO schema_migrations(id, name) VALUES (10, '010_admissions_without_sections');
