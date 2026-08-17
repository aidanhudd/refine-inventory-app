-- =============================================================================
-- P3-3 — Appearance settings schema + secured RPCs (APPROVED MIGRATION)
-- =============================================================================
--
-- STATUS: Approved P3-3 migration.
--   - Additive only: creates new appearance tables, helpers, and RPCs.
--   - The current/live website ignores these objects and remains unchanged until
--     application code begins calling the Appearance RPCs.
--   - Apply this migration before deploying any client that calls Appearance RPCs.
--   - Once applied, never edit this file; future corrections require a new migration.
--   - Executable body is wrapped in a single BEGIN/COMMIT transaction.
--   - CREATE TABLE has no IF NOT EXISTS (fail clearly on schema collisions).
--   - version_number is bigint throughout.
--
-- ROLLOUT COMPATIBILITY
--   Applying this migration alone does not change the old or current website.
--   No client code reads these tables/RPCs yet; the empty appearance_settings
--   singleton has no published version, so get_published_appearance() returns
--   no row and apps continue using compiled TypeScript defaults.
--   No initial version row and no TypeScript default JSON are inserted here.
--
-- SCHEMA ALIGNMENT (TypeScript source of truth)
--   Configurable inventory action slots (stored):
--     edit, use, hold, addPhotos, markSold, undoMarkSold, delete
--   Rendered-only (NOT stored in appearance config):
--     save, cancel, releaseHold
--   Field IDs (13): holdStatus, productName, quantity (required / never hidden)
--     + badges, unitCost, location, dimensions, totalValue, status, createdAt,
--       notes, usageHistory, photos (optional / hideable)
--
-- STABLE EXCEPTIONS
--   APPEARANCE:<REASON_CODE>:<human-readable message>
--   Codes used below include at least:
--     FORBIDDEN, INVALID_CONFIG, UNSUPPORTED_SCHEMA, DRAFT_NOT_FOUND,
--     VERSION_NOT_FOUND, INVALID_LABEL, SETTINGS_NOT_FOUND
--
-- PUBLIC RPCs (7) — grant execute to authenticated only
--   1. get_published_appearance()
--   2. get_appearance_draft()
--   3. upsert_appearance_draft(p_config jsonb)
--   4. reset_appearance_draft()
--   5. list_appearance_versions()
--   6. restore_appearance_version_to_draft(p_version_id uuid)
--   7. publish_appearance_draft(p_label text default null)
--
-- MANUAL VERIFICATION CHECKLIST (run after apply in a review environment)
--   [ ] Tables exist: appearance_versions, appearance_drafts, appearance_settings
--   [ ] Singleton row: select * from appearance_settings → id='global', published null
--   [ ] RLS enabled; zero policies on all three tables
--   [ ] No table grants for PUBLIC / anon / authenticated
--   [ ] Helper functions not executable by PUBLIC / anon / authenticated
--   [ ] Only the seven public RPCs granted to authenticated
--   [ ] Non-admin cannot call draft/publish/list/restore (APPEARANCE:FORBIDDEN:...)
--   [ ] Non-approved user cannot call get_published_appearance (FORBIDDEN)
--   [ ] Admin A draft invisible to Admin B (get / upsert / reset isolation)
--   [ ] Invalid configs rejected (bad schemaVersion, title, permutations, actions)
--   [ ] Missing JSON schemaVersion is rejected
--   [ ] JSON string "1" is rejected
--   [ ] JSON number 1.5 is rejected
--   [ ] JSON number 1 with column schema version 1 is accepted
--   [ ] Unknown top-level/nested keys stripped; required malformed values rejected
--   [ ] reset_appearance_draft deletes only caller draft
--   [ ] restore_appearance_version_to_draft sets restored_from_version_id
--   [ ] upsert_appearance_draft clears restored_from_version_id
--   [ ] publish creates version, updates pointer, uses restore_publish when marker set
--   [ ] Concurrent publish: two sessions → distinct version_number (no unique conflict)
--   [ ] Versions cannot be updated/deleted via public API (no RPC; mutation trigger)
--   [ ] get_published_appearance normalizes stored config (invalid → stable error)
--   [ ] Conflicting pre-existing tables cause migration failure (no IF NOT EXISTS)
--
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.appearance_versions (
  id uuid primary key default gen_random_uuid(),
  version_number bigint not null,
  label text,
  config jsonb not null,
  config_schema_version integer not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  source text not null,
  constraint appearance_versions_version_number_positive
    check (version_number > 0),
  constraint appearance_versions_version_number_unique
    unique (version_number),
  constraint appearance_versions_label_length
    check (label is null or char_length(label) <= 120),
  constraint appearance_versions_schema_v1
    check (config_schema_version = 1),
  constraint appearance_versions_source_check
    check (source in ('publish', 'restore_publish')),
  constraint appearance_versions_config_is_object
    check ((jsonb_typeof(config) = 'object') is true),
  constraint appearance_versions_config_schema_version_json
    check (
      (
        case
          -- Missing key, JSON null, string/bool/array/object → not a JSON number.
          when jsonb_typeof(config -> 'schemaVersion') is distinct from 'number' then false
          -- Cast only after confirming JSON number; require exact integer 1.
          when (config ->> 'schemaVersion')::numeric is distinct from 1::numeric then false
          when trunc((config ->> 'schemaVersion')::numeric)
            is distinct from (config ->> 'schemaVersion')::numeric then false
          else true
        end
      ) is true
    ),
  constraint appearance_versions_config_schema_agree
    check (
      (
        (config_schema_version = 1) is true
        and case
              when jsonb_typeof(config -> 'schemaVersion') is distinct from 'number' then false
              when (config ->> 'schemaVersion')::numeric is distinct from 1::numeric then false
              when trunc((config ->> 'schemaVersion')::numeric)
                is distinct from (config ->> 'schemaVersion')::numeric then false
              else true
            end
      ) is true
    )
);

