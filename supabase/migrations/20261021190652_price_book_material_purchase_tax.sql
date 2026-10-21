-- Approved Price Book material purchase-tax migration.
-- Applying it adds the company material purchase-tax default.
-- Depends on supabase/migrations/20261021171554_price_book_foundation.sql.
-- Do not edit that migration.
--
-- Supplier PDF prices and manually entered purchase costs stay pretax.
-- Material purchase tax is the tax this company pays on that cost. It is not
-- tax charged to a customer.
--
-- Material unit selling price, half away from zero:
--   pretax cost per pricing unit
--     = purchase cost when price basis and pricing unit match
--     = purchase cost / coverage when the price basis is a box
--     = purchase cost * coverage when the pricing unit is a box
--   tax-inclusive cost per pricing unit
--     = pretax cost per pricing unit * (1 + material purchase tax / 100)
--   unit selling price
--     = round(tax-inclusive cost / (1 - gross margin / 100), 6)
--   line total
--     = round(quantity * unit selling price, 2)
-- Tax is applied once, after the confirmed package conversion. The stored
-- purchase cost is not replaced with the tax-inclusive cost.
--
-- Company material purchase tax defaults to 7%. Company gross margin is left
-- at its current value. A material with no margin override uses both current
-- company settings when its selling price is calculated, so existing materials
-- pick up 7% without a change to their purchase cost.
--
-- Demolition and installation keep the manual selling rate. They do not use
-- purchase tax or gross margin.
--
-- This script does not update price book entries, identifiers, inventory
-- quantities, or inventory unit costs. It sets the new settings column when
-- that column is null. That settings write records one history row.
--
-- Audit snapshots for a material include the pretax purchase cost, the pretax
-- cost per pricing unit, the purchase-tax percent, the tax-inclusive cost per
-- pricing unit, the margin, and the unit selling price. Older history rows are
-- not rewritten.
--
-- Saved estimates do not exist yet. A future estimate stores
-- price_book_estimate_material_snapshot() on the material line at save time
-- and does not recalculate it when company tax or margin later changes.
-- Labor estimate lines store the manual selling rate only.
-- A future PDF import updates the pretax purchase cost and does not change
-- the company tax or margin settings.
--
-- Worked examples, not executed by this file:
--   100.0000 pretax, 7% purchase tax, 40% margin, same unit
--     tax-inclusive cost 107
--     unit selling price 178.333333
--     quantity 1 line total 178.33
--   100.0000 pretax, 0% purchase tax, 40% margin
--     unit selling price 166.666667
--     quantity 1 line total 166.67
--   40.0000 per box, confirmed 20 sq ft, sell per sq ft, 7% tax, 40% margin
--     pretax cost per sq ft 2
--     tax-inclusive cost per sq ft 2.14
--     unit selling price 3.566667
--     quantity 1 line total 3.57

begin;

do $$
begin
  if to_regclass('public.price_book_settings') is null
     or to_regclass('public.price_book_entries') is null
     or to_regprocedure('public.price_book_entry_unit_selling_price(uuid)') is null
     or to_regprocedure('public.price_book_labor_line_total(text, numeric, numeric)') is null
     or to_regprocedure('public.price_book_company_default_margin()') is null then
    raise exception
      'PRICEBOOK:MISSING_FOUNDATION:Apply the price book foundation migration before material purchase tax';
  end if;

  if to_regprocedure('public.price_book_material_unit_selling_price(numeric, numeric, text, text, numeric, text, boolean)') is null
     and to_regprocedure('public.price_book_material_unit_selling_price(numeric, numeric, numeric, text, text, numeric, text, boolean)') is null then
    raise exception
      'PRICEBOOK:MISSING_FOUNDATION:Apply the price book foundation migration before material purchase tax';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tax validation and the single calculation path
-- ---------------------------------------------------------------------------

