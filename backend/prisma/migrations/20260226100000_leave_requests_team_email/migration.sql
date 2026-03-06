-- Add team_email to leave_requests (tenant schemas: run per schema or apply tenant-schema change)
-- This migration is for reference; tenant schemas are typically updated via tenant-schema.sql for new provisioned tenants.
-- For existing tenant schemas, run: ALTER TABLE <schema>.leave_requests ADD COLUMN IF NOT EXISTS team_email VARCHAR(255);
SELECT 1;
