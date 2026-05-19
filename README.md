# Refine Inventory Estimator - v4

This version adds:
- edit existing items
- delete items
- mark items as sold
- add photos on create
- upload more photos to existing items
- photo thumbnails on inventory cards

## Important Supabase step for photos
Create a storage bucket named:
- inventory-photos

Set it to public.

## Existing tables still needed
### categories
Examples:
- Quartz
- Granite
- LVP
- SPC
- WPC
- Cabinets
- Tile / Hardwood

### subcategories
Optional subdivisions within a category. Each row links to a parent category via `category_id`.

Examples (under Cabinets):
- Base Cabinets
- Wall Cabinets
- Vanities

### quantity_types
Examples:
- slab
- piece
- box
- sq ft
- bundle
- pallet

Upload these files to your GitHub repo root, then redeploy on Vercel.

## Supabase Auth + inventory usage ownership

Apply this migration to add `inventory_usage.user_id` and RLS owner policies:

- `supabase/migrations/20260428_inventory_usage_user_auth.sql`

Apply this migration to add subcategories and optional `inventory_items.subcategory_id`:

- `supabase/migrations/20260519_inventory_subcategories.sql`

You can apply it in either of these ways:

1. Supabase Dashboard -> SQL Editor -> paste file contents -> Run.
2. Supabase CLI -> run `supabase db push` from project root (after linking your Supabase project).
