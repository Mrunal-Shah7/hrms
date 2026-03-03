-- Fix 1: Remove UNIQUE constraint from registration_requests.slug
-- Run this if the database already exists with the constraint:
-- psql $DATABASE_URL -f scripts/fix1-drop-reg-slug-unique.sql
ALTER TABLE platform.registration_requests DROP CONSTRAINT IF EXISTS registration_requests_slug_key;
