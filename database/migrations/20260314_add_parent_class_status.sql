-- Add status columns needed by admin delete/deactivate flows

BEGIN;

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

COMMIT;
