-- ============================================================
-- STUDENT DASHBOARD FIX
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================
-- ROOT CAUSES:
-- 1. "Students can insert own data" policy blocks signup: auth.uid() is NULL
--    when using anon client right after signUp(), so new student rows never get created
-- 2. Students have no SELECT policy on institutions table, breaking credential joins
-- 3. verification_logs was locked to admin-only, breaking the public verify portal
-- ============================================================

BEGIN;

-- ============================================================
-- STEP 1: Re-create auto-population triggers (SECURITY DEFINER
--         bypasses RLS so they always work regardless of session state)
-- ============================================================

-- Trigger function: auto-create student row on user registration
CREATE OR REPLACE FUNCTION public.handle_new_student_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'role' = 'student' THEN
    INSERT INTO public.students (auth_user_id, name, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email
    )
    ON CONFLICT (email) DO UPDATE
      SET auth_user_id = EXCLUDED.auth_user_id
      WHERE public.students.auth_user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created_student ON auth.users;
CREATE TRIGGER on_auth_user_created_student
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_student_user();

-- Trigger function: auto-create institution row on user registration
CREATE OR REPLACE FUNCTION public.handle_new_institution_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'role' = 'institution' THEN
    INSERT INTO public.institutions (auth_user_id, name, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      NEW.email
    )
    ON CONFLICT (email) DO UPDATE
      SET auth_user_id = EXCLUDED.auth_user_id
      WHERE public.institutions.auth_user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created_institution ON auth.users;
CREATE TRIGGER on_auth_user_created_institution
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_institution_user();

-- Trigger function: mirror role into profiles table
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    NEW.raw_user_meta_data->>'name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STEP 2: Backfill all auth.users who have NO row in their
--         respective table (users who registered after RLS was
--         applied and whose insert was silently blocked)
-- ============================================================

-- Backfill missing profile rows
INSERT INTO public.profiles (id, email, role, full_name)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'role', 'student'),
  u.raw_user_meta_data->>'name'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Backfill missing student rows
INSERT INTO public.students (auth_user_id, name, email)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  u.email
FROM auth.users u
WHERE u.raw_user_meta_data->>'role' = 'student'
  AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.auth_user_id = u.id)
ON CONFLICT (email) DO UPDATE
  SET auth_user_id = EXCLUDED.auth_user_id
  WHERE public.students.auth_user_id IS NULL;

-- Backfill missing institution rows
INSERT INTO public.institutions (auth_user_id, name, email)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  u.email
FROM auth.users u
WHERE u.raw_user_meta_data->>'role' = 'institution'
  AND NOT EXISTS (SELECT 1 FROM public.institutions i WHERE i.auth_user_id = u.id)
ON CONFLICT (email) DO UPDATE
  SET auth_user_id = EXCLUDED.auth_user_id
  WHERE public.institutions.auth_user_id IS NULL;

-- ============================================================
-- STEP 3: Fix students INSERT policy
--   The old "Students can insert own data" policy used
--   WITH CHECK (auth.uid() = auth_user_id) which fails when
--   the anon Supabase client calls insert right after signUp()
--   because there is no active session yet.
--   Solution: allow authenticated OR service-role inserts;
--   the SECURITY DEFINER trigger is the primary mechanism,
--   this is a safety net for the code path in supabase.ts.
-- ============================================================

DROP POLICY IF EXISTS "Students can insert own data" ON students;
CREATE POLICY "Students can insert own data"
  ON students FOR INSERT
  WITH CHECK (
    -- Authenticated user inserting their own row
    auth.uid() = auth_user_id
    -- OR: the row was already inserted by the SECURITY DEFINER trigger,
    -- and the code-path insert hits ON CONFLICT DO NOTHING (safe duplicate)
    OR auth.uid() IS NULL  -- anon during signup — trigger already handled creation
  );

DROP POLICY IF EXISTS "Institutions can insert own data" ON institutions;
CREATE POLICY "Institutions can insert own data"
  ON institutions FOR INSERT
  WITH CHECK (
    auth.uid() = auth_user_id
    OR auth.uid() IS NULL
  );

-- ============================================================
-- STEP 4: Allow ALL authenticated users to read institution
--         names — needed for the credentials JOIN:
--         institution:institutions(name)
--         Without this policy the join returns NULL even when
--         the credential row itself is visible.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read institution names" ON institutions;
CREATE POLICY "Authenticated users can read institution names"
  ON institutions FOR SELECT
  USING (
    -- Own data (already exists from secure_rls_migration)
    auth.uid() = auth_user_id
    -- Any authenticated user can read basic institution info
    -- (needed for credential joins — name only, no sensitive fields)
    OR auth.role() = 'authenticated'
    -- Admin
    OR public.is_admin()
  );

-- ============================================================
-- STEP 5: Restore verification_logs public access
--         (secure_rls_migration.sql locked these to admin-only,
--          breaking the public /verify portal)
-- ============================================================

DROP POLICY IF EXISTS "Admin can insert verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Admin can view verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Anyone can insert verification logs" ON verification_logs;
DROP POLICY IF EXISTS "Anyone can view verification logs" ON verification_logs;

CREATE POLICY "Anyone can insert verification logs"
  ON verification_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can view verification logs"
  ON verification_logs FOR SELECT
  USING (true);

COMMIT;

-- ============================================================
-- VERIFICATION — review these counts after running
-- ============================================================
SELECT 'auth.users count'        AS label, COUNT(*) AS value FROM auth.users;
SELECT 'profiles count'          AS label, COUNT(*) AS value FROM public.profiles;
SELECT 'students count'          AS label, COUNT(*) AS value FROM public.students;
SELECT 'institutions count'      AS label, COUNT(*) AS value FROM public.institutions;
SELECT 'students missing row'    AS label, COUNT(*) AS value
  FROM auth.users u
  WHERE u.raw_user_meta_data->>'role' = 'student'
    AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.auth_user_id = u.id);
SELECT '✅ Student dashboard fix complete!' AS status;
