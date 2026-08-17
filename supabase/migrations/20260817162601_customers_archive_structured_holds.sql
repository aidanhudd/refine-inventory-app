-- Phase 2: customer archive/reopen, structured holds, RESTRICT FKs, guarded RPCs.
-- Additive and safe for the currently deployed website (new columns ignored by old clients).
--
-- Do not apply until ready. Apply this migration before deploying the Phase 2 UI.
--
-- Stable exception format for UI mapping:
--   PHASE2:<REASON_CODE>:<human-readable message>
-- Success RPCs return the affected record UUID.

-- ---------------------------------------------------------------------------
-- Helpers (ensure present)
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

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_manager_or_admin() to authenticated;
grant execute on function public.has_app_access() to authenticated;

-- Private helper for stable PHASE2 errors. Not granted to authenticated/anon/public.
create or replace function public.phase2_raise(p_code text, p_message text)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  raise exception 'PHASE2:%:%', p_code, p_message
    using errcode = 'P0001';
end;
$$;

revoke all on function public.phase2_raise(text, text) from public;
revoke all on function public.phase2_raise(text, text) from anon;
revoke all on function public.phase2_raise(text, text) from authenticated;

-- ---------------------------------------------------------------------------
-- customers: archive / reopen columns + integrity
-- ---------------------------------------------------------------------------

alter table public.customers
  add column if not exists status text;

alter table public.customers
  add column if not exists archived_at timestamptz;

update public.customers
set status = 'active'
where status is null;

alter table public.customers
  alter column status set default 'active';

alter table public.customers
  alter column status set not null;

alter table public.customers drop constraint if exists customers_status_check;
alter table public.customers
  add constraint customers_status_check
  check (status in ('active', 'archived'));

alter table public.customers drop constraint if exists customers_archived_at_consistency;
alter table public.customers
  add constraint customers_archived_at_consistency
  check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  );

create index if not exists customers_status_idx
  on public.customers (status);

-- SECURITY DEFINER so it may call private phase2_raise without exposing that helper.
create or replace function public.enforce_customer_status_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'archived' and not public.is_manager_or_admin() then
      perform public.phase2_raise(
        'CUSTOMER_STATUS_FORBIDDEN',
        'Only managers and admins can create archived customers'
      );
    end if;

    -- archived_at is system-managed
    if new.status = 'archived' then
      new.archived_at := now();
    else
      new.archived_at := null;
    end if;

    return new;
  end if;

  -- UPDATE: archived_at is entirely system-managed
  if old.status is not distinct from new.status then
    -- Preserve system timestamp; ignore any client-supplied archived_at change
    new.archived_at := old.archived_at;
  else
    if not public.is_manager_or_admin() then
      perform public.phase2_raise(
        'CUSTOMER_STATUS_FORBIDDEN',
        'Only managers and admins can archive or reopen customers'
      );
    end if;

    if new.status = 'archived' then
      if exists (
        select 1
        from public.jobs j
        where j.customer_id = new.id
          and j.status = 'active'
      ) then
        perform public.phase2_raise(
          'CUSTOMER_HAS_ACTIVE_JOBS',
          'Archive blocked: customer still has active jobs'
        );
      end if;

      if exists (
        select 1
        from public.inventory_items i
        where i.hold_customer_id = new.id
      ) then
        perform public.phase2_raise(
          'CUSTOMER_HAS_STRUCTURED_HOLDS',
          'Archive blocked: customer still has items on structured hold'
        );
      end if;

      new.archived_at := now();
    elsif new.status = 'active' then
      new.archived_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists customers_enforce_status_rules on public.customers;
create trigger customers_enforce_status_rules
  before insert or update on public.customers
  for each row execute function public.enforce_customer_status_rules();

