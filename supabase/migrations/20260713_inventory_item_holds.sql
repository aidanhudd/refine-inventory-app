-- Customer hold: associate a last name when an item should not be shown to other customers.

alter table public.inventory_items
  add column if not exists hold_last_name text;

alter table public.inventory_items
  add column if not exists hold_at timestamptz;

create index if not exists inventory_items_hold_last_name_idx
  on public.inventory_items (hold_last_name)
  where hold_last_name is not null;