comment on table public.appearance_versions is
  'Immutable published appearance configs. Public API must not update or delete rows.';

create table public.appearance_drafts (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users (id) on delete cascade,
  config jsonb not null,
  config_schema_version integer not null,
  updated_at timestamptz not null default now(),
  restored_from_version_id uuid references public.appearance_versions (id) on delete restrict,
  constraint appearance_drafts_admin_user_unique
    unique (admin_user_id),
  constraint appearance_drafts_schema_v1
    check (config_schema_version = 1),
  constraint appearance_drafts_config_is_object
    check ((jsonb_typeof(config) = 'object') is true),
  constraint appearance_drafts_config_schema_version_json
    check (
      (
        case
          -- Missing key, JSON null, string/bool/array/object → not a JSON number.
          when jsonb_typeof(config -> 'schemaVersion') is distinct from 'number' then false
          -- Cast only after confirming JSON number; require exact integer 1.
          when (config ->> 'schemaVersion')::numeric is distinct from 1::numeric then false
          when trunc((config ->> 'schemaVersion')::numeric)
            is distinct from (config ->> 'schemaVersion')::numeric then false
          else true
        end
      ) is true
    ),
  constraint appearance_drafts_config_schema_agree
    check (
      (
        (config_schema_version = 1) is true
        and case
              when jsonb_typeof(config -> 'schemaVersion') is distinct from 'number' then false
              when (config ->> 'schemaVersion')::numeric is distinct from 1::numeric then false
              when trunc((config ->> 'schemaVersion')::numeric)
                is distinct from (config ->> 'schemaVersion')::numeric then false
              else true
            end
      ) is true
    )
);

comment on table public.appearance_drafts is
  'One private appearance draft per admin. restored_from_version_id marks restore→publish.';

create table public.appearance_settings (
  id text primary key,
  published_version_id uuid references public.appearance_versions (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint appearance_settings_singleton check (id = 'global')
);

comment on table public.appearance_settings is
  'Singleton published-appearance pointer (id = global). Empty until first publish.';

insert into public.appearance_settings (id, published_version_id, updated_at, updated_by)
values ('global', null, now(), null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: enabled, no policies → deny direct table access for non-owners
-- ---------------------------------------------------------------------------

alter table public.appearance_versions enable row level security;
alter table public.appearance_drafts enable row level security;
alter table public.appearance_settings enable row level security;

-- Intentionally no CREATE POLICY statements.

revoke all on table public.appearance_versions from public;
revoke all on table public.appearance_versions from anon;
revoke all on table public.appearance_versions from authenticated;

revoke all on table public.appearance_drafts from public;
revoke all on table public.appearance_drafts from anon;
revoke all on table public.appearance_drafts from authenticated;

revoke all on table public.appearance_settings from public;
revoke all on table public.appearance_settings from anon;
revoke all on table public.appearance_settings from authenticated;

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function public.appearance_raise(p_code text, p_message text)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  raise exception 'APPEARANCE:%:%', p_code, p_message
    using errcode = 'P0001';
end;
$$;

create or replace function public.appearance_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- coalesce so an unexpected null from is_admin() never grants access.
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    perform public.appearance_raise(
      'FORBIDDEN',
      'Approved admin access is required for appearance administration'
    );
  end if;
end;
$$;

create or replace function public.appearance_require_app_access()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- coalesce so an unexpected null from has_app_access() never grants access.
  if auth.uid() is null or not coalesce(public.has_app_access(), false) then
    perform public.appearance_raise(
      'FORBIDDEN',
      'Approved app access is required to read published appearance'
    );
  end if;
end;
$$;

-- Reject control characters / line breaks (matches TypeScript APP_TITLE_UNSAFE_CHARS).
create or replace function public.appearance_text_has_unsafe_chars(p_text text)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select
    p_text is not null
    and (
      p_text ~ '[[:cntrl:]]'
      or position(chr(8232) in p_text) > 0  -- U+2028 LINE SEPARATOR
      or position(chr(8233) in p_text) > 0  -- U+2029 PARAGRAPH SEPARATOR
    );
$$;

-- Match JavaScript String.trim() whitespace (btrim alone is ASCII-space-only).
-- Includes ECMAScript WhiteSpace + LineTerminator, plus U+FEFF (ES2019+).
create or replace function public.appearance_js_trim(p_text text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case
    when p_text is null then null
    else btrim(
      p_text,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
  end;
$$;

create or replace function public.appearance_normalize_publish_label(p_label text)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_trimmed text;
begin
  if p_label is null then
    return null;
  end if;

  v_trimmed := public.appearance_js_trim(p_label);
  if v_trimmed = '' then
    return null;
  end if;

  if char_length(v_trimmed) > 120 then
    perform public.appearance_raise(
      'INVALID_LABEL',
      'Publish label must be at most 120 characters'
    );
  end if;

  if public.appearance_text_has_unsafe_chars(v_trimmed) then
    perform public.appearance_raise(
      'INVALID_LABEL',
      'Publish label must be a single line without control characters or line breaks'
    );
  end if;

  return v_trimmed;
end;
$$;

-- Exact duplicate-free permutation helper. Returns normalized text[].
create or replace function public.appearance_exact_permutation(
  p_path text,
  p_value jsonb,
  p_required text[]
)
returns text[]
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_text text;
  v_seen text[] := array[]::text[];
  v_out text[] := array[]::text[];
  v_req text;
  v_len int;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('%s must be an array', p_path)
    );
  end if;

  v_len := jsonb_array_length(p_value);
  if v_len <> coalesce(array_length(p_required, 1), 0) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format(
        '%s must contain exactly %s entries (got %s)',
        p_path,
        coalesce(array_length(p_required, 1), 0),
        v_len
      )
    );
  end if;

  for v_elem in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_elem) <> 'string' then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('%s entries must be strings', p_path)
      );
    end if;

    v_text := v_elem #>> '{}';

    if not (v_text = any (p_required)) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('%s has invalid id "%s"', p_path, v_text)
      );
    end if;

    if v_text = any (v_seen) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('%s has duplicate id "%s"', p_path, v_text)
      );
    end if;

    v_seen := array_append(v_seen, v_text);
    v_out := array_append(v_out, v_text);
  end loop;

  foreach v_req in array p_required
  loop
    if not (v_req = any (v_seen)) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('%s is missing required id "%s"', p_path, v_req)
      );
    end if;
  end loop;

  return v_out;