-- ---------------------------------------------------------------------------
-- jobs: cannot be active under an archived customer (concurrent-safe)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_job_active_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_status text;
begin
  if new.status = 'active' then
    select c.status
      into v_customer_status
    from public.customers c
    where c.id = new.customer_id
    for update;

    if not found then
      perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Customer not found for job');
    end if;

    if v_customer_status <> 'active' then
      perform public.phase2_raise(
        'CUSTOMER_ARCHIVED',
        'Cannot create or reopen an active job under an archived customer'
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_enforce_active_customer on public.jobs;
create trigger jobs_enforce_active_customer
  before insert or update on public.jobs
  for each row execute function public.enforce_job_active_customer();

-- ---------------------------------------------------------------------------
-- inventory_items: structured hold FKs (RESTRICT) + validation
-- ---------------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists hold_customer_id uuid;

alter table public.inventory_items
  add column if not exists hold_job_id uuid;

-- Always drop/recreate so ON DELETE RESTRICT is guaranteed (scoped to this table).
do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'inventory_items'
      and c.conname = 'inventory_items_hold_customer_id_fkey'
  ) then
    alter table public.inventory_items
      drop constraint inventory_items_hold_customer_id_fkey;
  end if;

  if exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'inventory_items'
      and c.conname = 'inventory_items_hold_job_id_fkey'
  ) then
    alter table public.inventory_items
      drop constraint inventory_items_hold_job_id_fkey;
  end if;
end
$$;

alter table public.inventory_items
  add constraint inventory_items_hold_customer_id_fkey
  foreign key (hold_customer_id) references public.customers(id) on delete restrict;

alter table public.inventory_items
  add constraint inventory_items_hold_job_id_fkey
  foreign key (hold_job_id) references public.jobs(id) on delete restrict;

create index if not exists inventory_items_hold_customer_id_idx
  on public.inventory_items (hold_customer_id)
  where hold_customer_id is not null;

create index if not exists inventory_items_hold_job_id_idx
  on public.inventory_items (hold_job_id)
  where hold_job_id is not null;

alter table public.inventory_items drop constraint if exists inventory_items_hold_job_requires_customer;
alter table public.inventory_items
  add constraint inventory_items_hold_job_requires_customer
  check (hold_job_id is null or hold_customer_id is not null);

create or replace function public.enforce_structured_hold_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
  v_job public.jobs%rowtype;
  v_old_held boolean;
  v_new_cleared boolean;
  v_new_structured boolean;
  v_snapshot text;
begin
  -- INSERT: no OLD row
  if tg_op = 'INSERT' then
    v_old_held := false;
  else
    v_old_held :=
      old.hold_customer_id is not null
      or old.hold_job_id is not null
      or (old.hold_last_name is not null and length(trim(old.hold_last_name)) > 0)
      or old.hold_at is not null;
  end if;

  v_new_cleared :=
    new.hold_customer_id is null
    and new.hold_job_id is null
    and (new.hold_last_name is null or length(trim(new.hold_last_name)) = 0)
    and new.hold_at is null;

  -- Rollback compatibility: old app clears hold_last_name + hold_at only.
  -- If structured FKs remain, clear them too so release still works after app rollback.
  if tg_op = 'UPDATE'
     and v_old_held
     and (new.hold_last_name is null or length(trim(new.hold_last_name)) = 0)
     and new.hold_at is null
     and (new.hold_customer_id is not null or new.hold_job_id is not null)
  then
    new.hold_customer_id := null;
    new.hold_job_id := null;
    return new;
  end if;

  if v_new_cleared then
    return new;
  end if;

  v_new_structured := new.hold_customer_id is not null;

  -- Prevent replacing an existing structured or legacy hold without releasing first.
  if tg_op = 'UPDATE' and v_old_held then
    if new.hold_customer_id is distinct from old.hold_customer_id
       or new.hold_job_id is distinct from old.hold_job_id
       or coalesce(trim(new.hold_last_name), '') is distinct from coalesce(trim(old.hold_last_name), '')
       or new.hold_at is distinct from old.hold_at
    then
      -- Allow no-op / same-hold updates that only reaffirm identical values (already excluded above).
      -- Any material change while held requires release first.
      perform public.phase2_raise(
        'ITEM_ALREADY_HELD',
        'Item already has a structured or legacy hold; release it first'
      );
    end if;
    return new;
  end if;

  -- Legacy-only hold write (text without FKs): allow for historical compatibility.
  if not v_new_structured then
    if new.hold_job_id is not null then
      perform public.phase2_raise(
        'HOLD_JOB_WITHOUT_CUSTOMER',
        'Structured hold requires a customer when a job is set'
      );
    end if;
    return new;
  end if;

  -- Allowed new structured hold: derive snapshot + timestamp from DB (do not trust client text).
  if new.hold_job_id is not null then
    -- Lock order: job first, then its customer
    select * into v_job
    from public.jobs j
    where j.id = new.hold_job_id
    for update;

    if not found then
      perform public.phase2_raise('JOB_NOT_FOUND', 'Hold job not found');
    end if;

    select * into v_customer
    from public.customers c
    where c.id = v_job.customer_id
    for update;

    if not found then
      perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Hold customer not found');
    end if;

    if new.hold_customer_id is distinct from v_job.customer_id then
      perform public.phase2_raise(
        'HOLD_JOB_CUSTOMER_MISMATCH',
        'Hold job does not belong to the selected customer'
      );
    end if;

    if v_customer.status <> 'active' then
      perform public.phase2_raise(
        'CUSTOMER_ARCHIVED',
        'Cannot place a hold on an archived customer'
      );
    end if;

    if v_job.status <> 'active' then
      perform public.phase2_raise(
        'JOB_NOT_ACTIVE',
        'Cannot place a hold on a completed or archived job'
      );
    end if;

    v_snapshot := trim(v_customer.name) || ' — ' || trim(v_job.name);
  else
    select * into v_customer
    from public.customers c
    where c.id = new.hold_customer_id
    for update;

    if not found then
      perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Hold customer not found');
    end if;

    if v_customer.status <> 'active' then
      perform public.phase2_raise(
        'CUSTOMER_ARCHIVED',
        'Cannot place a hold on an archived customer'
      );
    end if;

    v_snapshot := trim(v_customer.name);
  end if;

  if v_snapshot is null or length(v_snapshot) = 0 then
    perform public.phase2_raise('HOLD_INCOMPLETE', 'Hold snapshot could not be derived');
  end if;

  new.hold_last_name := v_snapshot;
  new.hold_at := now();

  return new;