create or replace function public.price_book_validate_purchase_tax(p_tax numeric)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if p_tax is null
     or p_tax = 'NaN'::numeric
     or p_tax = 'Infinity'::numeric
     or p_tax = '-Infinity'::numeric
     or p_tax < 0
     or p_tax > 999.99 then
    perform public.price_book_raise(
      'PURCHASE_TAX_RANGE',
      'Material purchase tax must be at least 0 and at most 999.99.'
    );
  end if;
  if p_tax <> round(p_tax, 2) then
    perform public.price_book_raise(
      'PURCHASE_TAX_SCALE',
      'Material purchase tax supports at most 2 decimal places.'
    );
  end if;
  return p_tax;
end;
$$;

create or replace function public.price_book_material_pretax_cost_per_pricing_unit(
  p_purchase_cost numeric,
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
begin
  if p_pricing_unit = p_price_basis then
    return p_purchase_cost;
  elsif p_price_basis = 'box' and p_conversion_confirmed then
    return p_purchase_cost / p_coverage_quantity;
  elsif p_pricing_unit = 'box' and p_conversion_confirmed then
    return p_purchase_cost * p_coverage_quantity;
  end if;

  perform public.price_book_raise(
    'CONVERSION_INVALID',
    public.price_book_shape_message('CONVERSION_INVALID')
  );
  return null;
end;
$$;

create or replace function public.price_book_material_price_parts(
  p_purchase_cost numeric,
  p_purchase_tax_percent numeric,
  p_margin_percent numeric,
  p_pricing_unit text,
  p_price_basis text,
  p_coverage_quantity numeric,
  p_coverage_unit text,
  p_conversion_confirmed boolean
)
returns table (
  purchase_tax_percent numeric,
  pretax_cost_per_pricing_unit numeric,
  tax_inclusive_cost_per_pricing_unit numeric,
  unit_selling_price numeric
)
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_code text;
  v_tax numeric;
  v_pretax numeric;
  v_taxed numeric;
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

  v_tax := public.price_book_validate_purchase_tax(p_purchase_tax_percent);
  v_pretax := public.price_book_material_pretax_cost_per_pricing_unit(
    p_purchase_cost,
    p_pricing_unit,
    p_price_basis,
    p_coverage_quantity,
    p_coverage_unit,
    p_conversion_confirmed
  );
  v_taxed := v_pretax * (1 + (v_tax / 100));

  return query
  select
    v_tax,
    v_pretax,
    v_taxed,
    round(v_taxed / (1 - (p_margin_percent / 100)), 6);
end;
$$;

create or replace function public.price_book_material_unit_selling_price(
  p_purchase_cost numeric,
  p_purchase_tax_percent numeric,
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
  select parts.unit_selling_price
    into v_unit
  from public.price_book_material_price_parts(
    p_purchase_cost,
    p_purchase_tax_percent,
    p_margin_percent,
    p_pricing_unit,
    p_price_basis,
    p_coverage_quantity,
    p_coverage_unit,
    p_conversion_confirmed
  ) parts;

  if not found then
    perform public.price_book_raise('PRICE_RANGE', 'Unit price must be zero or greater.');
  end if;
  return v_unit;
end;
$$;

create or replace function public.price_book_material_line_total(
  p_quantity numeric,
  p_purchase_cost numeric,
  p_purchase_tax_percent numeric,
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
    p_purchase_tax_percent,
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

create or replace function public.price_book_material_price_snapshot(
  p_purchase_cost numeric,
  p_purchase_tax_percent numeric,
  p_margin_percent numeric,
  p_pricing_unit text,
  p_price_basis text,
  p_coverage_quantity numeric,
  p_coverage_unit text,
  p_conversion_confirmed boolean
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
begin
  select jsonb_build_object(
    'purchase_cost', p_purchase_cost,
    'pretax_cost_per_pricing_unit', parts.pretax_cost_per_pricing_unit,
    'purchase_tax_percent', parts.purchase_tax_percent,
    'tax_inclusive_cost_per_pricing_unit', parts.tax_inclusive_cost_per_pricing_unit,
    'gross_margin_percent', p_margin_percent,
    'unit_selling_price', parts.unit_selling_price
  )
    into v_snapshot
  from public.price_book_material_price_parts(
    p_purchase_cost,
    p_purchase_tax_percent,
    p_margin_percent,
    p_pricing_unit,
    p_price_basis,
    p_coverage_quantity,
    p_coverage_unit,
    p_conversion_confirmed
  ) parts;

  return v_snapshot;
end;
$$;

-- ---------------------------------------------------------------------------
-- Company default. Existing rows gain 7% without a purchase-cost rewrite.
-- ---------------------------------------------------------------------------

alter table public.price_book_settings
  add column if not exists default_material_purchase_tax_percent numeric;

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

  perform public.price_book_validate_purchase_tax(new.default_material_purchase_tax_percent);

  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

update public.price_book_settings
set default_material_purchase_tax_percent = 7.00
where id = 1
  and default_material_purchase_tax_percent is null;

alter table public.price_book_settings
  alter column default_material_purchase_tax_percent set default 7.00;

alter table public.price_book_settings
  alter column default_material_purchase_tax_percent set not null;

alter table public.price_book_settings
  drop constraint if exists price_book_settings_purchase_tax_range;

alter table public.price_book_settings
  add constraint price_book_settings_purchase_tax_range
  check (
    default_material_purchase_tax_percent >= 0
    and default_material_purchase_tax_percent <= 999.99
    and default_material_purchase_tax_percent = round(default_material_purchase_tax_percent, 2)
    and default_material_purchase_tax_percent <> 'NaN'::numeric
    and default_material_purchase_tax_percent <> 'Infinity'::numeric
    and default_material_purchase_tax_percent <> '-Infinity'::numeric
  );

create or replace function public.price_book_company_default_purchase_tax()
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tax numeric;
begin
  select default_material_purchase_tax_percent
    into v_tax
  from public.price_book_settings
  where id = 1;

  if not found then
    raise exception 'PRICEBOOK:SETTINGS_MISSING:Material purchase tax is not available.'
      using errcode = 'P0001';
  end if;

  return public.price_book_validate_purchase_tax(v_tax);
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
  v_tax numeric;
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
  v_tax := public.price_book_company_default_purchase_tax();

  return public.price_book_material_unit_selling_price(
    v_entry.purchase_cost,
    v_tax,
    v_margin,
    v_entry.pricing_unit,
    v_entry.price_basis,
    v_entry.coverage_quantity,
    v_entry.coverage_unit,
    v_entry.price_conversion_confirmed
  );
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
  v_tax numeric;
  v_snapshot jsonb;
begin
  v_json := to_jsonb(p_row) - 'updated_at' - 'updated_by';

  if p_row.entry_type = 'material' then
    v_default := public.price_book_company_default_margin();
    v_margin := public.price_book_effective_material_margin(
      p_row.gross_margin_percent_override,
      v_default
    );
    v_tax := public.price_book_company_default_purchase_tax();
    v_snapshot := public.price_book_material_price_snapshot(
      p_row.purchase_cost,
      v_tax,
      v_margin,
      p_row.pricing_unit,
      p_row.price_basis,
      p_row.coverage_quantity,
      p_row.coverage_unit,
      p_row.price_conversion_confirmed
    );
    v_json := v_json || v_snapshot || jsonb_build_object(
      'company_default_gross_margin_percent', v_default,
      'effective_gross_margin_percent', v_margin,
      'company_default_purchase_tax_percent', v_tax
    );
  end if;

  return v_json;
end;
$$;

create or replace function public.price_book_estimate_material_snapshot(p_entry_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
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
    raise exception
      'PRICEBOOK:ENTRY_TYPE:Demolition and installation use the manual selling rate. They do not use material purchase tax or gross margin.'
      using errcode = 'P0001';
  end if;

  return public.price_book_entry_audit_json(v_entry);
end;
$$;

-- Remove the pretax-only signatures so a caller cannot skip purchase tax.
drop function if exists public.price_book_material_line_total(numeric, numeric, numeric, text, text, numeric, text, boolean);
drop function if exists public.price_book_material_unit_selling_price(numeric, numeric, text, text, numeric, text, boolean);

do $$
declare
  v_margin numeric;
  v_tax numeric;
begin
  select default_material_gross_margin_percent, default_material_purchase_tax_percent
    into v_margin, v_tax
  from public.price_book_settings
  where id = 1;

  if v_margin is null then
    raise exception 'PRICEBOOK:SETTINGS_MISSING:Material purchase tax requires the company settings row.';
  end if;
  if v_tax is distinct from 7.00 then
    raise exception
      'PRICEBOOK:PURCHASE_TAX_RANGE:Material purchase tax default must be 7 percent, found %',
      coalesce(v_tax::text, 'null');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants. Trigger and helper functions stay unavailable to client roles.
-- ---------------------------------------------------------------------------

revoke all on function public.price_book_validate_purchase_tax(numeric) from public, anon, authenticated;
revoke all on function public.price_book_material_pretax_cost_per_pricing_unit(numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_material_price_parts(numeric, numeric, numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_material_unit_selling_price(numeric, numeric, numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_material_line_total(numeric, numeric, numeric, numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_material_price_snapshot(numeric, numeric, numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_company_default_purchase_tax() from public, anon, authenticated;
revoke all on function public.price_book_estimate_material_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.price_book_settings_before_write() from public, anon, authenticated;

grant execute on function public.price_book_material_unit_selling_price(numeric, numeric, numeric, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.price_book_material_line_total(numeric, numeric, numeric, numeric, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.price_book_material_price_snapshot(numeric, numeric, numeric, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.price_book_company_default_purchase_tax() to authenticated;
grant execute on function public.price_book_estimate_material_snapshot(uuid) to authenticated;

do $$
declare
  fn record;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
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

comment on column public.price_book_settings.default_material_purchase_tax_percent is
  'Company material purchase tax percent. Supplier prices and purchase_cost exclude this tax. 7 is the default. This is not tax charged to a customer.';
comment on column public.price_book_entries.purchase_cost is
  'Pretax supplier purchase cost. Material purchase tax is applied during selling-price calculation and is not added into this column. Imports update this cost and leave company tax and margin settings unchanged.';
comment on table public.price_book_settings is
  'Single company gross-margin and material purchase-tax defaults. Null material margin overrides use the margin default at calculation time. Materials have no purchase-tax override.';
comment on function public.price_book_material_unit_selling_price(numeric, numeric, numeric, text, text, numeric, text, boolean) is
  'Unit selling price at 6 places after one purchase-tax application. 100 at 7% tax and 40% margin is 178.333333. The same cost at 0% tax is 166.666667.';
comment on function public.price_book_material_line_total(numeric, numeric, numeric, numeric, text, text, numeric, text, boolean) is
  'Line total in cents from the tax-inclusive unit selling price. 100 at 7% tax and 40% margin for quantity 1 is 178.33.';
comment on function public.price_book_material_price_snapshot(numeric, numeric, numeric, text, text, numeric, text, boolean) is
  'Pretax cost, cost per pricing unit, purchase tax, tax-inclusive cost, margin, and unit selling price. Future estimate lines copy this snapshot instead of recalculating it.';
comment on function public.price_book_estimate_material_snapshot(uuid) is
  'Material snapshot for a future saved estimate, including purchase tax. Labor entries are rejected. Saving an estimate is not implemented here.';
comment on function public.price_book_company_default_purchase_tax() is
  'Current company material purchase tax. Selling prices read it at calculation time.';

commit;
