-- Add team_email to leave_requests in all tenant schemas and public (for existing DBs that don't have it).
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Add to each tenant schema from platform.tenants
  FOR r IN SELECT schema_name FROM platform.tenants WHERE status IS DISTINCT FROM 'cancelled'
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I.leave_requests ADD COLUMN IF NOT EXISTS team_email VARCHAR(255)', r.schema_name);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END LOOP;
  -- Add to public schema if leave_requests exists there
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leave_requests') THEN
    ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS team_email VARCHAR(255);
  END IF;
END $$;