end;
$$;

-- Validate + rebuild clean schema-v1 JSON (unknown keys stripped; required malformed rejected).
create or replace function public.appearance_normalize_config(p_config jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_schema jsonb;
  v_schema_num numeric;
  v_branding jsonb;
  v_nav jsonb;
  v_jobs jsonb;
  v_inventory jsonb;
  v_card jsonb;
  v_theme jsonb;

  v_title text;
  v_nav_order text[];
  v_tab_order text[];
  v_default_tab text;
  v_default_view text;
  v_detail text;
  v_grid text;
  v_field_order text[];
  v_hidden jsonb;
  v_hidden_out jsonb := '[]'::jsonb;
  v_hidden_seen text[] := array[]::text[];
  v_hidden_elem jsonb;
  v_hidden_text text;
  v_action_order jsonb;
  v_more_actions jsonb;
  v_action_out text[] := array[]::text[];
  v_more_out text[] := array[]::text[];
  v_action_seen text[] := array[]::text[];
  v_slot text;
  v_elem jsonb;
  v_density text;
  v_color_preset text;
  v_type_scale text;
  v_spacing text;
  v_button text;
  v_color_scheme text;

  c_nav text[] := array['inventory', 'jobs', 'estimate'];
  c_jobs text[] := array['customers', 'holds', 'usage'];
  c_views text[] := array['list', 'category'];
  c_detail text[] := array['expand', 'modal'];
  c_grid text[] := array['one', 'two', 'three'];
  c_fields text[] := array[
    'holdStatus', 'productName', 'quantity',
    'badges', 'unitCost', 'location', 'dimensions', 'totalValue',
    'status', 'createdAt', 'notes', 'usageHistory', 'photos'
  ];
  c_required_fields text[] := array['holdStatus', 'productName', 'quantity'];
  c_optional_fields text[] := array[
    'badges', 'unitCost', 'location', 'dimensions', 'totalValue',
    'status', 'createdAt', 'notes', 'usageHistory', 'photos'
  ];
  c_slots text[] := array[
    'edit', 'use', 'hold', 'addPhotos', 'markSold', 'undoMarkSold', 'delete'
  ];
  c_density text[] := array['compact', 'comfortable', 'spacious'];
  c_presets text[] := array['systemDefault', 'slate', 'ocean'];
  c_type text[] := array['sm', 'md', 'lg'];
  c_spacing text[] := array['tight', 'normal', 'relaxed'];
  c_button text[] := array['solid', 'soft'];
  c_scheme text[] := array['system', 'light'];
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      'Configuration must be a JSON object'
    );
  end if;

  v_schema := p_config -> 'schemaVersion';
  if v_schema is null or jsonb_typeof(v_schema) <> 'number' then
    perform public.appearance_raise(
      'UNSUPPORTED_SCHEMA',
      'schemaVersion must be numeric 1'
    );
  end if;

  v_schema_num := (v_schema #>> '{}')::numeric;
  if v_schema_num <> 1 or trunc(v_schema_num) <> v_schema_num then
    perform public.appearance_raise(
      'UNSUPPORTED_SCHEMA',
      format('schemaVersion must be 1 (got %s)', v_schema #>> '{}')
    );
  end if;

  -- branding.appTitle
  v_branding := p_config -> 'branding';
  if v_branding is null or jsonb_typeof(v_branding) <> 'object' then
    perform public.appearance_raise('INVALID_CONFIG', 'branding must be an object');
  end if;

  if jsonb_typeof(v_branding -> 'appTitle') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'branding.appTitle must be a string');
  end if;

  v_title := public.appearance_js_trim(v_branding ->> 'appTitle');
  if v_title = '' then
    perform public.appearance_raise('INVALID_CONFIG', 'branding.appTitle must not be empty');
  end if;
  if char_length(v_title) > 40 then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('branding.appTitle must be at most 40 characters (got %s)', char_length(v_title))
    );
  end if;
  if public.appearance_text_has_unsafe_chars(v_title) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      'branding.appTitle must be a single line without control characters or line breaks'
    );
  end if;

  -- nav.order
  v_nav := p_config -> 'nav';
  if v_nav is null or jsonb_typeof(v_nav) <> 'object' then
    perform public.appearance_raise('INVALID_CONFIG', 'nav must be an object');
  end if;
  v_nav_order := public.appearance_exact_permutation('nav.order', v_nav -> 'order', c_nav);

  -- jobs
  v_jobs := p_config -> 'jobs';
  if v_jobs is null or jsonb_typeof(v_jobs) <> 'object' then
    perform public.appearance_raise('INVALID_CONFIG', 'jobs must be an object');
  end if;
  v_tab_order := public.appearance_exact_permutation(
    'jobs.tabOrder',
    v_jobs -> 'tabOrder',
    c_jobs
  );
  if jsonb_typeof(v_jobs -> 'defaultTab') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'jobs.defaultTab must be a string');
  end if;
  v_default_tab := v_jobs ->> 'defaultTab';
  if not (v_default_tab = any (c_jobs)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('jobs.defaultTab is invalid ("%s")', v_default_tab)
    );
  end if;

  -- inventory
  v_inventory := p_config -> 'inventory';
  if v_inventory is null or jsonb_typeof(v_inventory) <> 'object' then
    perform public.appearance_raise('INVALID_CONFIG', 'inventory must be an object');
  end if;

  if jsonb_typeof(v_inventory -> 'defaultView') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'inventory.defaultView must be a string');
  end if;
  v_default_view := v_inventory ->> 'defaultView';
  if not (v_default_view = any (c_views)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('inventory.defaultView is invalid ("%s")', v_default_view)
    );
  end if;

  if jsonb_typeof(v_inventory -> 'detailPresentation') is distinct from 'string' then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      'inventory.detailPresentation must be a string'
    );
  end if;
  v_detail := v_inventory ->> 'detailPresentation';
  if not (v_detail = any (c_detail)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('inventory.detailPresentation is invalid ("%s")', v_detail)
    );
  end if;

  if jsonb_typeof(v_inventory -> 'gridColumns') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'inventory.gridColumns must be a string');
  end if;
  v_grid := v_inventory ->> 'gridColumns';
  if not (v_grid = any (c_grid)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('inventory.gridColumns is invalid ("%s")', v_grid)
    );
  end if;

  v_card := v_inventory -> 'card';
  if v_card is null or jsonb_typeof(v_card) <> 'object' then
    perform public.appearance_raise('INVALID_CONFIG', 'inventory.card must be an object');
  end if;

  v_field_order := public.appearance_exact_permutation(
    'inventory.card.fieldOrder',
    v_card -> 'fieldOrder',
    c_fields
  );

  -- hiddenFields: unique subset of optional fields only
  v_hidden := v_card -> 'hiddenFields';
  if v_hidden is null or jsonb_typeof(v_hidden) <> 'array' then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      'inventory.card.hiddenFields must be an array'
    );
  end if;

  for v_hidden_elem in select value from jsonb_array_elements(v_hidden)
  loop
    if jsonb_typeof(v_hidden_elem) <> 'string' then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        'inventory.card.hiddenFields entries must be strings'
      );
    end if;
    v_hidden_text := v_hidden_elem #>> '{}';

    if v_hidden_text = any (c_required_fields) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('Required field "%s" cannot be hidden', v_hidden_text)
      );
    end if;

    if not (v_hidden_text = any (c_optional_fields)) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('Unknown or non-hideable field "%s"', v_hidden_text)
      );
    end if;

    if v_hidden_text = any (v_hidden_seen) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('Duplicate hidden field "%s"', v_hidden_text)
      );
    end if;

    v_hidden_seen := array_append(v_hidden_seen, v_hidden_text);
    v_hidden_out := v_hidden_out || jsonb_build_array(v_hidden_text);
  end loop;

  -- actionOrder + moreActions: disjoint, cover every configurable slot exactly once
  v_action_order := v_card -> 'actionOrder';
  v_more_actions := v_card -> 'moreActions';
  if v_action_order is null or jsonb_typeof(v_action_order) <> 'array' then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      'inventory.card.actionOrder must be an array'
    );
  end if;
  if v_more_actions is null or jsonb_typeof(v_more_actions) <> 'array' then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      'inventory.card.moreActions must be an array'
    );
  end if;

  for v_elem in select value from jsonb_array_elements(v_action_order)
  loop
    if jsonb_typeof(v_elem) <> 'string' then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        'inventory.card.actionOrder entries must be strings'
      );
    end if;
    v_slot := v_elem #>> '{}';
    if not (v_slot = any (c_slots)) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('Invalid action slot "%s" in actionOrder', v_slot)
      );
    end if;
    if v_slot = any (v_action_seen) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('Duplicate action slot "%s"', v_slot)
      );
    end if;
    v_action_seen := array_append(v_action_seen, v_slot);
    v_action_out := array_append(v_action_out, v_slot);
  end loop;

  for v_elem in select value from jsonb_array_elements(v_more_actions)
  loop
    if jsonb_typeof(v_elem) <> 'string' then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        'inventory.card.moreActions entries must be strings'
      );
    end if;
    v_slot := v_elem #>> '{}';
    if not (v_slot = any (c_slots)) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('Invalid action slot "%s" in moreActions', v_slot)
      );
    end if;
    if v_slot = any (v_action_seen) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format('Duplicate action slot "%s" (actionOrder and moreActions must be disjoint)', v_slot)
      );
    end if;
    v_action_seen := array_append(v_action_seen, v_slot);
    v_more_out := array_append(v_more_out, v_slot);
  end loop;

  foreach v_slot in array c_slots
  loop
    if not (v_slot = any (v_action_seen)) then
      perform public.appearance_raise(
        'INVALID_CONFIG',
        format(
          'Missing action slot "%s" — every slot must appear exactly once across actionOrder and moreActions',
          v_slot
        )
      );
    end if;
  end loop;

  if coalesce(array_length(v_action_seen, 1), 0) <> coalesce(array_length(c_slots, 1), 0) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      'actionOrder and moreActions must contain each configurable action slot exactly once'
    );
  end if;

  -- density
  if jsonb_typeof(p_config -> 'density') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'density must be a string');
  end if;
  v_density := p_config ->> 'density';
  if not (v_density = any (c_density)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('density is invalid ("%s")', v_density)
    );
  end if;

  -- theme
  v_theme := p_config -> 'theme';
  if v_theme is null or jsonb_typeof(v_theme) <> 'object' then
    perform public.appearance_raise('INVALID_CONFIG', 'theme must be an object');
  end if;

  if jsonb_typeof(v_theme -> 'colorPreset') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'theme.colorPreset must be a string');
  end if;
  v_color_preset := v_theme ->> 'colorPreset';
  if not (v_color_preset = any (c_presets)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('theme.colorPreset is invalid ("%s")', v_color_preset)
    );
  end if;

  if jsonb_typeof(v_theme -> 'typeScale') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'theme.typeScale must be a string');
  end if;
  v_type_scale := v_theme ->> 'typeScale';
  if not (v_type_scale = any (c_type)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('theme.typeScale is invalid ("%s")', v_type_scale)
    );
  end if;

  if jsonb_typeof(v_theme -> 'spacingPreset') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'theme.spacingPreset must be a string');
  end if;
  v_spacing := v_theme ->> 'spacingPreset';
  if not (v_spacing = any (c_spacing)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('theme.spacingPreset is invalid ("%s")', v_spacing)
    );
  end if;

  if jsonb_typeof(v_theme -> 'buttonStyle') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'theme.buttonStyle must be a string');
  end if;
  v_button := v_theme ->> 'buttonStyle';
  if not (v_button = any (c_button)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('theme.buttonStyle is invalid ("%s")', v_button)
    );
  end if;

  if jsonb_typeof(v_theme -> 'colorScheme') is distinct from 'string' then
    perform public.appearance_raise('INVALID_CONFIG', 'theme.colorScheme must be a string');
  end if;
  v_color_scheme := v_theme ->> 'colorScheme';
  if not (v_color_scheme = any (c_scheme)) then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('theme.colorScheme is invalid ("%s")', v_color_scheme)
    );
  end if;

  -- Rebuild recognized schema-v1 keys only (unknown keys stripped).
  return jsonb_build_object(
    'schemaVersion', 1,
    'branding', jsonb_build_object('appTitle', v_title),
    'nav', jsonb_build_object('order', to_jsonb(v_nav_order)),
    'jobs', jsonb_build_object(
      'tabOrder', to_jsonb(v_tab_order),
      'defaultTab', v_default_tab
    ),
    'inventory', jsonb_build_object(
      'defaultView', v_default_view,
      'detailPresentation', v_detail,
      'gridColumns', v_grid,
      'card', jsonb_build_object(
        'fieldOrder', to_jsonb(v_field_order),
        'hiddenFields', v_hidden_out,
        'actionOrder', to_jsonb(v_action_out),
        'moreActions', to_jsonb(v_more_out)
      )
    ),
    'density', v_density,
    'theme', jsonb_build_object(
      'colorPreset', v_color_preset,
      'typeScale', v_type_scale,
      'spacingPreset', v_spacing,
      'buttonStyle', v_button,
      'colorScheme', v_color_scheme
    )
  );
