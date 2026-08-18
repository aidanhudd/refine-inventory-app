-- =============================================================================
-- P3.1 — Optional Estimate navigation (APPROVED ADDITIVE MIGRATION)
-- =============================================================================
--
-- STATUS: Approved Phase 3.1 additive migration.
--   - Do not edit the already-applied immutable migration:
--     supabase/migrations/20260817200213_appearance_settings.sql
--   - Once applied, never edit this file; future corrections require a new migration.
--
-- PURPOSE
--   Make config.nav.order accept Inventory + Jobs required once, with Estimate
--   optional (zero or one). Existing three-item Version 1 configs remain valid.
--   No draft/published rows are rewritten. schemaVersion stays 1.
--
-- ROLLOUT NOTES (REQUIRED ORDER)
--   1. Apply this migration BEFORE deploying the optional-Estimate Appearance UI.
--   2. Existing production behavior remains unchanged after apply alone:
--      published three-item nav.order (including Estimate) still validates and
--      continues to show Estimate until an admin publishes a two-item order.
--   3. Do NOT publish a two-item nav configuration until BOTH this migration and
--      the updated client (optional-Estimate checkbox / validators) are deployed.
--   4. After both are live, hiding Estimate is editor + Save Draft + Publish only.
--
-- SCOPE (this file only)
--   - ADD private helper: appearance_nav_order_normalize(text, jsonb)
--   - REPLACE appearance_normalize_config(jsonb): nav.order call site only
--   - Reassert private EXECUTE revokes for the new helper and normalize_config
--   - No table/RLS/RPC signature/grant/default/data changes
--
-- STATIC VALIDATION CASES (nav.order)
--   Accepted:
--     ["inventory","jobs","estimate"]
--     ["jobs","inventory"]
--     ["inventory","estimate","jobs"]
--   Rejected:
--     ["inventory"]
--     ["inventory","jobs","estimate","estimate"]
--     ["inventory","jobs","admin"]
--     []
--     non-array values
--     arrays containing non-string values
--
-- =============================================================================
begin;

-- Nav order: inventory + jobs required once; estimate optional (0 or 1).
-- Allowlisted ids only; original valid order preserved. Length must be 2 or 3.
-- With unique allowlisted ids, length 2 ⇒ estimate absent; length 3 ⇒ estimate once.
create or replace function public.appearance_nav_order_normalize(
  p_path text,
  p_value jsonb
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
  v_len int;
  v_allowed text[] := array['inventory', 'jobs', 'estimate'];
  v_required text[] := array['inventory', 'jobs'];
  v_req text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('%s must be an array', p_path)
    );
  end if;

  v_len := jsonb_array_length(p_value);
  if v_len <> 2 and v_len <> 3 then
    perform public.appearance_raise(
      'INVALID_CONFIG',
      format('%s must contain exactly 2 or 3 entries (got %s)', p_path, v_len)
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

    if not (v_text = any (v_allowed)) then
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

  foreach v_req in array v_required
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
  v_nav_order := public.appearance_nav_order_normalize('nav.order', v_nav -> 'order');

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

-- Private helpers: revoke direct execution (SECURITY DEFINER + fixed search_path
-- already set on CREATE). Authenticated clients reach appearance data only via
-- the existing public RPCs from 20260817200213_appearance_settings.sql.
revoke all on function public.appearance_nav_order_normalize(text, jsonb) from public;
revoke all on function public.appearance_nav_order_normalize(text, jsonb) from anon;
revoke all on function public.appearance_nav_order_normalize(text, jsonb) from authenticated;

revoke all on function public.appearance_normalize_config(jsonb) from public;
revoke all on function public.appearance_normalize_config(jsonb) from anon;
revoke all on function public.appearance_normalize_config(jsonb) from authenticated;

commit;

-- =============================================================================
-- Static inspection notes — review companion (not executable)
-- =============================================================================
--
-- NEW PRIVATE HELPER
--   appearance_nav_order_normalize(text, jsonb) → text[]
--     SECURITY DEFINER; search_path = public; IMMUTABLE
--     REVOKE ALL from PUBLIC / anon / authenticated
--
-- REPLACED PRIVATE HELPER
--   appearance_normalize_config(jsonb) → jsonb
--     Same signature/security; nav.order uses appearance_nav_order_normalize
--     Jobs tabs, inventory fieldOrder, and other exact-permutation paths unchanged
--     REVOKE ALL from PUBLIC / anon / authenticated (reasserted)
--
-- UNCHANGED
--   appearance_exact_permutation (still used for jobs.tabOrder / fieldOrder)
--   All seven public Appearance RPCs, tables, RLS, grants, schemaVersion 1
--   Stored drafts / published versions (no UPDATE)
-- =============================================================================
