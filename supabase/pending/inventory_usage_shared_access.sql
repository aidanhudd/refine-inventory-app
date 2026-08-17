-- PENDING Migration B: shared warehouse inventory_usage visibility and permissioned undo.
--
-- This file is intentionally outside supabase/migrations so it is NOT applied by
-- `supabase db push` together with Migration A.
--
-- After the corrected application is deployed and own-user behavior is verified:
--   1. Apply Migration A: supabase/migrations/20260817152650_customers_jobs_schema.sql
--   2. Verify the old website still works.
--   3. Deploy the corrected application.
--   4. Verify customer/job creation and own usage undo.
--   5. Move/copy this file into supabase/migrations using a NEW later 14-digit UTC
--      timestamp, e.g. YYYYMMDDHHmmss_inventory_usage_shared_access.sql
--      (do not reuse 20260817152650).
--   6. Apply that new Migration B.
--   7. Verify shared visibility and undo permissions.
--
-- Do not perform step 5 until steps 1–4 are complete.

alter table public.inventory_usage enable row level security;

-- Approved-team SELECT (replaces owner-only select)
drop policy if exists "usage_select_own" on public.inventory_usage;
drop policy if exists "usage_select_app" on public.inventory_usage;
create policy "usage_select_app"
  on public.inventory_usage
  for select
  to authenticated
  using (public.has_app_access());

-- Own-row INSERT (preserve owner insert; require app access)
drop policy if exists "usage_insert_own" on public.inventory_usage;
create policy "usage_insert_own"
  on public.inventory_usage
  for insert
  to authenticated
  with check (
    public.has_app_access()
    and auth.uid() = user_id
  );

-- Own-row UPDATE (preserve)
drop policy if exists "usage_update_own" on public.inventory_usage;
create policy "usage_update_own"
  on public.inventory_usage
  for update
  to authenticated
  using (
    public.has_app_access()
    and auth.uid() = user_id
  )
  with check (
    public.has_app_access()
    and auth.uid() = user_id
  );

-- DELETE: row owner or manager/admin
drop policy if exists "usage_delete_own" on public.inventory_usage;
drop policy if exists "usage_delete_app" on public.inventory_usage;
create policy "usage_delete_app"
  on public.inventory_usage
  for delete
  to authenticated
  using (
    public.has_app_access()
    and (auth.uid() = user_id or public.is_manager_or_admin())
  );
