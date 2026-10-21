-- Approved Price Book calculation-detail migration.
-- Applying it adds the material calculation reader for purchase tax and gross profit.
-- Depends on supabase/migrations/20261021190652_price_book_material_purchase_tax.sql.
-- Do not edit the applied Price Book migrations.

-- Materials need the purchase-tax amount and the gross-profit amount in
-- addition to the values already returned by price_book_material_price_snapshot.
-- Gross profit is round(unit selling price - tax-inclusive cost, 2), half away
-- from zero. The unit selling price stays at 6 decimal places. The one-unit
-- line total uses price_book_line_total, so quantity 1 of 178.333333 is 178.33.
-- A $100 pretax cost at 7% purchase tax and 40% gross margin is:
--   pretax 100, tax amount 7, tax-inclusive 107, gross profit 71.33,
--   unit 178.333333, one-unit line total 178.33.

begin;

do $$
begin
  if to_regprocedure('public.price_book_company_default_margin()') is null
     or to_regprocedure('public.price_book_company_default_purchase_tax()') is null
     or to_regprocedure('public.price_book_effective_material_margin(numeric, numeric)') is null
     or to_regprocedure('public.price_book_material_price_snapshot(numeric, numeric, numeric, text, text, numeric, text, boolean)') is null
     or to_regprocedure('public.price_book_line_total(numeric, numeric)') is null then
    raise exception
      'PRICEBOOK:MISSING_TAX:Apply the material purchase-tax migration before this calculation detail';
  end if;
end
$$;

create or replace function public.price_book_entry_material_calculation(p_entry_id uuid)
returns table (
  pretax_cost_per_pricing_unit text,
  purchase_tax_percent text,
  purchase_tax_amount text,
  tax_inclusive_cost_per_pricing_unit text,
  effective_gross_margin_percent text,
  margin_source text,
  gross_profit_amount text,
  unit_selling_price text,
  one_unit_line_total text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_entry public.price_book_entries%rowtype;
  v_margin numeric;
  v_tax numeric;
  v_snapshot jsonb;
  v_pretax numeric;
  v_inclusive numeric;
  v_unit numeric;
  v_pretax_text text;
  v_tax_text text;
  v_tax_amount_text text;
  v_inclusive_text text;
  v_margin_text text;
  v_profit_text text;
  v_unit_text text;
  v_line_text text;
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

  v_margin := public.price_book_effective_material_margin(
    v_entry.gross_margin_percent_override,
    public.price_book_company_default_margin()
  );
  v_tax := public.price_book_company_default_purchase_tax();
  v_snapshot := public.price_book_material_price_snapshot(
    v_entry.purchase_cost,
    v_tax,
    v_margin,
    v_entry.pricing_unit,
    v_entry.price_basis,
    v_entry.coverage_quantity,
    v_entry.coverage_unit,
    v_entry.price_conversion_confirmed
  );

  v_pretax := (v_snapshot ->> 'pretax_cost_per_pricing_unit')::numeric;
  v_inclusive := (v_snapshot ->> 'tax_inclusive_cost_per_pricing_unit')::numeric;
  v_unit := (v_snapshot ->> 'unit_selling_price')::numeric;

  select
    case when position('.' in src.pretax_text) = 0 then src.pretax_text else rtrim(rtrim(src.pretax_text, '0'), '.') end,
    case when position('.' in src.tax_text) = 0 then src.tax_text else rtrim(rtrim(src.tax_text, '0'), '.') end,
    case when position('.' in src.tax_amount_text) = 0 then src.tax_amount_text else rtrim(rtrim(src.tax_amount_text, '0'), '.') end,
    case when position('.' in src.inclusive_text) = 0 then src.inclusive_text else rtrim(rtrim(src.inclusive_text, '0'), '.') end,
    case when position('.' in src.margin_text) = 0 then src.margin_text else rtrim(rtrim(src.margin_text, '0'), '.') end,
    case when position('.' in src.profit_text) = 0 then src.profit_text else rtrim(rtrim(src.profit_text, '0'), '.') end,
    case when position('.' in src.unit_text) = 0 then src.unit_text else rtrim(rtrim(src.unit_text, '0'), '.') end,
    case when position('.' in src.line_text) = 0 then src.line_text else rtrim(rtrim(src.line_text, '0'), '.') end
  into
    v_pretax_text,
    v_tax_text,
    v_tax_amount_text,
    v_inclusive_text,
    v_margin_text,
    v_profit_text,
    v_unit_text,
    v_line_text
  from (
    select
      v_pretax::text as pretax_text,
      ((v_snapshot ->> 'purchase_tax_percent')::numeric)::text as tax_text,
      (v_inclusive - v_pretax)::text as tax_amount_text,
      v_inclusive::text as inclusive_text,
      ((v_snapshot ->> 'gross_margin_percent')::numeric)::text as margin_text,
      round(v_unit - v_inclusive, 2)::text as profit_text,
      v_unit::text as unit_text,
      public.price_book_line_total(1, v_unit)::text as line_text
  ) src;

  return query
  select
    v_pretax_text,
    v_tax_text,
    v_tax_amount_text,
    v_inclusive_text,
    v_margin_text,
    case
      when v_entry.gross_margin_percent_override is null then 'company'
      else 'override'
    end,
    v_profit_text,
    v_unit_text,
    v_line_text;
end;
$$;


revoke all on function public.price_book_entry_material_calculation(uuid) from public, anon, authenticated;
grant execute on function public.price_book_entry_material_calculation(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.price_book_entry_material_calculation(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.price_book_entry_material_calculation(uuid)', 'execute') then
    raise exception 'PRICEBOOK:DETAIL_GRANT:Only approved sign-ins may execute the calculation detail';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'price_book_entry_material_calculation'
      and p.prosecdef
  ) then
    raise exception 'PRICEBOOK:DETAIL_SECURITY:The calculation detail must stay security invoker';
  end if;
end
$$;

comment on function public.price_book_entry_material_calculation(uuid) is
  'Material calculation detail for one entry. Returns pretax cost per pricing unit, purchase-tax rate and amount, tax-inclusive cost, effective gross margin, company or item margin source, cent-rounded gross profit, the 6-decimal unit selling price, and the one-unit line total. Reads as the caller, so approved-user row security still applies.';

commit;