end;
$$;

drop trigger if exists inventory_items_enforce_structured_hold on public.inventory_items;
create trigger inventory_items_enforce_structured_hold
  before insert or update of hold_customer_id, hold_job_id, hold_last_name, hold_at
  on public.inventory_items
  for each row execute function public.enforce_structured_hold_integrity();

-- Trigger functions remain callable by the table owner via triggers, but are not
-- directly executable by clients.
revoke all on function public.enforce_customer_status_rules() from public;
revoke all on function public.enforce_customer_status_rules() from anon;
revoke all on function public.enforce_customer_status_rules() from authenticated;

revoke all on function public.enforce_job_active_customer() from public;
revoke all on function public.enforce_job_active_customer() from anon;
revoke all on function public.enforce_job_active_customer() from authenticated;

revoke all on function public.enforce_structured_hold_integrity() from public;
revoke all on function public.enforce_structured_hold_integrity() from anon;
revoke all on function public.enforce_structured_hold_integrity() from authenticated;

-- ---------------------------------------------------------------------------
-- inventory_usage.job_id: SET NULL -> RESTRICT
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'inventory_usage'
      and c.conname = 'inventory_usage_job_id_fkey'
  ) then
    alter table public.inventory_usage
      drop constraint inventory_usage_job_id_fkey;
  end if;
end
$$;

alter table public.inventory_usage
  add constraint inventory_usage_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Guarded RPCs: archive / reopen customer
-- ---------------------------------------------------------------------------