end;
$$;

-- Block public-API mutation of immutable version rows (defense in depth).
create or replace function public.appearance_prevent_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.appearance_raise(
    'FORBIDDEN',
    'appearance_versions rows are immutable'
  );
  return null;
end;
$$;

drop trigger if exists appearance_versions_immutable on public.appearance_versions;
create trigger appearance_versions_immutable
  before update or delete on public.appearance_versions
  for each row
  execute function public.appearance_prevent_version_mutation();

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- 1) Published config for approved app users (empty set when unpublished).
--    Always normalize stored JSON on read so corrupt/manual rows raise stably
--    (client retains compiled defaults) instead of returning invalid config.
create or replace function public.get_published_appearance()
returns table (
  config jsonb,
  version_id uuid,
  version_number bigint,
  config_schema_version integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.appearance_settings%rowtype;
  v_version public.appearance_versions%rowtype;
  v_normalized jsonb;
begin
  perform public.appearance_require_app_access();

  select * into v_settings
  from public.appearance_settings
  where id = 'global';

  if not found then
    perform public.appearance_raise(
      'SETTINGS_NOT_FOUND',
      'Appearance settings singleton is missing'
    );
  end if;

  if v_settings.published_version_id is null then
    return;
  end if;

  select * into v_version
  from public.appearance_versions v
  where v.id = v_settings.published_version_id;

  if not found then
    perform public.appearance_raise(
      'VERSION_NOT_FOUND',
      'Published appearance version was not found'
    );
  end if;

  if v_version.config_schema_version is distinct from 1 then
    perform public.appearance_raise(
      'UNSUPPORTED_SCHEMA',
      format(
        'Published appearance config_schema_version must be 1 (got %s)',
        v_version.config_schema_version
      )
    );
  end if;

  -- Raises APPEARANCE:UNSUPPORTED_SCHEMA / INVALID_CONFIG on incompatible data.
  v_normalized := public.appearance_normalize_config(v_version.config);

  config := v_normalized;
  version_id := v_version.id;
  version_number := v_version.version_number;
  config_schema_version := 1;
  return next;
end;
$$;

-- 2) Caller's private draft only (empty set when none).
create or replace function public.get_appearance_draft()
returns table (
  id uuid,
  config jsonb,
  config_schema_version integer,
  updated_at timestamptz,
  restored_from_version_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.appearance_require_admin();

  return query
  select
    d.id,
    d.config,
    d.config_schema_version,
    d.updated_at,
    d.restored_from_version_id
  from public.appearance_drafts d
  where d.admin_user_id = auth.uid();
end;
$$;

-- 3) Upsert caller's draft; clears restored-version marker.
create or replace function public.upsert_appearance_draft(p_config jsonb)
returns table (
  id uuid,
  config jsonb,
  config_schema_version integer,
  updated_at timestamptz,
  restored_from_version_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized jsonb;
  v_now timestamptz := now();
begin
  perform public.appearance_require_admin();
  v_normalized := public.appearance_normalize_config(p_config);

  return query
  insert into public.appearance_drafts as d (
    admin_user_id,
    config,
    config_schema_version,
    updated_at,
    restored_from_version_id
  )
  values (
    auth.uid(),
    v_normalized,
    1,
    v_now,
    null
  )
  on conflict (admin_user_id) do update
    set
      config = excluded.config,
      config_schema_version = 1,
      updated_at = excluded.updated_at,
      restored_from_version_id = null
  returning
    d.id,
    d.config,
    d.config_schema_version,
    d.updated_at,
    d.restored_from_version_id;
end;
$$;

-- 4) Delete caller's draft only (TypeScript defaults remain editor fallback).
create or replace function public.reset_appearance_draft()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.appearance_require_admin();

  delete from public.appearance_drafts
  where admin_user_id = auth.uid();
