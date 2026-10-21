-- Approved Price Book company-settings migration.
-- Applying it lets only approved admins change the company margin and material purchase tax.
-- Depends on supabase/migrations/20261021201327_price_book_material_calculation_detail.sql.
-- Do not edit the applied Price Book migrations.
--
-- Approved users keep SELECT on price_book_settings. The existing security
-- invoker pricing functions read that row, and calculation details already
-- show the effective margin and purchase tax.
-- UPDATE is limited to approved admins by row security and by the settings
-- write trigger. Managers keep catalog entries, suppliers, and item margins.

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.has_app_access()') is null
     or to_regprocedure('public.price_book_settings_before_write()') is null
     or to_regprocedure('public.price_book_raise(text, text)') is null
     or to_regprocedure('public.price_book_validate_purchase_tax(numeric)') is null
     or to_regclass('public.price_book_settings') is null then
    raise exception
      'PRICEBOOK:MISSING_SETTINGS:Apply the Price Book migrations before restricting company settings';
  end if;
end
$$;

create or replace function public.price_book_settings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.is_admin() then
      perform public.price_book_raise(
        'FORBIDDEN',
        'Only admins can change company pricing settings.'
      );
    end if;
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

revoke all on function public.price_book_settings_before_write() from public, anon, authenticated;

drop policy if exists "price_book_settings_select_admin" on public.price_book_settings;
drop policy if exists "price_book_settings_select_app" on public.price_book_settings;
create policy "price_book_settings_select_app"
  on public.price_book_settings
  for select
  to authenticated
  using (public.has_app_access());

drop policy if exists "price_book_settings_update_mgr" on public.price_book_settings;
drop policy if exists "price_book_settings_update_admin" on public.price_book_settings;
create policy "price_book_settings_update_admin"
  on public.price_book_settings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

do $$
declare
  v_select text;
  v_update text;
  v_update_check text;
  v_entry text;
  v_supplier text;
  v_trigger text;
  v_margin_definer boolean;
  v_tax_definer boolean;
begin
  select qual
    into v_select
  from pg_policies
  where schemaname = 'public'
    and tablename = 'price_book_settings'
    and policyname = 'price_book_settings_select_app';

  select qual, with_check
    into v_update, v_update_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'price_book_settings'
    and policyname = 'price_book_settings_update_admin';

  select qual
    into v_entry
  from pg_policies
  where schemaname = 'public'
    and tablename = 'price_book_entries'
    and policyname = 'price_book_entries_update_mgr';

  select qual
    into v_supplier
  from pg_policies
  where schemaname = 'public'
    and tablename = 'price_book_suppliers'
    and policyname = 'price_book_suppliers_update_mgr';

  if v_select is null
     or v_select not like '%has_app_access%'
     or v_select like '%is_admin%' then
    raise exception 'PRICEBOOK:SETTINGS_SELECT:Approved users must still be able to read company settings';
  end if;

  if v_update is null
     or v_update_check is null
     or v_update not like '%is_admin%'
     or v_update_check not like '%is_admin%'
     or v_update like '%is_manager_or_admin%'
     or v_update_check like '%is_manager_or_admin%' then
    raise exception 'PRICEBOOK:SETTINGS_UPDATE:Only approved admins may change company settings';
  end if;

  if v_entry is null
     or v_entry not like '%is_manager_or_admin%'
     or v_supplier is null
     or v_supplier not like '%is_manager_or_admin%' then
    raise exception 'PRICEBOOK:CATALOG_POLICY:Managers must keep entry and supplier changes';
  end if;

  v_trigger := pg_get_functiondef('public.price_book_settings_before_write()'::regprocedure);
  if v_trigger not like '%is_admin%'
     or v_trigger not like '%Only admins can change company pricing settings.%'
     or v_trigger ilike '%price_book_assert_writer%' then
    raise exception 'PRICEBOOK:SETTINGS_TRIGGER:The settings trigger must reject non-admin updates';
  end if;

  select p.prosecdef
    into v_margin_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'price_book_company_default_margin';

  select p.prosecdef
    into v_tax_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'price_book_company_default_purchase_tax';

  if v_margin_definer is true or v_tax_definer is true then
    raise exception 'PRICEBOOK:INVOKER:Company pricing readers must stay security invoker';
  end if;

  if pg_get_functiondef('public.price_book_company_default_purchase_tax()'::regprocedure)
       ilike '%price_book_validate_purchase_tax%' then
    raise exception 'PRICEBOOK:READER_CALL:The tax reader must not call the private validator';
  end if;

  if has_function_privilege('authenticated', 'public.price_book_settings_before_write()', 'execute')
     or has_function_privilege('anon', 'public.price_book_settings_before_write()', 'execute') then
    raise exception 'PRICEBOOK:TRIGGER_GRANT:The settings trigger must stay private';
  end if;
end
$$;

comment on function public.price_book_settings_before_write() is
  'Validates the company settings row. Approved users may read it. Only an approved admin may update the company margin or material purchase tax.';

commit;
