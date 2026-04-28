-- Attach auth user to inventory usage records and lock table access to the owner.

alter table public.inventory_usage
add column if not exists user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_usage_user_id_fkey'
  ) then
    alter table public.inventory_usage
    add constraint inventory_usage_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end
$$;

create index if not exists inventory_usage_user_id_idx
on public.inventory_usage(user_id);

alter table public.inventory_usage enable row level security;

drop policy if exists "usage_select_own" on public.inventory_usage;
create policy "usage_select_own"
on public.inventory_usage
for select
using (auth.uid() = user_id);

drop policy if exists "usage_insert_own" on public.inventory_usage;
create policy "usage_insert_own"
on public.inventory_usage
for insert
with check (auth.uid() = user_id);

drop policy if exists "usage_update_own" on public.inventory_usage;
create policy "usage_update_own"
on public.inventory_usage
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "usage_delete_own" on public.inventory_usage;
create policy "usage_delete_own"
on public.inventory_usage
for delete
using (auth.uid() = user_id);
