-- Approved Price Book foundation migration (Checkpoint 1A).
-- Applying it creates the manual price-book foundation.
-- It does not create PDF import tables, storage buckets, or saved estimates.
--
-- Depends on objects already installed by earlier migrations:
--   public.has_app_access()
--   public.is_manager_or_admin()
--   public.set_updated_at()
--   auth.uid()
--   auth.users
--   public.inventory_items(id uuid)
--
-- This script does not add or update inventory quantity or unit_cost columns.
-- It does add:
--   a foreign key from the new link table to inventory_items
--   a BEFORE DELETE trigger on inventory_items that removes link rows only
-- PostgreSQL will also install its own foreign-key trigger on inventory_items.
-- Neither trigger assigns quantity_on_hand or unit_cost.
--
-- Read access for approved users includes purchase cost. Hide Prices is a screen
-- preference in the application and is not enforced here.
--
-- Waste, estimate snapshots, and PDF import batches are intentionally absent.
-- Future import matching still has to compare purchase cost, pricing unit,
-- price basis, coverage quantity, coverage unit, and price_conversion_confirmed.
-- A supplier identifier match by itself is not an unchanged row. This schema
-- rejects saving a per-box purchase cost on a per-square-foot material unless
-- price_conversion_confirmed is true and coverage ties the box to square feet.
--
-- numeric accepts NaN and Infinity. Checks reject those values explicitly.
-- A comparison such as cost >= 0 does not reject NaN, because numeric NaN
-- sorts above every finite number.
--
-- Supplier-backed materials are saved with price_book_save_supplier_material().
-- One call creates or updates the material and the identifiers passed in that
-- call. When the supplier stays the same, a null or blank identifier argument
-- leaves that identifier in place. A supplier change does not reuse omitted
-- codes from the previous supplier. It requires at least one new code, deletes
-- the previous identifiers, and inserts only the codes in that call. If the
-- supplier change has no new code, the function raises before it writes, so
-- the entry, identifiers, and audit history stay as they were.
-- Separate requests cannot satisfy the deferred identifier requirement,
-- because that check runs at commit.
--
-- Identifier edits and removal use price_book_save_supplier_identifier() and
-- price_book_remove_supplier_identifier(). Both lock the material row first,
-- then its identifier rows in id order, matching the material save. Removing
-- the last identifier from a supplier-backed material is rejected. Authenticated
-- clients can read identifiers and cannot insert, update, or delete them directly.
--
-- Materials store cost_source and cost_effective_on. Manual saves record
-- cost_source = manual. pdf_import is a valid stored value for a later import
-- writer; this manual function never writes it. When a manual save changes
-- purchase_cost, cost_source becomes manual again. An unchanged purchase cost
-- keeps the existing source, including a future pdf_import. Labor rows keep
-- both columns null.
--
-- Identifier changes and supplier reassignment lock the material row first,
-- then that material's identifier rows in id order. A concurrent change waits.
-- It cannot commit an identifier whose supplier differs from the material.
--
-- Calculation contract (numeric only; half away from zero):
--   unit selling price = round(cost per pricing unit / (1 - gross margin / 100), 6)
--   line total         = round(quantity * unit selling price, 2)
-- When price basis equals pricing unit, cost per pricing unit is the purchase cost.
-- When one side is box and the other equals the coverage unit, coverage converts
-- the purchase cost into the pricing unit before the margin division.
-- Labor per square foot uses the manual rate at 4 decimal places:
--   line total = round(quantity * selling rate, 2)
-- Flat labor is one charge: quantity 1, line total = round(selling rate, 2).
--
-- Worked examples, not executed by this file:
--   100.0000 cost, 40% margin, same unit
--     unit selling price 166.666667
--     quantity 1 line total 166.67
--   1.2345 cost per sq ft, 40% margin, quantity 125.5
--     unit selling price 2.057500
--     extension 258.216250
--     line total 258.22
--   40.0000 per box, confirmed conversion, 20 sq ft per box, sell per sq ft, 40%
--     cost per sq ft 2.0000
--     unit selling price 3.333333

begin;

-- ---------------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.has_app_access()') is null
     or to_regprocedure('public.is_manager_or_admin()') is null
     or to_regprocedure('public.set_updated_at()') is null
     or to_regprocedure('auth.uid()') is null
     or to_regclass('auth.users') is null then
    raise exception
      'PRICEBOOK:MISSING_HELPERS:Apply the existing profile and customer migrations before this script';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception
      'PRICEBOOK:MISSING_ROLE:Supabase roles anon and authenticated are required';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_items'
      and column_name = 'id'
      and udt_name = 'uuid'
  ) then
    raise exception
      'PRICEBOOK:INVENTORY_ID_TYPE:public.inventory_items.id must be uuid';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Private error helper. Not granted to client roles.
-- ---------------------------------------------------------------------------

create or replace function public.price_book_raise(p_code text, p_message text)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  raise exception 'PRICEBOOK:%:%', p_code, p_message
    using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Shape and calculation helpers
-- ---------------------------------------------------------------------------

