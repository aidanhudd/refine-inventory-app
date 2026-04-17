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

### quantity_types
Examples:
- slab
- piece
- box
- sq ft
- bundle
- pallet

Upload these files to your GitHub repo root, then redeploy on Vercel.
