-- Approved Price Book purchase-tax read-permission correction.
-- Applying it lets approved users read material prices without calling revoked helpers.
-- Depends on supabase/migrations/20261021190652_price_book_material_purchase_tax.sql.
-- Do not edit that migration or supabase/migrations/20261021171554_price_book_foundation.sql.

-- price_book_entry_unit_selling_price reads the company tax through
-- price_book_company_default_purchase_tax. That reader was calling
-- price_book_validate_purchase_tax, whose EXECUTE privilege is revoked from
-- authenticated. The stored tax column is already not null and checked, so
-- the reader returns the stored value and does not call the private validator.
--
-- price_book_estimate_material_snapshot was calling price_book_entry_audit_json,
-- which stays revoked. The snapshot now reads the entry itself, so approved-user
-- row security still applies, and builds the same material snapshot with
-- functions authenticated users can execute. It does not become security definer
-- and does not grant the private audit helper.

begin;

do $$
begin
  if to_regprocedure('public.price_book_company_default_purchase_tax()') is null
     or to_regprocedure('public.price_book_estimate_material_snapshot(uuid)') is null
     or to_regprocedure('public.price_book_validate_purchase_tax(numeric)') is null
     or to_regprocedure('public.price_book_entry_audit_json(public.price_book_entries)') is null
     or to_regprocedure('public.price_book_material_price_snapshot(numeric, numeric, numeric, text, text, numeric, text, boolean)') is null
     or to_regprocedure('public.price_book_company_default_margin()') is null
     or to_regprocedure('public.price_book_effective_material_margin(numeric, numeric)') is null then
    raise exception
      'PRICEBOOK:MISSING_TAX:Apply the material purchase-tax migration before this correction';
  end if;
end
$$;

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

  return v_tax;
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
  v_json jsonb;
  v_default numeric;
  v_margin numeric;
  v_tax numeric;
  v_snapshot jsonb;
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

  -- Same material fields the audit trigger stores. This function does not
  -- call that private helper.
  v_default := public.price_book_company_default_margin();
  v_margin := public.price_book_effective_material_margin(
    v_entry.gross_margin_percent_override,
    v_default
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
  v_json := to_jsonb(v_entry) - 'updated_at' - 'updated_by';

  return v_json || v_snapshot || jsonb_build_object(
    'company_default_gross_margin_percent', v_default,
    'effective_gross_margin_percent', v_margin,
    'company_default_purchase_tax_percent', v_tax
  );
end;
$$;

revoke all on function public.price_book_validate_purchase_tax(numeric) from public, anon, authenticated;
revoke all on function public.price_book_material_pretax_cost_per_pricing_unit(numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_material_price_parts(numeric, numeric, numeric, text, text, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.price_book_entry_audit_json(public.price_book_entries) from public, anon, authenticated;

grant execute on function public.price_book_company_default_purchase_tax() to authenticated;
grant execute on function public.price_book_estimate_material_snapshot(uuid) to authenticated;

do $$
declare
  v_reader text := pg_get_functiondef('public.price_book_company_default_purchase_tax()'::regprocedure);
  v_snapshot text := pg_get_functiondef('public.price_book_estimate_material_snapshot(uuid)'::regprocedure);
  v_validator_public boolean;
  v_audit_public boolean;
begin
  if v_reader ilike '%price_book_validate_purchase_tax%' then
    raise exception 'PRICEBOOK:READER_CALL:The tax reader still calls the private validator';
  end if;
  if v_snapshot ilike '%price_book_entry_audit_json%' then
    raise exception 'PRICEBOOK:SNAPSHOT_CALL:The material snapshot still calls the private audit helper';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'price_book_company_default_purchase_tax',
        'price_book_estimate_material_snapshot'
      )
      and p.prosecdef
  ) then
    raise exception 'PRICEBOOK:INVOKER:The tax reader and material snapshot must stay security invoker';
  end if;

  select exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.privilege_type = 'EXECUTE'
      and a.grantee = 0
  )
    into v_validator_public
  from pg_proc p
  where p.oid = 'public.price_book_validate_purchase_tax(numeric)'::regprocedure;

  select exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.privilege_type = 'EXECUTE'
      and a.grantee = 0
  )
    into v_audit_public
  from pg_proc p
  where p.oid = 'public.price_book_entry_audit_json(public.price_book_entries)'::regprocedure;

  if v_validator_public
     or has_function_privilege('anon', 'public.price_book_validate_purchase_tax(numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.price_book_validate_purchase_tax(numeric)', 'execute') then
    raise exception 'PRICEBOOK:VALIDATOR_GRANT:The purchase-tax validator must stay revoked';
  end if;

  if v_audit_public
     or has_function_privilege('anon', 'public.price_book_entry_audit_json(public.price_book_entries)', 'execute')
     or has_function_privilege('authenticated', 'public.price_book_entry_audit_json(public.price_book_entries)', 'execute') then
    raise exception 'PRICEBOOK:AUDIT_GRANT:The audit helper must stay revoked';
  end if;

  if not has_function_privilege('authenticated', 'public.price_book_company_default_purchase_tax()', 'execute')
     or not has_function_privilege('authenticated', 'public.price_book_estimate_material_snapshot(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.price_book_entry_unit_selling_price(uuid)', 'execute') then
    raise exception 'PRICEBOOK:READ_GRANT:Approved users must be able to execute the price readers';
  end if;
end
$$;

comment on function public.price_book_company_default_purchase_tax() is
  'Current company material purchase tax. Approved users read the stored value. The column check constrains it, so this reader does not call the private validator.';

comment on function public.price_book_estimate_material_snapshot(uuid) is
  'Material snapshot for a future saved estimate, including purchase tax. Reads the entry as the caller so approved-user row rules still apply, and does not call the private audit helper. Labor entries are rejected.';

commit;