create or replace function public.price_book_shape_message(p_code text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  return case p_code
    when 'ENTRY_TYPE' then 'Entry type must be material, demolition, or installation.'
    when 'PRICING_UNIT' then 'Pricing unit is not valid for this entry type.'
    when 'PRICE_BASIS' then 'Price basis must be square foot, linear foot, each, or box.'
    when 'COST_RANGE' then 'Purchase cost must be zero or greater.'
    when 'COST_SCALE' then 'Purchase cost supports at most 4 decimal places.'
    when 'COST_SOURCE' then 'Material cost source must be manual entry or PDF import.'
    when 'COST_EFFECTIVE_DATE' then 'Material cost needs an effective date.'
    when 'MARGIN_RANGE' then 'Gross margin must be at least 0 and less than 100.'
    when 'MARGIN_SCALE' then 'Gross margin supports at most 2 decimal places.'
    when 'COVERAGE_RANGE' then 'Coverage quantity must be greater than zero.'
    when 'COVERAGE_SCALE' then 'Coverage quantity supports at most 4 decimal places.'
    when 'COVERAGE_UNIT' then 'Coverage unit must be square foot, linear foot, or each.'
    when 'COVERAGE_PAIR' then 'Enter both a coverage quantity and a coverage unit.'
    when 'COVERAGE_NOT_APPLICABLE' then 'Coverage is stored for a box, or for a confirmed conversion to or from a box.'
    when 'CONVERSION_FLAG' then 'Price conversion confirmation must be true or false.'
    when 'CONVERSION_REQUIRED' then 'A different price basis and pricing unit need a confirmed coverage conversion. A per-box price cannot be applied to another unit without that confirmation.'
    when 'CONVERSION_NOT_APPLICABLE' then 'Confirm a conversion only when the price basis and pricing unit differ.'
    when 'CONVERSION_INVALID' then 'Confirmed conversion is only supported between a box and the coverage unit.'
    when 'LABOR_FIELD' then 'Demolition and installation store a manual selling rate. They do not store purchase cost, cost source, cost effective date, gross margin, or coverage.'
    when 'LABOR_SUPPLIER' then 'Demolition and installation entries do not use a supplier.'
    when 'LABOR_RATE' then 'Labor selling rate must be zero or greater.'
    when 'LABOR_RATE_SCALE' then 'Labor selling rate supports at most 4 decimal places.'
    else 'Price book entry is invalid.'
  end;
end;
$$;

do $$
begin
  if to_regclass('public.price_book_entries') is not null then
    alter table public.price_book_entries
      drop constraint if exists price_book_entries_shape;
  end if;
end
$$;

drop function if exists public.price_book_entry_shape_code(
  text, text, text, boolean, numeric, text, numeric, numeric, numeric, uuid
);

create or replace function public.price_book_entry_shape_code(
  p_entry_type text,
  p_pricing_unit text,
  p_price_basis text,
  p_price_conversion_confirmed boolean,
  p_coverage_quantity numeric,
  p_coverage_unit text,
  p_purchase_cost numeric,
  p_gross_margin_percent_override numeric,
  p_labor_selling_rate numeric,
  p_supplier_id uuid,
  p_cost_source text,
  p_cost_effective_on date
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_coverage_ok boolean;
begin
  if p_entry_type is null
     or p_entry_type not in ('material', 'demolition', 'installation') then
    return 'ENTRY_TYPE';
  end if;

  if p_entry_type = 'material' then
    if p_labor_selling_rate is not null then
      return 'LABOR_FIELD';
    end if;

    if p_purchase_cost is null
       or p_purchase_cost < 0
       or p_purchase_cost > 99999999.9999
       or p_purchase_cost = 'NaN'::numeric
       or p_purchase_cost = 'Infinity'::numeric
       or p_purchase_cost = '-Infinity'::numeric then
      return 'COST_RANGE';
    end if;
    if p_purchase_cost <> round(p_purchase_cost, 4) then
      return 'COST_SCALE';
    end if;

    if p_cost_source is null or p_cost_source not in ('manual', 'pdf_import') then
      return 'COST_SOURCE';
    end if;
    if p_cost_effective_on is null then
      return 'COST_EFFECTIVE_DATE';
    end if;

    if p_pricing_unit is null
       or p_pricing_unit not in ('sq_ft', 'linear_ft', 'each', 'box') then
      return 'PRICING_UNIT';
    end if;
    if p_price_basis is null
       or p_price_basis not in ('sq_ft', 'linear_ft', 'each', 'box') then
      return 'PRICE_BASIS';
    end if;

    if p_gross_margin_percent_override is not null then
      if p_gross_margin_percent_override = 'NaN'::numeric
         or p_gross_margin_percent_override = 'Infinity'::numeric
         or p_gross_margin_percent_override = '-Infinity'::numeric
         or p_gross_margin_percent_override < 0
         or p_gross_margin_percent_override >= 100 then
        return 'MARGIN_RANGE';
      end if;
      if p_gross_margin_percent_override <> round(p_gross_margin_percent_override, 2) then
        return 'MARGIN_SCALE';
      end if;
    end if;

    if p_coverage_quantity is null and p_coverage_unit is null then
      v_coverage_ok := false;
    elsif p_coverage_quantity is not null and p_coverage_unit is not null then
      if p_coverage_quantity = 'NaN'::numeric
         or p_coverage_quantity = 'Infinity'::numeric
         or p_coverage_quantity = '-Infinity'::numeric
         or p_coverage_quantity <= 0
         or p_coverage_quantity > 99999999.9999 then
        return 'COVERAGE_RANGE';
      end if;
      if p_coverage_quantity <> round(p_coverage_quantity, 4) then
        return 'COVERAGE_SCALE';
      end if;
      if p_coverage_unit not in ('sq_ft', 'linear_ft', 'each') then
        return 'COVERAGE_UNIT';
      end if;
      v_coverage_ok := true;
    else
      return 'COVERAGE_PAIR';
    end if;

    if p_price_conversion_confirmed is null then
      return 'CONVERSION_FLAG';
    end if;

    if p_pricing_unit = p_price_basis then
      if p_price_conversion_confirmed then
        return 'CONVERSION_NOT_APPLICABLE';
      end if;
      if p_pricing_unit <> 'box' and v_coverage_ok then
        return 'COVERAGE_NOT_APPLICABLE';
      end if;
      return null;
    end if;

    if not p_price_conversion_confirmed or not v_coverage_ok then
      return 'CONVERSION_REQUIRED';
    end if;

    if (p_price_basis = 'box' and p_pricing_unit = p_coverage_unit and p_pricing_unit <> 'box')
       or (p_pricing_unit = 'box' and p_price_basis = p_coverage_unit and p_price_basis <> 'box') then
      return null;
    end if;

    return 'CONVERSION_INVALID';
  end if;

  if p_supplier_id is not null then
    return 'LABOR_SUPPLIER';
  end if;
  if p_pricing_unit is null or p_pricing_unit not in ('sq_ft', 'flat') then
    return 'PRICING_UNIT';
  end if;
  if p_price_basis is not null
     or p_purchase_cost is not null
     or p_gross_margin_percent_override is not null
     or p_coverage_quantity is not null
     or p_coverage_unit is not null
     or p_cost_source is not null
     or p_cost_effective_on is not null
     or p_price_conversion_confirmed is distinct from false then
    return 'LABOR_FIELD';
  end if;
  if p_labor_selling_rate is null
     or p_labor_selling_rate < 0
     or p_labor_selling_rate > 99999999.9999
     or p_labor_selling_rate = 'NaN'::numeric
     or p_labor_selling_rate = 'Infinity'::numeric
     or p_labor_selling_rate = '-Infinity'::numeric then
    return 'LABOR_RATE';
  end if;
  if p_labor_selling_rate <> round(p_labor_selling_rate, 4) then
    return 'LABOR_RATE_SCALE';
  end if;

  return null;
end;
$$;

create or replace function public.price_book_effective_material_margin(
  p_override numeric,
  p_company_default numeric
)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if p_override is not null then
    if p_override = 'NaN'::numeric
       or p_override = 'Infinity'::numeric
       or p_override = '-Infinity'::numeric
       or p_override < 0
       or p_override >= 100 then
      perform public.price_book_raise(
        'MARGIN_RANGE',
        'Gross margin must be at least 0 and less than 100.'
      );
    end if;
    if p_override <> round(p_override, 2) then
      perform public.price_book_raise(
        'MARGIN_SCALE',
        'Gross margin supports at most 2 decimal places.'
      );
    end if;
    return p_override;
  end if;

  if p_company_default is null then
    perform public.price_book_raise(
      'MARGIN_RANGE',
      'Company gross margin is not configured.'
    );
  end if;
  if p_company_default <> round(p_company_default, 2) then
    perform public.price_book_raise(
      'MARGIN_SCALE',
      'Gross margin supports at most 2 decimal places.'
    );
  end if;
  if p_company_default < 0 or p_company_default >= 100 then
    perform public.price_book_raise(
      'MARGIN_RANGE',
      'Gross margin must be at least 0 and less than 100.'
    );
  end if;
  return p_company_default;
end;
$$;

create or replace function public.price_book_material_unit_selling_price(
  p_purchase_cost numeric,
  p_margin_percent numeric,
  p_pricing_unit text,
  p_price_basis text,
  p_coverage_quantity numeric,
  p_coverage_unit text,
  p_conversion_confirmed boolean
)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_code text;
  v_cost numeric;
begin
  if p_margin_percent is null then
    perform public.price_book_raise(
      'MARGIN_RANGE',
      'Gross margin must be at least 0 and less than 100.'
    );
  end if;

  v_code := public.price_book_entry_shape_code(
    'material',
    p_pricing_unit,
    p_price_basis,
    p_conversion_confirmed,
    p_coverage_quantity,
    p_coverage_unit,
    p_purchase_cost,
    p_margin_percent,
    null,
    null,
    'manual',
    date '2000-01-01'
  );
  if v_code is not null then
    perform public.price_book_raise(v_code, public.price_book_shape_message(v_code));
  end if;

  if p_pricing_unit = p_price_basis then
    v_cost := p_purchase_cost;
  elsif p_price_basis = 'box' then
    v_cost := p_purchase_cost / p_coverage_quantity;
  elsif p_pricing_unit = 'box' then
    v_cost := p_purchase_cost * p_coverage_quantity;
  else
    perform public.price_book_raise(
      'CONVERSION_INVALID',
      public.price_book_shape_message('CONVERSION_INVALID')
    );
  end if;

  return round(v_cost / (1 - (p_margin_percent / 100)), 6);
end;
$$;

create or replace function public.price_book_line_total(
  p_quantity numeric,
  p_unit_price numeric
)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if p_quantity is null
     or p_quantity < 0
     or p_quantity > 99999999.9999
     or p_quantity = 'NaN'::numeric
     or p_quantity = 'Infinity'::numeric
     or p_quantity = '-Infinity'::numeric
     or p_quantity <> round(p_quantity, 4) then
    perform public.price_book_raise(
      'QUANTITY_RANGE',
      'Quantity must be zero or greater, with at most 4 decimal places.'
    );
  end if;
  if p_unit_price is null
     or p_unit_price < 0
     or p_unit_price = 'NaN'::numeric
     or p_unit_price = 'Infinity'::numeric
     or p_unit_price = '-Infinity'::numeric then
    perform public.price_book_raise(
      'PRICE_RANGE',
      'Unit price must be zero or greater.'
    );
  end if;
  if p_unit_price <> round(p_unit_price, 6) then
    perform public.price_book_raise(
      'PRICE_SCALE',
      'Unit price supports at most 6 decimal places. Round the unit selling price before extending the line.'
    );
  end if;

  return round(p_quantity * p_unit_price, 2);
end;
$$;

create or replace function public.price_book_material_line_total(
  p_quantity numeric,
  p_purchase_cost numeric,
  p_margin_percent numeric,
  p_pricing_unit text,
  p_price_basis text,
  p_coverage_quantity numeric,
  p_coverage_unit text,
  p_conversion_confirmed boolean
)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_unit numeric;
begin
  v_unit := public.price_book_material_unit_selling_price(
    p_purchase_cost,
    p_margin_percent,
    p_pricing_unit,
    p_price_basis,
    p_coverage_quantity,
    p_coverage_unit,
    p_conversion_confirmed
  );
  return public.price_book_line_total(p_quantity, v_unit);
end;
$$;

create or replace function public.price_book_labor_line_total(
  p_pricing_unit text,
  p_selling_rate numeric,
  p_quantity numeric
)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if p_pricing_unit is null or p_pricing_unit not in ('sq_ft', 'flat') then
    perform public.price_book_raise(
      'PRICING_UNIT',
      'Labor pricing unit must be square foot or flat.'
    );
  end if;
  if p_selling_rate is null
     or p_selling_rate < 0
     or p_selling_rate > 99999999.9999
     or p_selling_rate = 'NaN'::numeric
     or p_selling_rate = 'Infinity'::numeric
     or p_selling_rate = '-Infinity'::numeric then
    perform public.price_book_raise(
      'LABOR_RATE',
      'Labor selling rate must be zero or greater.'
    );
  end if;
  if p_selling_rate <> round(p_selling_rate, 4) then
    perform public.price_book_raise(
      'LABOR_RATE_SCALE',
      'Labor selling rate supports at most 4 decimal places.'
    );
  end if;

  if p_pricing_unit = 'flat' then
    if p_quantity is distinct from 1 then
      perform public.price_book_raise(
        'LABOR_FLAT_QUANTITY',
        'Flat labor is one charge. Quantity must be 1.'
      );
    end if;
    return round(p_selling_rate, 2);
  end if;

  if p_quantity is null
     or p_quantity < 0
     or p_quantity > 99999999.9999
     or p_quantity = 'NaN'::numeric
     or p_quantity = 'Infinity'::numeric
     or p_quantity = '-Infinity'::numeric
     or p_quantity <> round(p_quantity, 4) then
    perform public.price_book_raise(
      'QUANTITY_RANGE',
      'Quantity must be zero or greater, with at most 4 decimal places.'
    );
  end if;

  return round(p_quantity * p_selling_rate, 2);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.price_book_settings (
  id smallint primary key,
  default_material_gross_margin_percent numeric(5, 2) not null default 40,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users (id) on delete set null,
  constraint price_book_settings_singleton check (id = 1),
  constraint price_book_settings_margin_range check (
    default_material_gross_margin_percent >= 0
    and default_material_gross_margin_percent < 100
    and default_material_gross_margin_percent <> 'NaN'::numeric
    and default_material_gross_margin_percent <> 'Infinity'::numeric
    and default_material_gross_margin_percent <> '-Infinity'::numeric
  )
);

create table if not exists public.price_book_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text null,
  status text not null default 'active',
  archived_at timestamptz null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users (id) on delete set null
);

create table if not exists public.price_book_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null,
  name text not null,
  category text null,
  description text null,
  status text not null default 'active',
  archived_at timestamptz null,
  pricing_unit text not null,
  price_basis text null,
  price_conversion_confirmed boolean not null default false,
  coverage_quantity numeric(12, 4) null,
  coverage_unit text null,
  supplier_id uuid null references public.price_book_suppliers (id) on delete restrict,
  purchase_cost numeric(12, 4) null,
  gross_margin_percent_override numeric(5, 2) null,
  cost_source text null,
  cost_effective_on date null,
  labor_selling_rate numeric(12, 4) null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users (id) on delete set null
);