end;
$$;

-- 5) Admin version history (newest first); includes config.
create or replace function public.list_appearance_versions()
returns table (
  id uuid,
  version_number bigint,
  label text,
  config jsonb,
  config_schema_version integer,
  created_by uuid,
  created_at timestamptz,
  source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.appearance_require_admin();

  return query
  select
    v.id,
    v.version_number,
    v.label,
    v.config,
    v.config_schema_version,
    v.created_by,
    v.created_at,
    v.source
  from public.appearance_versions v
  order by v.version_number desc;
end;
$$;

-- 6) Copy a version into the caller's draft; record restore marker (no publish).
create or replace function public.restore_appearance_version_to_draft(p_version_id uuid)
returns table (
  id uuid,
  config jsonb,
  config_schema_version integer,
  updated_at timestamptz,
  restored_from_version_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.appearance_versions%rowtype;
  v_normalized jsonb;
  v_now timestamptz := now();
begin
  perform public.appearance_require_admin();

  if p_version_id is null then
    perform public.appearance_raise('VERSION_NOT_FOUND', 'Appearance version not found');
  end if;

  select * into v_version
  from public.appearance_versions
  where id = p_version_id;

  if not found then
    perform public.appearance_raise('VERSION_NOT_FOUND', 'Appearance version not found');
  end if;

  -- Re-validate stored config before restoring (guards against legacy/corrupt rows).
  v_normalized := public.appearance_normalize_config(v_version.config);

  return query
  insert into public.appearance_drafts as d (
    admin_user_id,
    config,
    config_schema_version,
    updated_at,
    restored_from_version_id
  )
  values (
    auth.uid(),
    v_normalized,
    1,
    v_now,
    v_version.id
  )
  on conflict (admin_user_id) do update
    set
      config = excluded.config,
      config_schema_version = 1,
      updated_at = excluded.updated_at,
      restored_from_version_id = excluded.restored_from_version_id
  returning
    d.id,
    d.config,
    d.config_schema_version,
    d.updated_at,
    d.restored_from_version_id;
end;
$$;

-- 7) Publish caller's draft; serialize via singleton FOR UPDATE.
create or replace function public.publish_appearance_draft(p_label text default null)
returns table (
  version_id uuid,
  version_number bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_label text;
  v_draft public.appearance_drafts%rowtype;
  v_settings public.appearance_settings%rowtype;
  v_normalized jsonb;
  v_next bigint;
  v_source text;
  v_new_id uuid;
  v_now timestamptz := now();
begin
  perform public.appearance_require_admin();
  v_label := public.appearance_normalize_publish_label(p_label);

  select * into v_draft
  from public.appearance_drafts
  where admin_user_id = v_admin
  for update;

  if not found then
    perform public.appearance_raise(
      'DRAFT_NOT_FOUND',
      'No appearance draft exists for the current admin'
    );
  end if;

  v_normalized := public.appearance_normalize_config(v_draft.config);

  if v_draft.restored_from_version_id is not null then
    v_source := 'restore_publish';
  else
    v_source := 'publish';
  end if;

  -- Serialize publishers and allocate version_number only after the lock.
  select * into v_settings
  from public.appearance_settings
  where id = 'global'
  for update;

  if not found then
    perform public.appearance_raise(
      'SETTINGS_NOT_FOUND',
      'Appearance settings singleton is missing'
    );
  end if;

  select coalesce(max(v.version_number), 0) + 1
  into v_next
  from public.appearance_versions v;

  insert into public.appearance_versions (
    version_number,
    label,
    config,
    config_schema_version,
    created_by,
    created_at,
    source
  )
  values (
    v_next,
    v_label,
    v_normalized,
    1,
    v_admin,
    v_now,
    v_source
  )
  returning id into v_new_id;

  update public.appearance_settings
  set
    published_version_id = v_new_id,
    updated_at = v_now,
    updated_by = v_admin
  where id = 'global';

  update public.appearance_drafts
  set
    restored_from_version_id = null,
    updated_at = v_now,
    config = v_normalized,
    config_schema_version = 1
  where id = v_draft.id;

  version_id := v_new_id;
  version_number := v_next;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: revoke helpers; grant only the seven public RPCs to authenticated
-- ---------------------------------------------------------------------------

-- Private helpers / trigger fn
revoke all on function public.appearance_raise(text, text) from public;
revoke all on function public.appearance_raise(text, text) from anon;
revoke all on function public.appearance_raise(text, text) from authenticated;

revoke all on function public.appearance_require_admin() from public;
revoke all on function public.appearance_require_admin() from anon;
revoke all on function public.appearance_require_admin() from authenticated;

revoke all on function public.appearance_require_app_access() from public;
revoke all on function public.appearance_require_app_access() from anon;
revoke all on function public.appearance_require_app_access() from authenticated;

revoke all on function public.appearance_text_has_unsafe_chars(text) from public;
revoke all on function public.appearance_text_has_unsafe_chars(text) from anon;
revoke all on function public.appearance_text_has_unsafe_chars(text) from authenticated;

revoke all on function public.appearance_js_trim(text) from public;
revoke all on function public.appearance_js_trim(text) from anon;
revoke all on function public.appearance_js_trim(text) from authenticated;

revoke all on function public.appearance_normalize_publish_label(text) from public;
revoke all on function public.appearance_normalize_publish_label(text) from anon;
revoke all on function public.appearance_normalize_publish_label(text) from authenticated;

revoke all on function public.appearance_exact_permutation(text, jsonb, text[]) from public;
revoke all on function public.appearance_exact_permutation(text, jsonb, text[]) from anon;
revoke all on function public.appearance_exact_permutation(text, jsonb, text[]) from authenticated;

revoke all on function public.appearance_normalize_config(jsonb) from public;
revoke all on function public.appearance_normalize_config(jsonb) from anon;
revoke all on function public.appearance_normalize_config(jsonb) from authenticated;

revoke all on function public.appearance_prevent_version_mutation() from public;
revoke all on function public.appearance_prevent_version_mutation() from anon;
revoke all on function public.appearance_prevent_version_mutation() from authenticated;

-- Public RPCs: revoke PUBLIC/anon/authenticated, then grant execute to authenticated only
revoke all on function public.get_published_appearance() from public;
revoke all on function public.get_published_appearance() from anon;
revoke all on function public.get_published_appearance() from authenticated;
grant execute on function public.get_published_appearance() to authenticated;

revoke all on function public.get_appearance_draft() from public;
revoke all on function public.get_appearance_draft() from anon;
revoke all on function public.get_appearance_draft() from authenticated;
grant execute on function public.get_appearance_draft() to authenticated;

revoke all on function public.upsert_appearance_draft(jsonb) from public;
revoke all on function public.upsert_appearance_draft(jsonb) from anon;
revoke all on function public.upsert_appearance_draft(jsonb) from authenticated;
grant execute on function public.upsert_appearance_draft(jsonb) to authenticated;

revoke all on function public.reset_appearance_draft() from public;
revoke all on function public.reset_appearance_draft() from anon;
revoke all on function public.reset_appearance_draft() from authenticated;
grant execute on function public.reset_appearance_draft() to authenticated;

revoke all on function public.list_appearance_versions() from public;
revoke all on function public.list_appearance_versions() from anon;
revoke all on function public.list_appearance_versions() from authenticated;
grant execute on function public.list_appearance_versions() to authenticated;

revoke all on function public.restore_appearance_version_to_draft(uuid) from public;
revoke all on function public.restore_appearance_version_to_draft(uuid) from anon;
revoke all on function public.restore_appearance_version_to_draft(uuid) from authenticated;
grant execute on function public.restore_appearance_version_to_draft(uuid) to authenticated;

revoke all on function public.publish_appearance_draft(text) from public;
revoke all on function public.publish_appearance_draft(text) from anon;
revoke all on function public.publish_appearance_draft(text) from authenticated;
grant execute on function public.publish_appearance_draft(text) to authenticated;

commit;

-- =============================================================================
-- Static inspection notes (signatures / grants) — review checklist companion
-- (Outside the migration transaction; documentation only.)
-- =============================================================================
--
-- TABLES
--   public.appearance_versions
--     version_number bigint; created_by ON DELETE RESTRICT; config object+schema v1 checks
--   public.appearance_drafts
--     admin_user_id ON DELETE CASCADE; restored_from_version_id ON DELETE RESTRICT;
--     config object+schema v1 checks
--   public.appearance_settings  (singleton id='global', no seed version/config)
--     published_version_id ON DELETE RESTRICT; updated_by ON DELETE SET NULL
--
-- PRIVATE HELPERS (REVOKE from PUBLIC/anon/authenticated)
--   appearance_raise(text, text)
--   appearance_require_admin()
--   appearance_require_app_access()
--   appearance_text_has_unsafe_chars(text)
--   appearance_js_trim(text)
--   appearance_normalize_publish_label(text)
--   appearance_exact_permutation(text, jsonb, text[])
--   appearance_normalize_config(jsonb)
--   appearance_prevent_version_mutation()  -- trigger
--
-- PUBLIC RPCs (REVOKE all three roles, then GRANT execute TO authenticated only)
--   get_published_appearance()
--     → table(config jsonb, version_id uuid, version_number bigint, config_schema_version int)
--     normalizes stored config on read; empty set when unpublished
--   get_appearance_draft()
--     → table(id uuid, config jsonb, config_schema_version int, updated_at timestamptz,
--             restored_from_version_id uuid)
--   upsert_appearance_draft(p_config jsonb)
--     → same draft table shape; clears restored_from_version_id
--   reset_appearance_draft()
--     → void
--   list_appearance_versions()
--     → table(id, version_number bigint, label, config, config_schema_version, created_by,
--             created_at, source) order by version_number desc
--   restore_appearance_version_to_draft(p_version_id uuid)
--     → draft table shape; sets restored_from_version_id
--   publish_appearance_draft(p_label text default null)
--     → table(version_id uuid, version_number bigint)
--
-- SECURITY MODEL
--   - Single top-level BEGIN/COMMIT around executable DDL/DML
--   - CREATE TABLE without IF NOT EXISTS (fail on schema collision)
--   - RLS on; no policies; table privileges revoked from PUBLIC/anon/authenticated
--   - All access via SECURITY DEFINER RPCs with fixed search_path = public
--   - Admin gates: coalesce(public.is_admin(), false) (helper not redefined)
--   - Published reads: coalesce(public.has_app_access(), false) (helper not redefined)
--   - Version immutability: no update/delete RPCs + BEFORE UPDATE OR DELETE trigger
--   - Publish concurrency: SELECT appearance_settings FOR UPDATE before max(version)+1
--
-- NOT EXECUTABLE-TESTED LOCALLY
--   This file was not applied to Supabase. Permission, isolation, validation,
--   JS-trim parity, and concurrent-publish behavior require a review-environment
--   apply + checklist above.
-- =============================================================================
