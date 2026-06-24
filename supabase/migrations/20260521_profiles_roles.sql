-- Role-based access for employee self-signup with admin approval.
-- Assumes public.profiles already exists with id uuid primary key references auth.users(id).

-- ---------------------------------------------------------------------------
-- Columns to add on public.profiles
-- ---------------------------------------------------------------------------
-- Required:
--   role text not null default 'pending'
-- Optional but recommended:
--   approved_at timestamptz
--   approved_by uuid references auth.users(id)
--   updated_at timestamptz
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists role text;

alter table public.profiles
  alter column role set default 'pending';

update public.profiles
set role = 'pending'
where role is null;

alter table public.profiles
  alter column role set not null;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('pending', 'employee', 'manager', 'admin'));

alter table public.profiles
  add column if not exists approved_at timestamptz;

alter table public.profiles
  add column if not exists approved_by uuid references auth.users(id);

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

create index if not exists profiles_role_idx on public.profiles(role);

-- ---------------------------------------------------------------------------
-- Create/update profile on auth signup with default pending role
-- Adjust column list if your profiles table uses different names.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'pending')
  on conflict (id) do update
    set email = excluded.email,
        role = coalesce(public.profiles.role, 'pending'),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers for RLS
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

create or replace function public.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('employee', 'manager', 'admin') from public.profiles where id = auth.uid()),
    false
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
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

  if new.role <> 'pending' and old.role = 'pending' then
    if new.approved_at is null then
      new.approved_at := now();
    end if;
    if new.approved_by is null then
      new.approved_by := auth.uid();
    end if;
  end if;

  if new.role = 'pending' then
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

-- ---------------------------------------------------------------------------
-- Profiles RLS
-- ---------------------------------------------------------------------------

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
-- Bootstrap your first admin (run manually after migration):
-- update public.profiles
-- set role = 'admin', approved_at = now()
-- where email = 'your-admin-email@example.com';
-- ---------------------------------------------------------------------------
