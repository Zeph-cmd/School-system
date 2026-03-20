-- Extend users.status enum with suspension/termination lifecycle states
-- Existing apps already use suspended in runtime logic; this migration formalizes it.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_account_status' AND e.enumlabel = 'suspended'
  ) THEN
    ALTER TYPE user_account_status ADD VALUE 'suspended';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_account_status' AND e.enumlabel = 'terminated'
  ) THEN
    ALTER TYPE user_account_status ADD VALUE 'terminated';
  END IF;
END $$;

COMMIT;
