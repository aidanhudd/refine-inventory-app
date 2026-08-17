-- Migration A: customers/jobs schema prerequisites (additive, safe for currently deployed website).
-- Does NOT change inventory_usage select/update/delete policies.
--
-- Rollout:
--   1. Apply this migration (supabase/migrations/20260817152650_customers_jobs_schema.sql).
--   2. Verify the old website still works.
--   3. Deploy the corrected application.
--   4. Verify customer/job creation and own usage undo.
--   5. Convert supabase/pending/inventory_usage_shared_access.sql into a new
--      uniquely timestamped migration under supabase/migrations (later UTC timestamp).
--   6. Apply that new Migration B.
--   7. Verify shared visibility and undo permissions.
--
-- Do not apply pending shared-access SQL until steps 1–4 are complete.
-- Keeping it outside supabase/migrations prevents db push from applying both stages together.

-- ---------------------------------------------------------------------------
-- Helpers needed by customers/jobs
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select approved = true and role in ('manager', 'admin')
      from public.profiles
      where id = auth.uid()
    ),
    false
  )
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_manager_or_admin() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists customers_name_lower_idx
  on public.customers (lower(name));

create index if not exists customers_created_by_idx
  on public.customers (created_by);

create index if not exists customers_created_at_idx
  on public.customers (created_at desc);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

alter table public.customers enable row level security;

drop policy if exists "customers_select_app" on public.customers;
create policy "customers_select_app"
  on public.customers
  for select
  to authenticated
  using (public.has_app_access());

drop policy if exists "customers_insert_app" on public.customers;
create policy "customers_insert_app"
  on public.customers
  for insert
  to authenticated
  with check (
    public.has_app_access()
    and created_by = auth.uid()
  );

drop policy if exists "customers_update_app" on public.customers;
create policy "customers_update_app"
  on public.customers
  for update
  to authenticated
  using (
    public.has_app_access()
    and (created_by = auth.uid() or public.is_manager_or_admin())
  )
  with check (
    public.has_app_access()
    and (created_by = auth.uid() or public.is_manager_or_admin())
  );

grant select, insert, update on table public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  name text not null,
  address text,
  notes text,
  status text not null default 'active',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint jobs_name_not_blank check (length(trim(name)) > 0),
  constraint jobs_status_check check (status in ('active', 'completed', 'archived'))
);

create index if not exists jobs_customer_id_idx
  on public.jobs (customer_id);

create index if not exists jobs_status_idx
  on public.jobs (status);

create index if not exists jobs_created_by_idx
  on public.jobs (created_by);

create index if not exists jobs_status_updated_at_idx
  on public.jobs (status, updated_at desc);

create index if not exists jobs_name_lower_idx
  on public.jobs (lower(name));

create or replace function public.enforce_job_status_change_permission()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    if not public.is_manager_or_admin() then
      raise exception 'Only managers and admins can mark jobs completed or archived';
    end if;

    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;

    if new.status = 'active' then
      new.completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

drop trigger if exists jobs_enforce_status_change on public.jobs;
create trigger jobs_enforce_status_change
  before update on public.jobs
  for each row execute function public.enforce_job_status_change_permission();

alter table public.jobs enable row level security;

drop policy if exists "jobs_select_app" on public.jobs;
create policy "jobs_select_app"
  on public.jobs
  for select
  to authenticated
  using (public.has_app_access());

drop policy if exists "jobs_insert_app" on public.jobs;
create policy "jobs_insert_app"
  on public.jobs
  for insert
  to authenticated
  with check (
    public.has_app_access()
    and created_by = auth.uid()
    and status = 'active'
  );

drop policy if exists "jobs_update_app" on public.jobs;
create policy "jobs_update_app"
  on public.jobs
  for update
  to authenticated
  using (
    public.has_app_access()
    and (created_by = auth.uid() or public.is_manager_or_admin())
  )
  with check (
    public.has_app_access()
    and (created_by = auth.uid() or public.is_manager_or_admin())
  );

grant select, insert, update on table public.jobs to authenticated;

-- ---------------------------------------------------------------------------
-- inventory_usage: nullable job_id only (keep job_name; do not change usage RLS here)
-- ---------------------------------------------------------------------------

alter table public.inventory_usage
  add column if not exists job_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_usage_job_id_fkey'
  ) then
    alter table public.inventory_usage
      add constraint inventory_usage_job_id_fkey
      foreign key (job_id) references public.jobs(id) on delete set null;
  end if;
end
$$;

create index if not exists inventory_usage_job_id_idx
  on public.inventory_usage (job_id);
