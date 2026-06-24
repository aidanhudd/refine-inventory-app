-- Fix automatic profile creation on auth signup.
-- Run this in Supabase SQL Editor if new auth.users rows are not creating public.profiles rows.
--
-- Common causes this fixes:
--   1. profiles table or required columns missing
--   2. trigger/function never created
--   3. supabase_auth_admin lacks INSERT on public.profiles

-- ---------------------------------------------------------------------------
-- Ensure profiles table exists with required columns
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'pending',
  approved boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists approved boolean;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references auth.users(id);
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

update public.profiles set role = 'pending' where role is null;
update public.profiles set approved = false where approved is null;

alter table public.profiles alter column role set default 'pending';
alter table public.profiles alter column role set not null;
alter table public.profiles alter column approved set default false;
alter table public.profiles alter column approved set not null;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('pending', 'employee', 'manager', 'admin'));

-- Keep approved in sync with role for existing rows.
update public.profiles
set approved = true,
    approved_at = coalesce(approved_at, now())
where role in ('employee', 'manager', 'admin')
  and approved = false;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_approved_idx on public.profiles(approved);

-- ---------------------------------------------------------------------------
-- Trigger: create profile row for every new auth.users account
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    'pending',
    false
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();

  return new;
exception
  when others then
    raise exception 'handle_new_user failed for %: %', new.id, sqlerrm;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auth admin must be able to insert profiles from the trigger.
grant usage on schema public to supabase_auth_admin;
grant insert, update on table public.profiles to supabase_auth_admin;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Safety net: callable after login if profile row is missing
-- ---------------------------------------------------------------------------

create or replace function public.ensure_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles (id, email, full_name, role, approved)
  select
    u.id,
    u.email,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
    'pending',
    false
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;

grant execute on function public.ensure_user_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Access helpers + RLS
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' and approved = true from public.profiles where id = auth.uid()),
    false
  )
$$;

create or replace function public.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select approved = true and role in ('employee', 'manager', 'admin')
      from public.profiles
      where id = auth.uid()
    ),
    false
  )
$$;

create or replace function public.prevent_profile_role_self_escalation()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.id and new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'Only admins can change profile roles';
    end if;
  end if;

  if new.role in ('employee', 'manager', 'admin') then
    new.approved := true;
    if new.approved_at is null then
      new.approved_at := now();
    end if;
    if new.approved_by is null then
      new.approved_by := auth.uid();
    end if;
  end if;

  if new.role = 'pending' then
    new.approved := false;
    new.approved_at := null;
    new.approved_by := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;

create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.prevent_profile_role_self_escalation();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_select_admin"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());

create policy "profiles_update_admin"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Backfill existing auth.users into public.profiles
-- Run this block once after the migration above.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, email, full_name, role, approved, created_at, updated_at)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  'pending',
  false,
  coalesce(u.created_at, now()),
  now()
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- After backfill, promote your first admin manually:
-- update public.profiles
-- set role = 'admin', approved = true, approved_at = now()
-- where email = 'your-admin-email@example.com';
