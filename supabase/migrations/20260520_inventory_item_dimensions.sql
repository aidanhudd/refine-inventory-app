-- Slab/remnant dimensions for stone categories (length, width, auto square footage).

alter table public.inventory_items
add column if not exists length_inches numeric,
add column if not exists width_inches numeric,
add column if not exists square_feet numeric;
