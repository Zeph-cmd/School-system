-- Migrate users.status to approval workflow states
-- pending | approved | declined

BEGIN;

DO $$
BEGIN
  CREATE TYPE user_account_status AS ENUM ('pending', 'approved', 'declined');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO roles (role_name, description)
VALUES ('student', 'Student account (pending/approved workflow)')
ON CONFLICT (role_name) DO NOTHING;

-- Remove legacy status check constraint if present
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;

-- Remove legacy default before type conversion
ALTER TABLE users ALTER COLUMN status DROP DEFAULT;

-- Map old statuses to new approval statuses before type change
UPDATE users
SET status = CASE
  WHEN status = 'active' THEN 'approved'
  WHEN status IN ('inactive', 'suspended') THEN 'declined'
  WHEN status IN ('pending', 'approved', 'declined') THEN status
  ELSE 'pending'
END;

-- Ensure no nulls remain
UPDATE users SET status = 'pending' WHERE status IS NULL;

-- Convert column to enum and set default/not-null
ALTER TABLE users
  ALTER COLUMN status TYPE user_account_status
  USING status::user_account_status;

ALTER TABLE users
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL;

COMMIT;