alter table public.price_book_entries
  add column if not exists cost_source text;

alter table public.price_book_entries
  add column if not exists cost_effective_on date;

create table if not exists public.price_book_supplier_identifiers (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.price_book_entries (id) on delete restrict,
  supplier_id uuid not null references public.price_book_suppliers (id) on delete restrict,
  kind text not null,
  code text not null,
  code_norm text generated always as (nullif(upper(btrim(code)), '')) stored,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- One catalog material can link to many inventory records (batches, slabs,
-- locations). Each inventory record links to at most one catalog material.
-- Deleting an inventory record removes the link row only.
create table if not exists public.price_book_entry_inventory_items (
  entry_id uuid not null references public.price_book_entries (id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (entry_id, inventory_item_id)
);

create table if not exists public.price_book_audit (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid null references auth.users (id) on delete set null,
  action text not null,
  table_name text not null,
  entry_id uuid null,
  supplier_id uuid null,
  inventory_item_id uuid null,
  identifier_id uuid null,
  before_data jsonb null,
  after_data jsonb null
);

alter table public.price_book_settings
  drop constraint if exists price_book_settings_margin_range;
alter table public.price_book_settings
  add constraint price_book_settings_margin_range
  check (
    default_material_gross_margin_percent >= 0
    and default_material_gross_margin_percent < 100
    and default_material_gross_margin_percent <> 'NaN'::numeric
    and default_material_gross_margin_percent <> 'Infinity'::numeric
    and default_material_gross_margin_percent <> '-Infinity'::numeric
  );

alter table public.price_book_suppliers
  drop constraint if exists price_book_suppliers_name_length;
alter table public.price_book_suppliers
  add constraint price_book_suppliers_name_length
  check (char_length(btrim(name)) between 1 and 200);

alter table public.price_book_suppliers
  drop constraint if exists price_book_suppliers_notes_length;
alter table public.price_book_suppliers
  add constraint price_book_suppliers_notes_length
  check (notes is null or char_length(btrim(notes)) between 1 and 4000);

alter table public.price_book_suppliers
  drop constraint if exists price_book_suppliers_status_check;
alter table public.price_book_suppliers
  add constraint price_book_suppliers_status_check
  check (status in ('active', 'archived'));

alter table public.price_book_suppliers
  drop constraint if exists price_book_suppliers_archive_check;
alter table public.price_book_suppliers
  add constraint price_book_suppliers_archive_check
  check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  );

alter table public.price_book_entries
  drop constraint if exists price_book_entries_name_length;
alter table public.price_book_entries
  add constraint price_book_entries_name_length
  check (char_length(btrim(name)) between 1 and 200);

alter table public.price_book_entries
  drop constraint if exists price_book_entries_category_length;
alter table public.price_book_entries
  add constraint price_book_entries_category_length
  check (category is null or char_length(btrim(category)) between 1 and 80);

alter table public.price_book_entries
  drop constraint if exists price_book_entries_description_length;
alter table public.price_book_entries
  add constraint price_book_entries_description_length
  check (description is null or char_length(btrim(description)) between 1 and 4000);

alter table public.price_book_entries
  drop constraint if exists price_book_entries_status_check;
alter table public.price_book_entries
  add constraint price_book_entries_status_check
  check (status in ('active', 'archived'));

alter table public.price_book_entries
  drop constraint if exists price_book_entries_archive_check;
alter table public.price_book_entries
  add constraint price_book_entries_archive_check
  check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  );

alter table public.price_book_entries
  drop constraint if exists price_book_entries_margin_range;
alter table public.price_book_entries
  add constraint price_book_entries_margin_range
  check (
    gross_margin_percent_override is null
    or (
      gross_margin_percent_override >= 0
      and gross_margin_percent_override < 100
      and gross_margin_percent_override <> 'NaN'::numeric
      and gross_margin_percent_override <> 'Infinity'::numeric
      and gross_margin_percent_override <> '-Infinity'::numeric
    )
  );

alter table public.price_book_entries
  drop constraint if exists price_book_entries_cost_range;
alter table public.price_book_entries
  add constraint price_book_entries_cost_range
  check (
    purchase_cost is null
    or (
      purchase_cost >= 0
      and purchase_cost <> 'NaN'::numeric
      and purchase_cost <> 'Infinity'::numeric
      and purchase_cost <> '-Infinity'::numeric
    )
  );

alter table public.price_book_entries
  drop constraint if exists price_book_entries_labor_rate_range;
alter table public.price_book_entries
  add constraint price_book_entries_labor_rate_range
  check (
    labor_selling_rate is null
    or (
      labor_selling_rate >= 0
      and labor_selling_rate <> 'NaN'::numeric
      and labor_selling_rate <> 'Infinity'::numeric
      and labor_selling_rate <> '-Infinity'::numeric
    )
  );

alter table public.price_book_entries
  drop constraint if exists price_book_entries_coverage_range;
alter table public.price_book_entries
  add constraint price_book_entries_coverage_range
  check (
    coverage_quantity is null
    or (
      coverage_quantity > 0
      and coverage_quantity <> 'NaN'::numeric
      and coverage_quantity <> 'Infinity'::numeric
      and coverage_quantity <> '-Infinity'::numeric
    )
  );

alter table public.price_book_entries
  drop constraint if exists price_book_entries_shape;
alter table public.price_book_entries
  add constraint price_book_entries_shape
  check (
    public.price_book_entry_shape_code(
      entry_type,
      pricing_unit,
      price_basis,
      price_conversion_confirmed,
      coverage_quantity,
      coverage_unit,
      purchase_cost,
      gross_margin_percent_override,
      labor_selling_rate,
      supplier_id,
      cost_source,
      cost_effective_on
    ) is null
  );

alter table public.price_book_entries
  drop constraint if exists price_book_entries_cost_provenance;
alter table public.price_book_entries
  add constraint price_book_entries_cost_provenance
  check (
    (
      entry_type = 'material'
      and cost_source in ('manual', 'pdf_import')
      and cost_effective_on is not null
    )
    or (
      entry_type in ('demolition', 'installation')
      and cost_source is null
      and cost_effective_on is null
    )
  );

alter table public.price_book_supplier_identifiers
  drop constraint if exists price_book_supplier_identifiers_kind_check;
alter table public.price_book_supplier_identifiers
  add constraint price_book_supplier_identifiers_kind_check
  check (kind in ('supplier_sku', 'internal'));

alter table public.price_book_supplier_identifiers
  drop constraint if exists price_book_supplier_identifiers_code_length;
alter table public.price_book_supplier_identifiers
  add constraint price_book_supplier_identifiers_code_length
  check (char_length(btrim(code)) between 1 and 80);

alter table public.price_book_audit
  drop constraint if exists price_book_audit_action_check;
alter table public.price_book_audit
  add constraint price_book_audit_action_check
  check (action in (
    'create',
    'update',
    'archive',
    'restore',
    'identifier_create',
    'identifier_update',
    'identifier_delete',
    'link_inventory',
    'unlink_inventory'
  ));

alter table public.price_book_audit
  drop constraint if exists price_book_audit_table_check;
alter table public.price_book_audit
  add constraint price_book_audit_table_check
  check (table_name in (
    'price_book_settings',
    'price_book_suppliers',
    'price_book_entries',
    'price_book_supplier_identifiers',
    'price_book_entry_inventory_items'
  ));

create unique index if not exists price_book_suppliers_name_uidx
  on public.price_book_suppliers (lower(btrim(name)));

create index if not exists price_book_suppliers_status_idx
  on public.price_book_suppliers (status);

create index if not exists price_book_entries_type_status_idx
  on public.price_book_entries (entry_type, status);

create index if not exists price_book_entries_supplier_idx
  on public.price_book_entries (supplier_id);

create index if not exists price_book_entries_name_idx
  on public.price_book_entries (lower(name));

create index if not exists price_book_entries_category_idx
  on public.price_book_entries (lower(category));

create unique index if not exists price_book_supplier_identifiers_code_uidx
  on public.price_book_supplier_identifiers (supplier_id, code_norm);

create unique index if not exists price_book_supplier_identifiers_entry_kind_uidx
  on public.price_book_supplier_identifiers (entry_id, kind);

create unique index if not exists price_book_entry_inventory_items_item_uidx
  on public.price_book_entry_inventory_items (inventory_item_id);

