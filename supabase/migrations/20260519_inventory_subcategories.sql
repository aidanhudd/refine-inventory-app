-- Subcategories nested under categories; optional link from inventory items.

create table if not exists public.subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

create index if not exists subcategories_category_id_idx
on public.subcategories(category_id);

alter table public.inventory_items
add column if not exists subcategory_id uuid references public.subcategories(id) on delete set null;

create index if not exists inventory_items_subcategory_id_idx
on public.inventory_items(subcategory_id);