create or replace function public.archive_customer(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  if not public.is_manager_or_admin() then
    perform public.phase2_raise('FORBIDDEN', 'Only managers and admins can archive customers');
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Customer not found');
  end if;

  if v_customer.status = 'archived' then
    perform public.phase2_raise('CUSTOMER_ALREADY_ARCHIVED', 'Customer is already archived');
  end if;

  if exists (
    select 1 from public.jobs j
    where j.customer_id = p_customer_id and j.status = 'active'
  ) then
    perform public.phase2_raise(
      'CUSTOMER_HAS_ACTIVE_JOBS',
      'Archive blocked: customer still has active jobs'
    );
  end if;

  if exists (
    select 1 from public.inventory_items i
    where i.hold_customer_id = p_customer_id
  ) then
    perform public.phase2_raise(
      'CUSTOMER_HAS_STRUCTURED_HOLDS',
      'Archive blocked: customer still has items on structured hold'
    );
  end if;

  -- archived_at is set by enforce_customer_status_rules (system-managed)
  update public.customers
  set status = 'archived'
  where id = p_customer_id;

  return p_customer_id;
end;
$$;

create or replace function public.reopen_customer(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  if not public.is_manager_or_admin() then
    perform public.phase2_raise('FORBIDDEN', 'Only managers and admins can reopen customers');
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Customer not found');
  end if;

  if v_customer.status = 'active' then
    perform public.phase2_raise('CUSTOMER_ALREADY_ACTIVE', 'Customer is already active');
  end if;

  update public.customers
  set status = 'active'
  where id = p_customer_id;

  return p_customer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guarded RPCs: delete unused job / customer
-- ---------------------------------------------------------------------------

create or replace function public.delete_unused_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  if not public.is_manager_or_admin() then
    perform public.phase2_raise('FORBIDDEN', 'Only managers and admins can delete jobs');
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    perform public.phase2_raise('JOB_NOT_FOUND', 'Job not found');
  end if;

  if exists (select 1 from public.inventory_usage u where u.job_id = p_job_id) then
    perform public.phase2_raise(
      'JOB_HAS_USAGE',
      'Delete blocked: job has inventory usage; archive instead'
    );
  end if;

  if exists (select 1 from public.inventory_items i where i.hold_job_id = p_job_id) then
    perform public.phase2_raise(
      'JOB_HAS_STRUCTURED_HOLDS',
      'Delete blocked: job has current structured holds; release holds or archive instead'
    );
  end if;

  delete from public.jobs where id = p_job_id;
  return p_job_id;
end;
$$;

create or replace function public.delete_unused_customer(p_customer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customers%rowtype;
begin
  if not public.is_manager_or_admin() then
    perform public.phase2_raise('FORBIDDEN', 'Only managers and admins can delete customers');
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Customer not found');
  end if;

  if exists (select 1 from public.jobs j where j.customer_id = p_customer_id) then
    perform public.phase2_raise(
      'CUSTOMER_HAS_JOBS',
      'Delete blocked: customer still has jobs; archive instead'
    );
  end if;

  if exists (
    select 1 from public.inventory_items i where i.hold_customer_id = p_customer_id
  ) then
    perform public.phase2_raise(
      'CUSTOMER_HAS_STRUCTURED_HOLDS',
      'Delete blocked: customer has current structured holds; release holds or archive instead'
    );
  end if;

  -- Legacy free-text holds do not hard-block deletion (no retained hold history).
  -- UI should warn on exact name match separately.

  delete from public.customers where id = p_customer_id;
  return p_customer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guarded RPCs: place / release hold
-- ---------------------------------------------------------------------------

create or replace function public.place_item_hold(
  p_item_id uuid,
  p_customer_id uuid,
  p_job_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items%rowtype;
  v_customer public.customers%rowtype;
  v_job public.jobs%rowtype;
  v_snapshot text;
  v_resolved_customer_id uuid;
begin
  if not public.has_app_access() then
    perform public.phase2_raise('FORBIDDEN', 'Approved app access is required to place holds');
  end if;

  if p_customer_id is null then
    perform public.phase2_raise('HOLD_CUSTOMER_REQUIRED', 'Customer is required to place a hold');
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    perform public.phase2_raise('ITEM_NOT_FOUND', 'Inventory item not found');
  end if;

  if v_item.hold_customer_id is not null
     or v_item.hold_job_id is not null
     or (v_item.hold_last_name is not null and length(trim(v_item.hold_last_name)) > 0)
     or v_item.hold_at is not null
  then
    perform public.phase2_raise(
      'ITEM_ALREADY_HELD',
      'Item already has a structured or legacy hold; release it first'
    );
  end if;

  if p_job_id is not null then
    -- Lock order: job first, then customer
    select * into v_job
    from public.jobs
    where id = p_job_id
    for update;

    if not found then
      perform public.phase2_raise('JOB_NOT_FOUND', 'Job not found');
    end if;

    select * into v_customer
    from public.customers
    where id = v_job.customer_id
    for update;

    if not found then
      perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Customer not found');
    end if;

    if v_job.customer_id <> p_customer_id then
      perform public.phase2_raise(
        'HOLD_JOB_CUSTOMER_MISMATCH',
        'Hold job does not belong to the selected customer'
      );
    end if;

    if v_customer.status <> 'active' then
      perform public.phase2_raise(
        'CUSTOMER_ARCHIVED',
        'Cannot place a hold for an archived customer; reopen the customer first'
      );
    end if;

    if v_job.status <> 'active' then
      perform public.phase2_raise(
        'JOB_NOT_ACTIVE',
        'Cannot place a hold on a completed or archived job'
      );
    end if;

    v_resolved_customer_id := v_job.customer_id;
    v_snapshot := trim(v_customer.name) || ' — ' || trim(v_job.name);
  else
    select * into v_customer
    from public.customers
    where id = p_customer_id
    for update;

    if not found then
      perform public.phase2_raise('CUSTOMER_NOT_FOUND', 'Customer not found');
    end if;

    if v_customer.status <> 'active' then
      perform public.phase2_raise(
        'CUSTOMER_ARCHIVED',
        'Cannot place a hold for an archived customer; reopen the customer first'
      );
    end if;

    v_resolved_customer_id := v_customer.id;
    v_snapshot := trim(v_customer.name);
  end if;

  if v_snapshot is null or length(v_snapshot) = 0 then
    perform public.phase2_raise('HOLD_INCOMPLETE', 'Hold snapshot could not be derived');
  end if;

  -- Trigger will re-derive snapshot/timestamp; values here are complete structured hold inputs.
  update public.inventory_items
  set hold_customer_id = v_resolved_customer_id,
      hold_job_id = p_job_id,
      hold_last_name = v_snapshot,
      hold_at = now()
  where id = p_item_id;

  return p_item_id;
end;
$$;

create or replace function public.release_item_hold(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items%rowtype;
  v_is_held boolean;
begin
  if not public.has_app_access() then
    perform public.phase2_raise('FORBIDDEN', 'Approved app access is required to release holds');
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    perform public.phase2_raise('ITEM_NOT_FOUND', 'Inventory item not found');
  end if;

  v_is_held :=
    v_item.hold_customer_id is not null
    or v_item.hold_job_id is not null
    or (v_item.hold_last_name is not null and length(trim(v_item.hold_last_name)) > 0)
    or v_item.hold_at is not null;

  if not v_is_held then
    perform public.phase2_raise('ITEM_NOT_HELD', 'Item is not currently on hold');
  end if;

  update public.inventory_items
  set hold_customer_id = null,
      hold_job_id = null,
      hold_last_name = null,
      hold_at = null
  where id = p_item_id;

  return p_item_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC grants: authenticated only (revoke PUBLIC / anon)
-- ---------------------------------------------------------------------------

revoke all on function public.phase2_raise(text, text) from public;
revoke all on function public.phase2_raise(text, text) from anon;
revoke all on function public.phase2_raise(text, text) from authenticated;

revoke all on function public.archive_customer(uuid) from public;
revoke all on function public.archive_customer(uuid) from anon;
grant execute on function public.archive_customer(uuid) to authenticated;

revoke all on function public.reopen_customer(uuid) from public;
revoke all on function public.reopen_customer(uuid) from anon;
grant execute on function public.reopen_customer(uuid) to authenticated;

revoke all on function public.delete_unused_job(uuid) from public;
revoke all on function public.delete_unused_job(uuid) from anon;
grant execute on function public.delete_unused_job(uuid) to authenticated;

revoke all on function public.delete_unused_customer(uuid) from public;
revoke all on function public.delete_unused_customer(uuid) from anon;
grant execute on function public.delete_unused_customer(uuid) to authenticated;

revoke all on function public.place_item_hold(uuid, uuid, uuid) from public;
revoke all on function public.place_item_hold(uuid, uuid, uuid) from anon;
grant execute on function public.place_item_hold(uuid, uuid, uuid) to authenticated;

revoke all on function public.release_item_hold(uuid) from public;
revoke all on function public.release_item_hold(uuid) from anon;
grant execute on function public.release_item_hold(uuid) to authenticated;