create index if not exists price_book_audit_entry_idx
  on public.price_book_audit (entry_id, occurred_at desc);

create index if not exists price_book_audit_occurred_idx
  on public.price_book_audit (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Row readers and audit writer
-- ---------------------------------------------------------------------------

create or replace function public.price_book_company_default_margin()
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_margin numeric;
begin
  select default_material_gross_margin_percent
    into v_margin
  from public.price_book_settings
  where id = 1;

  if not found then
    raise exception 'PRICEBOOK:SETTINGS_MISSING:Company gross margin is not available.'
      using errcode = 'P0001';
  end if;

  return v_margin;
end;
$$;

create or replace function public.price_book_entry_unit_selling_price(p_entry_id uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
  v_margin numeric;
  v_default numeric;
begin
  select *
    into v_entry
  from public.price_book_entries
  where id = p_entry_id;

  if not found then
    raise exception 'PRICEBOOK:ENTRY_NOT_FOUND:Price book entry was not found.'
      using errcode = 'P0001';
  end if;

  if v_entry.entry_type <> 'material' then
    raise exception 'PRICEBOOK:ENTRY_TYPE:Demolition and installation use the manual selling rate.'
      using errcode = 'P0001';
  end if;

  v_default := public.price_book_company_default_margin();
  v_margin := public.price_book_effective_material_margin(
    v_entry.gross_margin_percent_override,
    v_default
  );

  return public.price_book_material_unit_selling_price(
    v_entry.purchase_cost,
    v_margin,
    v_entry.pricing_unit,
    v_entry.price_basis,
    v_entry.coverage_quantity,
    v_entry.coverage_unit,
    v_entry.price_conversion_confirmed
  );
end;
$$;

create or replace function public.price_book_assert_writer()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_manager_or_admin() then
    perform public.price_book_raise(
      'FORBIDDEN',
      'Only managers and admins can change the price book.'
    );
  end if;
end;
$$;

create or replace function public.price_book_audit_insert(
  p_action text,
  p_table_name text,
  p_entry_id uuid,
  p_supplier_id uuid,
  p_inventory_item_id uuid,
  p_identifier_id uuid,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() < 1 then
    perform public.price_book_raise(
      'AUDIT_DIRECT',
      'Price book history is written only by database triggers.'
    );
  end if;

  perform set_config('price_book.audit_write', 'on', true);

  insert into public.price_book_audit (
    actor_id,
    action,
    table_name,
    entry_id,
    supplier_id,
    inventory_item_id,
    identifier_id,
    before_data,
    after_data
  ) values (
    auth.uid(),
    p_action,
    p_table_name,
    p_entry_id,
    p_supplier_id,
    p_inventory_item_id,
    p_identifier_id,
    p_before,
    p_after
  );

  perform set_config('price_book.audit_write', 'off', true);
end;
$$;

create or replace function public.price_book_entry_audit_json(
  p_row public.price_book_entries
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_json jsonb;
  v_default numeric;
  v_margin numeric;
begin
  v_json := to_jsonb(p_row) - 'updated_at' - 'updated_by';

  if p_row.entry_type = 'material' then
    v_default := public.price_book_company_default_margin();
    v_margin := public.price_book_effective_material_margin(
      p_row.gross_margin_percent_override,
      v_default
    );
    v_json := v_json || jsonb_build_object(
      'company_default_gross_margin_percent', v_default,
      'effective_gross_margin_percent', v_margin,
      'unit_selling_price', public.price_book_material_unit_selling_price(
        p_row.purchase_cost,
        v_margin,
        p_row.pricing_unit,
        p_row.price_basis,
        p_row.coverage_quantity,
        p_row.coverage_unit,
        p_row.price_conversion_confirmed
      )
    );
  end if;

  return v_json;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.price_book_settings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    perform public.price_book_assert_writer();
    if new.id is distinct from old.id then
      perform public.price_book_raise(
        'SETTINGS_ROW',
        'The company price book settings row cannot be replaced.'
      );
    end if;
  end if;

  if new.id is distinct from 1 then
    perform public.price_book_raise(
      'SETTINGS_ROW',
      'Company price book settings use a single row.'
    );
  end if;

  if new.default_material_gross_margin_percent <> round(new.default_material_gross_margin_percent, 2)
     or new.default_material_gross_margin_percent < 0
     or new.default_material_gross_margin_percent >= 100 then
    perform public.price_book_raise(
      'MARGIN_RANGE',
      'Company gross margin must be at least 0 and less than 100.'
    );
  end if;

  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

create or replace function public.price_book_settings_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  v_before := case
    when tg_op = 'INSERT' then null
    else to_jsonb(old) - 'updated_at' - 'updated_by'
  end;
  v_after := to_jsonb(new) - 'updated_at' - 'updated_by';

  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  v_action := case when tg_op = 'INSERT' then 'create' else 'update' end;

  perform public.price_book_audit_insert(
    v_action,
    'price_book_settings',
    null,
    null,
    null,
    null,
    v_before,
    v_after
  );
  return null;
end;
$$;

create or replace function public.price_book_settings_block_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.price_book_raise(
    'DELETE_FORBIDDEN',
    'Company price book settings cannot be deleted.'
  );
  return null;
end;
$$;

create or replace function public.price_book_suppliers_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.price_book_assert_writer();

  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;

  new.name := btrim(new.name);
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.status := lower(btrim(coalesce(new.status, 'active')));

  if new.name is null or char_length(new.name) = 0 then
    perform public.price_book_raise('NAME_REQUIRED', 'Enter a supplier name.');
  end if;
  if char_length(new.name) > 200 then
    perform public.price_book_raise(
      'NAME_LENGTH',
      'Supplier name must be 200 characters or less.'
    );
  end if;
  if new.notes is not null and char_length(new.notes) > 4000 then
    perform public.price_book_raise(
      'NOTES_LENGTH',
      'Supplier notes must be 4000 characters or less.'
    );
  end if;
  if exists (
    select 1
    from public.price_book_suppliers s
    where lower(btrim(s.name)) = lower(new.name)
      and s.id is distinct from new.id
  ) then
    perform public.price_book_raise(
      'DUPLICATE_SUPPLIER',
      'A supplier with that name already exists.'
    );
  end if;
  if new.status not in ('active', 'archived') then
    perform public.price_book_raise('STATUS', 'Status must be active or archived.');
  end if;

  if new.status = 'archived' then
    if tg_op = 'INSERT' or old.status is distinct from 'archived' then
      new.archived_at := now();
    else
      new.archived_at := old.archived_at;
    end if;
  else
    new.archived_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.price_book_suppliers_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  v_before := case
    when tg_op = 'INSERT' then null
    else to_jsonb(old) - 'updated_at' - 'updated_by'
  end;
  v_after := to_jsonb(new) - 'updated_at' - 'updated_by';

  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'create';
  elsif old.status = 'active' and new.status = 'archived' then
    v_action := 'archive';
  elsif old.status = 'archived' and new.status = 'active' then
    v_action := 'restore';
  else
    v_action := 'update';
  end if;

  perform public.price_book_audit_insert(
    v_action,
    'price_book_suppliers',
    null,
    new.id,
    null,
    null,
    v_before,
    v_after
  );
  return null;
end;
$$;

create or replace function public.price_book_suppliers_block_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.price_book_raise(
    'DELETE_FORBIDDEN',
    'Suppliers cannot be deleted. Archive the supplier instead.'
  );
  return null;
end;
$$;

create or replace function public.price_book_entries_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_supplier_status text;
begin
  perform public.price_book_assert_writer();

  if tg_op = 'UPDATE' and new.entry_type is distinct from old.entry_type then
    perform public.price_book_raise(
      'ENTRY_TYPE_IMMUTABLE',
      'Entry type cannot be changed. Archive this entry and create a new one.'
    );
  end if;

  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;

  new.name := btrim(new.name);
  new.category := nullif(btrim(coalesce(new.category, '')), '');
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.entry_type := nullif(lower(btrim(coalesce(new.entry_type, ''))), '');
  new.pricing_unit := nullif(lower(btrim(coalesce(new.pricing_unit, ''))), '');
  new.status := lower(btrim(coalesce(new.status, 'active')));
  if new.price_basis is not null then
    new.price_basis := nullif(lower(btrim(new.price_basis)), '');
  end if;
  if new.coverage_unit is not null then
    new.coverage_unit := nullif(lower(btrim(new.coverage_unit)), '');
  end if;
  if new.price_conversion_confirmed is null then
    new.price_conversion_confirmed := false;
  end if;

  if new.name is null or char_length(new.name) = 0 then
    perform public.price_book_raise('NAME_REQUIRED', 'Enter a name.');
  end if;
  if char_length(new.name) > 200 then
    perform public.price_book_raise('NAME_LENGTH', 'Name must be 200 characters or less.');
  end if;
  if new.category is not null and char_length(new.category) > 80 then
    perform public.price_book_raise(
      'CATEGORY_LENGTH',
      'Category must be 80 characters or less.'
    );
  end if;
  if new.description is not null and char_length(new.description) > 4000 then
    perform public.price_book_raise(
      'DESCRIPTION_LENGTH',
      'Description must be 4000 characters or less.'
    );
  end if;
  if new.status not in ('active', 'archived') then
    perform public.price_book_raise('STATUS', 'Status must be active or archived.');
  end if;

  if new.status = 'archived' then
    if tg_op = 'INSERT' or old.status is distinct from 'archived' then
      new.archived_at := now();
    else
      new.archived_at := old.archived_at;
    end if;
  else
    new.archived_at := null;
  end if;

  if new.supplier_id is not null
     and (tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id) then
    select status
      into v_supplier_status
    from public.price_book_suppliers
    where id = new.supplier_id;

    if not found then
      perform public.price_book_raise('SUPPLIER_NOT_FOUND', 'Supplier was not found.');
    end if;
    if v_supplier_status <> 'active' then
      perform public.price_book_raise(
        'SUPPLIER_ARCHIVED',
        'Restore the supplier before assigning it.'
      );
    end if;
  end if;

  if tg_op = 'UPDATE' and new.supplier_id is distinct from old.supplier_id then
    -- Entry row is already locked by this update. Lock identifiers next, in
    -- id order, so this transaction and an identifier write cannot commit two
    -- different suppliers for the same material.
    perform 1
    from public.price_book_supplier_identifiers
    where entry_id = new.id
    order by id
    for update;

    if exists (
      select 1
      from public.price_book_supplier_identifiers i
      where i.entry_id = new.id
    ) then
      perform public.price_book_raise(
        'IDENTIFIER_PRESENT',
        'Remove this material''s supplier identifiers in the same change before switching or clearing the supplier.'
      );
    end if;
  end if;

  if new.entry_type = 'material' then
    if new.cost_source is null or btrim(new.cost_source) = '' then
      new.cost_source := 'manual';
    else
      new.cost_source := lower(btrim(new.cost_source));
    end if;

    if new.cost_effective_on is null then
      if tg_op = 'UPDATE' then
        new.cost_effective_on := old.cost_effective_on;
      end if;
      if new.cost_effective_on is null then
        new.cost_effective_on := current_date;
      end if;
    end if;
  end if;

  v_code := public.price_book_entry_shape_code(
    new.entry_type,
    new.pricing_unit,
    new.price_basis,
    new.price_conversion_confirmed,
    new.coverage_quantity,
    new.coverage_unit,
    new.purchase_cost,
    new.gross_margin_percent_override,
    new.labor_selling_rate,
    new.supplier_id,
    new.cost_source,
    new.cost_effective_on
  );
  if v_code is not null then
    perform public.price_book_raise(v_code, public.price_book_shape_message(v_code));
  end if;

  return new;
end;
$$;

create or replace function public.price_book_entries_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  v_before := case
    when tg_op = 'INSERT' then null
    else public.price_book_entry_audit_json(old)
  end;
  v_after := public.price_book_entry_audit_json(new);

  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'create';
  elsif old.status = 'active' and new.status = 'archived' then
    v_action := 'archive';
  elsif old.status = 'archived' and new.status = 'active' then
    v_action := 'restore';
  else
    v_action := 'update';
  end if;

  perform public.price_book_audit_insert(
    v_action,
    'price_book_entries',
    new.id,
    new.supplier_id,
    null,
    null,
    v_before,
    v_after
  );
  return null;
end;
$$;

create or replace function public.price_book_entries_block_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.price_book_raise(
    'DELETE_FORBIDDEN',
    'Price book entries cannot be deleted. Archive the entry instead.'
  );
  return null;
end;
$$;

create or replace function public.price_book_assert_identifier_coverage(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
  v_count integer;
begin
  select *
    into v_entry
  from public.price_book_entries
  where id = p_entry_id;

  if not found then
    return;
  end if;

  select count(*)
    into v_count
  from public.price_book_supplier_identifiers
  where entry_id = p_entry_id;

  if v_entry.entry_type = 'material' and v_entry.supplier_id is not null then
    if v_count < 1 then
      perform public.price_book_raise(
        'IDENTIFIER_REQUIRED',
        'Assign a supplier SKU or an internal supplier-specific identifier before saving a material for that supplier.'
      );
    end if;
    return;
  end if;

  if v_count > 0 then
    perform public.price_book_raise(
      'IDENTIFIER_NOT_ALLOWED',
      'Supplier identifiers belong only on a material that has a supplier.'
    );
  end if;
end;
$$;

create or replace function public.price_book_entries_require_identifier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.price_book_assert_identifier_coverage(new.id);
  return null;
end;
$$;

-- Lock the material before an identifier write reads its supplier. Callers
-- that also lock identifier rows must lock this material first, then
-- identifier ids in ascending order.
create or replace function public.price_book_lock_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.price_book_entries
  where id = p_entry_id
  for update;
end;
$$;

create or replace function public.price_book_identifiers_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
  v_supplier_status text;
begin
  perform public.price_book_assert_writer();
  perform public.price_book_lock_entry(new.entry_id);

  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.entry_id := old.entry_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  new.kind := nullif(lower(btrim(coalesce(new.kind, ''))), '');
  new.code := btrim(new.code);

  if new.kind is null or new.kind not in ('supplier_sku', 'internal') then
    perform public.price_book_raise(
      'IDENTIFIER_KIND',
      'Identifier kind must be a supplier SKU or an internal identifier.'
    );
  end if;
  if new.code is null or char_length(new.code) = 0 then
    perform public.price_book_raise(
      'CODE_REQUIRED',
      'Enter a supplier SKU or an internal identifier.'
    );
  end if;
  if char_length(new.code) > 80 then
    perform public.price_book_raise(
      'CODE_LENGTH',
      'Identifier must be 80 characters or less.'
    );
  end if;

  select *
    into v_entry
  from public.price_book_entries
  where id = new.entry_id;

  if not found then
    perform public.price_book_raise('ENTRY_NOT_FOUND', 'Price book entry was not found.');
  end if;
  if v_entry.entry_type <> 'material' or v_entry.supplier_id is null then
    perform public.price_book_raise(
      'IDENTIFIER_NOT_ALLOWED',
      'Assign the supplier on the material before adding a supplier SKU or internal identifier.'
    );
  end if;
  if v_entry.supplier_id is distinct from new.supplier_id then
    perform public.price_book_raise(
      'IDENTIFIER_MISMATCH',
      'The identifier supplier must match the material supplier.'
    );
  end if;

  select status
    into v_supplier_status
  from public.price_book_suppliers
  where id = new.supplier_id;

  if not found then
    perform public.price_book_raise('SUPPLIER_NOT_FOUND', 'Supplier was not found.');
  end if;
  if tg_op = 'INSERT' and v_supplier_status <> 'active' then
    perform public.price_book_raise(
      'SUPPLIER_ARCHIVED',
      'Restore the supplier before assigning a new identifier.'
    );
  end if;

  if exists (
    select 1
    from public.price_book_supplier_identifiers i
    where i.supplier_id = new.supplier_id
      and i.code_norm = upper(btrim(new.code))
      and i.id is distinct from new.id
  ) then
    perform public.price_book_raise(
      'DUPLICATE_CODE',
      'That supplier already has a material with this SKU or internal identifier.'
    );
  end if;

  return new;
end;
$$;

create or replace function public.price_book_identifiers_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.price_book_lock_entry(old.entry_id);
  return old;
end;
$$;

create or replace function public.price_book_identifiers_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.price_book_supplier_identifiers%rowtype;
  v_action text;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_action := 'identifier_delete';
    v_before := to_jsonb(old);
    v_after := null;
  else
    v_row := new;
    v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    v_after := to_jsonb(new);
    if tg_op = 'UPDATE' and v_before = v_after then
      return null;
    end if;
    v_action := case
      when tg_op = 'INSERT' then 'identifier_create'
      else 'identifier_update'
    end;
  end if;

  perform public.price_book_audit_insert(
    v_action,
    'price_book_supplier_identifiers',
    v_row.entry_id,
    v_row.supplier_id,
    null,
    v_row.id,
    v_before,
    v_after
  );
  return null;
end;
$$;

create or replace function public.price_book_identifiers_require_coverage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.price_book_assert_identifier_coverage(coalesce(new.entry_id, old.entry_id));
  return null;
end;
$$;

create or replace function public.price_book_links_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
begin
  perform public.price_book_assert_writer();

  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  select *
    into v_entry
  from public.price_book_entries
  where id = new.entry_id;

  if not found then
    perform public.price_book_raise('ENTRY_NOT_FOUND', 'Price book entry was not found.');
  end if;
  if v_entry.entry_type <> 'material' then
    perform public.price_book_raise(
      'INVENTORY_LINK_MATERIAL',
      'Inventory records can be linked only to a material.'
    );
  end if;
  if v_entry.status <> 'active' then
    perform public.price_book_raise(
      'INVENTORY_LINK_ACTIVE',
      'Restore the material before linking inventory records.'
    );
  end if;
  if exists (
    select 1
    from public.price_book_entry_inventory_items link
    where link.inventory_item_id = new.inventory_item_id
  ) then
    perform public.price_book_raise(
      'INVENTORY_LINK_DUPLICATE',
      'That inventory record is already linked to a material.'
    );
  end if;

  return new;
end;
$$;

create or replace function public.price_book_links_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    perform public.price_book_audit_insert(
      'unlink_inventory',
      'price_book_entry_inventory_items',
      v_row.entry_id,
      null,
      v_row.inventory_item_id,
      null,
      to_jsonb(old),
      null
    );
    return null;
  end if;

  perform public.price_book_audit_insert(
    'link_inventory',
    'price_book_entry_inventory_items',
    new.entry_id,
    null,
    new.inventory_item_id,
    null,
    null,
    to_jsonb(new)
  );
  return null;
end;
$$;

-- Removes link rows when an inventory record is deleted.
-- Does not read or assign quantity_on_hand or unit_cost.
create or replace function public.price_book_before_inventory_item_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.price_book_entry_inventory_items
  where inventory_item_id = old.id;
  return old;
end;
$$;

create or replace function public.price_book_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('price_book.audit_write', true) is distinct from 'on' then
      perform public.price_book_raise(
        'AUDIT_DIRECT',
        'Price book history is written only by database triggers.'
      );
    end if;
    return new;
  end if;

  perform public.price_book_raise(
    'AUDIT_IMMUTABLE',
    'Price book history cannot be changed or deleted.'
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic supplier-material save
-- When the supplier is unchanged, a null or blank SKU or internal code leaves
-- that identifier in place. Passing a code updates that kind, or inserts it
-- when the material does not have one yet.
-- A supplier change requires an explicit code for the new supplier. Omitted
-- codes are not copied from the previous supplier. The old identifier rows are
-- deleted and only the provided codes are inserted, in the same transaction.
-- A supplier change with no new code raises before any write.
-- Create requires a supplier and at least one code.
-- cost_source is manual on create. A purchase-cost change records manual.
-- An unchanged purchase cost keeps pdf_import when a later import set it.
-- A null effective date on update keeps the stored date.
-- ---------------------------------------------------------------------------

create or replace function public.price_book_lock_material(p_entry_id uuid)
returns public.price_book_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
begin
  select *
    into v_entry
  from public.price_book_entries
  where id = p_entry_id
  for update;

  if not found then
    perform public.price_book_raise('ENTRY_NOT_FOUND', 'Price book entry was not found.');
  end if;

  perform 1
  from public.price_book_supplier_identifiers
  where entry_id = p_entry_id
  order by id
  for update;

  return v_entry;
end;
$$;

create or replace function public.price_book_save_supplier_material(
  p_entry_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_supplier_id uuid,
  p_pricing_unit text,
  p_price_basis text,
  p_price_conversion_confirmed boolean,
  p_coverage_quantity numeric,
  p_coverage_unit text,
  p_purchase_cost numeric,
  p_gross_margin_percent_override numeric,
  p_set_margin_override boolean,
  p_cost_effective_on date,
  p_supplier_sku text,
  p_internal_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_entry public.price_book_entries%rowtype;
  v_sku text;
  v_internal text;
  v_sku_provided boolean;
  v_internal_provided boolean;
  v_existing_sku text;
  v_existing_internal text;
  v_supplier_changed boolean;
  v_margin numeric;
  v_effective_on date;
  v_cost_source text;
begin
  if auth.uid() is null or not public.is_manager_or_admin() then
    perform public.price_book_raise(
      'FORBIDDEN',
      'Only managers and admins can change the price book.'
    );
  end if;

  if p_supplier_id is null then
    perform public.price_book_raise(
      'SUPPLIER_REQUIRED',
      'Choose a supplier before saving this material.'
    );
  end if;

  v_sku_provided := nullif(btrim(coalesce(p_supplier_sku, '')), '') is not null;
  v_internal_provided := nullif(btrim(coalesce(p_internal_code, '')), '') is not null;
  v_sku := case when v_sku_provided then btrim(p_supplier_sku) else null end;
  v_internal := case when v_internal_provided then btrim(p_internal_code) else null end;

  if p_entry_id is null then
    if not v_sku_provided and not v_internal_provided then
      perform public.price_book_raise(
        'IDENTIFIER_REQUIRED',
        'Assign a supplier SKU or an internal supplier-specific identifier before saving a material for that supplier.'
      );
    end if;

    v_margin := case
      when coalesce(p_set_margin_override, false) then p_gross_margin_percent_override
      else null
    end;

    insert into public.price_book_entries (
      entry_type,
      name,
      category,
      description,
      pricing_unit,
      price_basis,
      price_conversion_confirmed,
      coverage_quantity,
      coverage_unit,
      supplier_id,
      purchase_cost,
      gross_margin_percent_override,
      cost_source,
      cost_effective_on
    ) values (
      'material',
      p_name,
      p_category,
      p_description,
      p_pricing_unit,
      p_price_basis,
      coalesce(p_price_conversion_confirmed, false),
      p_coverage_quantity,
      p_coverage_unit,
      p_supplier_id,
      p_purchase_cost,
      v_margin,
      'manual',
      coalesce(p_cost_effective_on, current_date)
    )
    returning id into v_id;

    if v_sku_provided then
      insert into public.price_book_supplier_identifiers (
        entry_id, supplier_id, kind, code
      ) values (
        v_id, p_supplier_id, 'supplier_sku', v_sku
      );
    end if;
    if v_internal_provided then
      insert into public.price_book_supplier_identifiers (
        entry_id, supplier_id, kind, code
      ) values (
        v_id, p_supplier_id, 'internal', v_internal
      );
    end if;

    return v_id;
  end if;

  v_entry := public.price_book_lock_material(p_entry_id);

  if v_entry.entry_type <> 'material' then
    perform public.price_book_raise(
      'ENTRY_TYPE',
      'This save is only for a supplier-backed material.'
    );
  end if;

  select code
    into v_existing_sku
  from public.price_book_supplier_identifiers
  where entry_id = p_entry_id
    and kind = 'supplier_sku';

  select code
    into v_existing_internal
  from public.price_book_supplier_identifiers
  where entry_id = p_entry_id
    and kind = 'internal';

  v_supplier_changed := v_entry.supplier_id is distinct from p_supplier_id;

  if v_supplier_changed then
    if not v_sku_provided and not v_internal_provided then
      perform public.price_book_raise(
        'IDENTIFIER_REQUIRED',
        'Enter a supplier SKU or an internal identifier for the new supplier. Codes from the previous supplier are not carried over.'
      );
    end if;
  else
    if not v_sku_provided then
      v_sku := v_existing_sku;
    end if;
    if not v_internal_provided then
      v_internal := v_existing_internal;
    end if;

    if v_sku is null and v_internal is null then
      perform public.price_book_raise(
        'IDENTIFIER_REQUIRED',
        'Assign a supplier SKU or an internal supplier-specific identifier before saving a material for that supplier.'
      );
    end if;
  end if;
  v_margin := case
    when coalesce(p_set_margin_override, false) then p_gross_margin_percent_override
    else v_entry.gross_margin_percent_override
  end;
  v_effective_on := coalesce(p_cost_effective_on, v_entry.cost_effective_on, current_date);
  v_cost_source := case
    when v_entry.purchase_cost is distinct from p_purchase_cost then 'manual'
    else coalesce(v_entry.cost_source, 'manual')
  end;

  if v_supplier_changed then
    delete from public.price_book_supplier_identifiers
    where entry_id = p_entry_id;
  end if;

  update public.price_book_entries
  set
    name = p_name,
    category = p_category,
    description = p_description,
    pricing_unit = p_pricing_unit,
    price_basis = p_price_basis,
    price_conversion_confirmed = coalesce(p_price_conversion_confirmed, false),
    coverage_quantity = p_coverage_quantity,
    coverage_unit = p_coverage_unit,
    supplier_id = p_supplier_id,
    purchase_cost = p_purchase_cost,
    gross_margin_percent_override = v_margin,
    cost_source = v_cost_source,
    cost_effective_on = v_effective_on
  where id = p_entry_id;

  if v_supplier_changed then
    if v_sku is not null then
      insert into public.price_book_supplier_identifiers (
        entry_id, supplier_id, kind, code
      ) values (
        p_entry_id, p_supplier_id, 'supplier_sku', v_sku
      );
    end if;
    if v_internal is not null then
      insert into public.price_book_supplier_identifiers (
        entry_id, supplier_id, kind, code
      ) values (
        p_entry_id, p_supplier_id, 'internal', v_internal
      );
    end if;
    return p_entry_id;
  end if;

  if v_sku_provided then
    update public.price_book_supplier_identifiers
    set code = v_sku
    where entry_id = p_entry_id
      and kind = 'supplier_sku';
    if not found then
      insert into public.price_book_supplier_identifiers (
        entry_id, supplier_id, kind, code
      ) values (
        p_entry_id, p_supplier_id, 'supplier_sku', v_sku
      );
    end if;
  end if;

  if v_internal_provided then
    update public.price_book_supplier_identifiers
    set code = v_internal
    where entry_id = p_entry_id
      and kind = 'internal';
    if not found then
      insert into public.price_book_supplier_identifiers (
        entry_id, supplier_id, kind, code
      ) values (
        p_entry_id, p_supplier_id, 'internal', v_internal
      );
    end if;
  end if;

  return p_entry_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identifier edit and removal. Lock the material, then its identifiers.
-- Authenticated clients use these functions instead of writing the table.
-- ---------------------------------------------------------------------------

create or replace function public.price_book_save_supplier_identifier(
  p_entry_id uuid,
  p_kind text,
  p_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
  v_kind text;
  v_code text;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_manager_or_admin() then
    perform public.price_book_raise(
      'FORBIDDEN',
      'Only managers and admins can change the price book.'
    );
  end if;

  v_kind := nullif(lower(btrim(coalesce(p_kind, ''))), '');
  v_code := nullif(btrim(coalesce(p_code, '')), '');

  if v_kind is null or v_kind not in ('supplier_sku', 'internal') then
    perform public.price_book_raise(
      'IDENTIFIER_KIND',
      'Identifier kind must be a supplier SKU or an internal identifier.'
    );
  end if;
  if v_code is null then
    perform public.price_book_raise(
      'CODE_REQUIRED',
      'Enter a supplier SKU or an internal identifier.'
    );
  end if;

  v_entry := public.price_book_lock_material(p_entry_id);

  if v_entry.entry_type <> 'material' or v_entry.supplier_id is null then
    perform public.price_book_raise(
      'IDENTIFIER_NOT_ALLOWED',
      'Assign the supplier on the material before adding a supplier SKU or internal identifier.'
    );
  end if;

  update public.price_book_supplier_identifiers
  set
    code = v_code,
    supplier_id = v_entry.supplier_id
  where entry_id = p_entry_id
    and kind = v_kind
  returning id into v_id;

  if found then
    return v_id;
  end if;

  insert into public.price_book_supplier_identifiers (
    entry_id, supplier_id, kind, code
  ) values (
    p_entry_id, v_entry.supplier_id, v_kind, v_code
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.price_book_remove_supplier_identifier(
  p_entry_id uuid,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
  v_kind text;
  v_id uuid;
  v_count integer;
begin
  if auth.uid() is null or not public.is_manager_or_admin() then
    perform public.price_book_raise(
      'FORBIDDEN',
      'Only managers and admins can change the price book.'
    );
  end if;

  v_kind := nullif(lower(btrim(coalesce(p_kind, ''))), '');
  if v_kind is null or v_kind not in ('supplier_sku', 'internal') then
    perform public.price_book_raise(
      'IDENTIFIER_KIND',
      'Identifier kind must be a supplier SKU or an internal identifier.'
    );
  end if;

  v_entry := public.price_book_lock_material(p_entry_id);

  if v_entry.entry_type <> 'material' or v_entry.supplier_id is null then
    perform public.price_book_raise(
      'IDENTIFIER_NOT_ALLOWED',
      'Supplier identifiers belong only on a material that has a supplier.'
    );
  end if;

  select id
    into v_id
  from public.price_book_supplier_identifiers
  where entry_id = p_entry_id
    and kind = v_kind;

  if not found then
    perform public.price_book_raise(
      'IDENTIFIER_NOT_FOUND',
      'That identifier is not on this material.'
    );
  end if;

  select count(*)
    into v_count
  from public.price_book_supplier_identifiers
  where entry_id = p_entry_id;

  if v_count < 2 then
    perform public.price_book_raise(
      'IDENTIFIER_REQUIRED',
      'A supplier-backed material must keep a supplier SKU or an internal identifier.'
    );
  end if;

  delete from public.price_book_supplier_identifiers
  where id = v_id;
end;
$$;

drop trigger if exists price_book_settings_set_updated_at on public.price_book_settings;
create trigger price_book_settings_set_updated_at
  before update on public.price_book_settings
  for each row execute function public.set_updated_at();

drop trigger if exists price_book_settings_before_write on public.price_book_settings;
create trigger price_book_settings_before_write
  before insert or update on public.price_book_settings
  for each row execute function public.price_book_settings_before_write();

drop trigger if exists price_book_settings_after_write on public.price_book_settings;
create trigger price_book_settings_after_write
  after insert or update on public.price_book_settings
  for each row execute function public.price_book_settings_after_write();

drop trigger if exists price_book_settings_block_delete on public.price_book_settings;
create trigger price_book_settings_block_delete
  before delete on public.price_book_settings
  for each row execute function public.price_book_settings_block_delete();

drop trigger if exists price_book_suppliers_set_updated_at on public.price_book_suppliers;
create trigger price_book_suppliers_set_updated_at
  before update on public.price_book_suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists price_book_suppliers_before_write on public.price_book_suppliers;
create trigger price_book_suppliers_before_write
  before insert or update on public.price_book_suppliers
  for each row execute function public.price_book_suppliers_before_write();

drop trigger if exists price_book_suppliers_after_write on public.price_book_suppliers;
create trigger price_book_suppliers_after_write
  after insert or update on public.price_book_suppliers
  for each row execute function public.price_book_suppliers_after_write();

drop trigger if exists price_book_suppliers_block_delete on public.price_book_suppliers;
create trigger price_book_suppliers_block_delete
  before delete on public.price_book_suppliers
  for each row execute function public.price_book_suppliers_block_delete();

drop trigger if exists price_book_entries_set_updated_at on public.price_book_entries;
create trigger price_book_entries_set_updated_at
  before update on public.price_book_entries
  for each row execute function public.set_updated_at();

drop trigger if exists price_book_entries_before_write on public.price_book_entries;
create trigger price_book_entries_before_write
  before insert or update on public.price_book_entries
  for each row execute function public.price_book_entries_before_write();

drop trigger if exists price_book_entries_after_write on public.price_book_entries;
create trigger price_book_entries_after_write
  after insert or update on public.price_book_entries
  for each row execute function public.price_book_entries_after_write();

drop trigger if exists price_book_entries_block_delete on public.price_book_entries;
create trigger price_book_entries_block_delete
  before delete on public.price_book_entries
  for each row execute function public.price_book_entries_block_delete();

drop trigger if exists price_book_entries_require_identifier on public.price_book_entries;
create constraint trigger price_book_entries_require_identifier
  after insert or update on public.price_book_entries
  deferrable initially deferred
  for each row execute function public.price_book_entries_require_identifier();

drop trigger if exists price_book_identifiers_before_write on public.price_book_supplier_identifiers;
create trigger price_book_identifiers_before_write
  before insert or update on public.price_book_supplier_identifiers
  for each row execute function public.price_book_identifiers_before_write();

drop trigger if exists price_book_identifiers_before_delete on public.price_book_supplier_identifiers;
create trigger price_book_identifiers_before_delete
  before delete on public.price_book_supplier_identifiers
  for each row execute function public.price_book_identifiers_before_delete();

drop trigger if exists price_book_identifiers_after_write on public.price_book_supplier_identifiers;
create trigger price_book_identifiers_after_write
  after insert or update or delete on public.price_book_supplier_identifiers
  for each row execute function public.price_book_identifiers_after_write();

drop trigger if exists price_book_identifiers_require_coverage on public.price_book_supplier_identifiers;
create constraint trigger price_book_identifiers_require_coverage
  after insert or update or delete on public.price_book_supplier_identifiers
  deferrable initially deferred
  for each row execute function public.price_book_identifiers_require_coverage();

drop trigger if exists price_book_links_before_write on public.price_book_entry_inventory_items;
create trigger price_book_links_before_write
  before insert on public.price_book_entry_inventory_items
  for each row execute function public.price_book_links_before_write();

drop trigger if exists price_book_links_after_write on public.price_book_entry_inventory_items;
create trigger price_book_links_after_write
  after insert or delete on public.price_book_entry_inventory_items
  for each row execute function public.price_book_links_after_write();

drop trigger if exists inventory_items_price_book_unlink_before_delete on public.inventory_items;
create trigger inventory_items_price_book_unlink_before_delete
  before delete on public.inventory_items
  for each row execute function public.price_book_before_inventory_item_delete();

drop trigger if exists price_book_audit_guard on public.price_book_audit;
create trigger price_book_audit_guard
  before insert or update or delete on public.price_book_audit
  for each row execute function public.price_book_audit_guard();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.price_book_settings enable row level security;
alter table public.price_book_suppliers enable row level security;
alter table public.price_book_entries enable row level security;
alter table public.price_book_supplier_identifiers enable row level security;
alter table public.price_book_entry_inventory_items enable row level security;
alter table public.price_book_audit enable row level security;

drop policy if exists "price_book_settings_select_app" on public.price_book_settings;
create policy "price_book_settings_select_app"
  on public.price_book_settings
  for select
  to authenticated
  using (public.has_app_access());

drop policy if exists "price_book_settings_update_mgr" on public.price_book_settings;
create policy "price_book_settings_update_mgr"
  on public.price_book_settings
  for update
  to authenticated
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

drop policy if exists "price_book_suppliers_select_app" on public.price_book_suppliers;
create policy "price_book_suppliers_select_app"
  on public.price_book_suppliers
  for select
  to authenticated
  using (public.has_app_access());

drop policy if exists "price_book_suppliers_insert_mgr" on public.price_book_suppliers;
create policy "price_book_suppliers_insert_mgr"
  on public.price_book_suppliers
  for insert
  to authenticated
  with check (
    public.is_manager_or_admin()
    and created_by = auth.uid()
  );

drop policy if exists "price_book_suppliers_update_mgr" on public.price_book_suppliers;
create policy "price_book_suppliers_update_mgr"
  on public.price_book_suppliers
  for update
  to authenticated
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

drop policy if exists "price_book_entries_select_app" on public.price_book_entries;
create policy "price_book_entries_select_app"
  on public.price_book_entries
  for select
  to authenticated
  using (public.has_app_access());

drop policy if exists "price_book_entries_insert_mgr" on public.price_book_entries;
create policy "price_book_entries_insert_mgr"
  on public.price_book_entries
  for insert
  to authenticated
  with check (
    public.is_manager_or_admin()
    and created_by = auth.uid()
  );

drop policy if exists "price_book_entries_update_mgr" on public.price_book_entries;
create policy "price_book_entries_update_mgr"
  on public.price_book_entries
  for update
  to authenticated
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

drop policy if exists "price_book_identifiers_select_app" on public.price_book_supplier_identifiers;
create policy "price_book_identifiers_select_app"
  on public.price_book_supplier_identifiers
  for select
  to authenticated
  using (public.has_app_access());

-- Identifier inserts, updates, and deletes go through the security-definer
-- functions above. No authenticated write policy is created.
drop policy if exists "price_book_identifiers_insert_mgr" on public.price_book_supplier_identifiers;
drop policy if exists "price_book_identifiers_update_mgr" on public.price_book_supplier_identifiers;
drop policy if exists "price_book_identifiers_delete_mgr" on public.price_book_supplier_identifiers;

drop policy if exists "price_book_links_select_app" on public.price_book_entry_inventory_items;
create policy "price_book_links_select_app"
  on public.price_book_entry_inventory_items
  for select
  to authenticated
  using (public.has_app_access());

drop policy if exists "price_book_links_insert_mgr" on public.price_book_entry_inventory_items;
create policy "price_book_links_insert_mgr"
  on public.price_book_entry_inventory_items
  for insert
  to authenticated
  with check (
    public.is_manager_or_admin()
    and created_by = auth.uid()
  );

drop policy if exists "price_book_links_delete_mgr" on public.price_book_entry_inventory_items;
create policy "price_book_links_delete_mgr"
  on public.price_book_entry_inventory_items
  for delete
  to authenticated
  using (public.is_manager_or_admin());

drop policy if exists "price_book_audit_select_app" on public.price_book_audit;
create policy "price_book_audit_select_app"
  on public.price_book_audit
  for select
  to authenticated
  using (public.has_app_access());

-- ---------------------------------------------------------------------------
-- Grants
-- Client roles lose default privileges first, then approved reads and
-- manager writes are granted back. Calculation, read, material save, and
-- identifier edit/removal functions are callable. Identifier table writes are
-- not granted to authenticated. Trigger functions stay revoked from public,
-- anon, and authenticated. Row writes from the save functions still fire them.
-- ---------------------------------------------------------------------------

revoke all on table public.price_book_settings from public, anon, authenticated;
revoke all on table public.price_book_suppliers from public, anon, authenticated;
revoke all on table public.price_book_entries from public, anon, authenticated;
revoke all on table public.price_book_supplier_identifiers from public, anon, authenticated;
revoke all on table public.price_book_entry_inventory_items from public, anon, authenticated;
revoke all on table public.price_book_audit from public, anon, authenticated;

grant select, update on table public.price_book_settings to authenticated;
grant select, insert, update on table public.price_book_suppliers to authenticated;
grant select, insert, update on table public.price_book_entries to authenticated;
grant select on table public.price_book_supplier_identifiers to authenticated;
grant select, insert, delete on table public.price_book_entry_inventory_items to authenticated;
grant select on table public.price_book_audit to authenticated;

revoke all on function public.price_book_raise(text, text) from public, anon, authenticated;
revoke all on function public.price_book_shape_message(text) from public, anon, authenticated;
revoke all on function public.price_book_entry_shape_code(text, text, text, boolean, numeric, text, numeric, numeric, numeric, uuid, text, date) from public, anon, authenticated;
revoke all on function public.price_book_effective_material_margin(numeric, numeric) from public, anon, authenticated;
revoke all on function public.price_book_material_unit_selling_price(numeric, numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_line_total(numeric, numeric) from public, anon, authenticated;
revoke all on function public.price_book_material_line_total(numeric, numeric, numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_labor_line_total(text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.price_book_company_default_margin() from public, anon, authenticated;
revoke all on function public.price_book_entry_unit_selling_price(uuid) from public, anon, authenticated;
revoke all on function public.price_book_assert_writer() from public, anon, authenticated;
revoke all on function public.price_book_audit_insert(text, text, uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.price_book_entry_audit_json(public.price_book_entries) from public, anon, authenticated;
revoke all on function public.price_book_settings_before_write() from public, anon, authenticated;
revoke all on function public.price_book_settings_after_write() from public, anon, authenticated;
revoke all on function public.price_book_settings_block_delete() from public, anon, authenticated;
revoke all on function public.price_book_suppliers_before_write() from public, anon, authenticated;
revoke all on function public.price_book_suppliers_after_write() from public, anon, authenticated;
revoke all on function public.price_book_suppliers_block_delete() from public, anon, authenticated;
revoke all on function public.price_book_entries_before_write() from public, anon, authenticated;
revoke all on function public.price_book_entries_after_write() from public, anon, authenticated;
revoke all on function public.price_book_entries_block_delete() from public, anon, authenticated;
revoke all on function public.price_book_assert_identifier_coverage(uuid) from public, anon, authenticated;
revoke all on function public.price_book_entries_require_identifier() from public, anon, authenticated;
revoke all on function public.price_book_identifiers_before_write() from public, anon, authenticated;
revoke all on function public.price_book_identifiers_after_write() from public, anon, authenticated;
revoke all on function public.price_book_identifiers_require_coverage() from public, anon, authenticated;
revoke all on function public.price_book_links_before_write() from public, anon, authenticated;
revoke all on function public.price_book_links_after_write() from public, anon, authenticated;
revoke all on function public.price_book_before_inventory_item_delete() from public, anon, authenticated;
revoke all on function public.price_book_lock_entry(uuid) from public, anon, authenticated;
revoke all on function public.price_book_lock_material(uuid) from public, anon, authenticated;
revoke all on function public.price_book_identifiers_before_delete() from public, anon, authenticated;
revoke all on function public.price_book_save_supplier_material(uuid, text, text, text, uuid, text, text, boolean, numeric, text, numeric, numeric, boolean, date, text, text) from public, anon, authenticated;
revoke all on function public.price_book_save_supplier_identifier(uuid, text, text) from public, anon, authenticated;
revoke all on function public.price_book_remove_supplier_identifier(uuid, text) from public, anon, authenticated;
revoke all on function public.price_book_audit_guard() from public, anon, authenticated;

grant execute on function public.price_book_shape_message(text) to authenticated;
grant execute on function public.price_book_entry_shape_code(text, text, text, boolean, numeric, text, numeric, numeric, numeric, uuid, text, date) to authenticated;
grant execute on function public.price_book_effective_material_margin(numeric, numeric) to authenticated;
grant execute on function public.price_book_material_unit_selling_price(numeric, numeric, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.price_book_line_total(numeric, numeric) to authenticated;
grant execute on function public.price_book_material_line_total(numeric, numeric, numeric, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.price_book_labor_line_total(text, numeric, numeric) to authenticated;
grant execute on function public.price_book_company_default_margin() to authenticated;
grant execute on function public.price_book_entry_unit_selling_price(uuid) to authenticated;
grant execute on function public.price_book_save_supplier_material(uuid, text, text, text, uuid, text, text, boolean, numeric, text, numeric, numeric, boolean, date, text, text) to authenticated;
grant execute on function public.price_book_save_supplier_identifier(uuid, text, text) to authenticated;
grant execute on function public.price_book_remove_supplier_identifier(uuid, text) to authenticated;

do $$
declare
  fn record;
  tbl text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    for tbl in
      select unnest(array[
        'price_book_settings',
        'price_book_suppliers',
        'price_book_entries',
        'price_book_supplier_identifiers',
        'price_book_entry_inventory_items',
        'price_book_audit'
      ])
    loop
      execute format('revoke all on table public.%I from service_role', tbl);
    end loop;

    for fn in
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like 'price\_book\_%' escape '\'
    loop
      execute format(
        'revoke all on function public.%I(%s) from service_role',
        fn.proname,
        fn.args
      );
    end loop;
  end if;
end
$$;

comment on table public.price_book_settings is
  'Single company gross-margin default. Null material overrides use this value at calculation time.';
comment on column public.price_book_entries.gross_margin_percent_override is
  'Null follows the company default. A new material leaves this empty rather than copying 40.';
comment on column public.price_book_entries.cost_source is
  'manual for a person''s save. pdf_import is reserved for a later import writer. price_book_save_supplier_material never writes pdf_import. A manual save that changes purchase cost records manual again; an unchanged purchase cost keeps the stored source.';
comment on column public.price_book_entries.cost_effective_on is
  'Date the material purchase cost takes effect. Required on materials. Labor rows leave this empty.';
comment on column public.price_book_entries.price_basis is
  'Unit the purchase cost is denominated in. Must match pricing_unit, or a confirmed box coverage conversion must connect them.';
comment on column public.price_book_entries.price_conversion_confirmed is
  'True only when a manager confirmed coverage as the conversion between a box price and the other unit.';
comment on table public.price_book_supplier_identifiers is
  'Supplier SKU or reviewer-assigned internal code. Unique per supplier. Authenticated users can read these rows. Changes go through the material and identifier functions, which lock the material first.';
comment on table public.price_book_entry_inventory_items is
  'Many inventory records may belong to one material. Link rows do not change inventory quantity or unit cost.';
comment on table public.price_book_audit is
  'Append-only history. Approved users can read it. Triggers are the only writers.';
comment on function public.price_book_material_unit_selling_price(numeric, numeric, text, text, numeric, text, boolean) is
  'Decimal unit selling price at 6 places. 100 at 40% gross margin is 166.666667. 1.2345 at 40% is 2.057500.';
comment on function public.price_book_material_line_total(numeric, numeric, numeric, text, text, numeric, text, boolean) is
  'Line total in cents. 125.5 sq ft at 1.2345 cost and 40% gross margin is 258.22.';
comment on function public.price_book_save_supplier_material(uuid, text, text, text, uuid, text, text, boolean, numeric, text, numeric, numeric, boolean, date, text, text) is
  'Creates or updates one supplier-backed material. Returns the entry id. Omitted identifiers stay only when the supplier is unchanged. A supplier change replaces identifiers with the codes passed in that call.';
comment on function public.price_book_save_supplier_identifier(uuid, text, text) is
  'Manager/admin insert or update of one supplier SKU or internal code. Locks the material first and returns the identifier id.';
comment on function public.price_book_remove_supplier_identifier(uuid, text) is
  'Manager/admin removal of one identifier. Locks the material first and rejects removal of the last identifier on a supplier-backed material.';

-- ---------------------------------------------------------------------------
-- Seed the company default. Does not copy 40 into any material override.
-- ---------------------------------------------------------------------------

insert into public.price_book_settings (id, default_material_gross_margin_percent)
values (1, 40.00)
on conflict (id) do nothing;

commit;
