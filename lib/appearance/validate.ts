import { DEFAULT_APPEARANCE_CONFIG, cloneAppearanceConfig } from "./defaults"
import {
  APPEARANCE_SCHEMA_VERSION,
  APPEARANCE_V1_KNOWN_TOP_LEVEL_KEYS,
  APP_TITLE_MAX_LENGTH,
  BUTTON_STYLE_IDS,
  COLOR_SCHEME_PREFERENCES,
  DENSITY_PRESETS,
  DETAIL_PRESENTATIONS,
  GRID_COLUMNS_PRESETS,
  INVENTORY_ACTION_SLOT_IDS,
  INVENTORY_CARD_FIELD_IDS,
  INVENTORY_VIEW_MODES,
  JOBS_VIEW_MODES,
  NAV_ITEM_IDS,
  OPTIONAL_INVENTORY_CARD_FIELDS,
  REQUIRED_INVENTORY_CARD_FIELDS,
  REQUIRED_NAV_ITEM_IDS,
  SPACING_PRESET_IDS,
  THEME_PRESET_IDS,
  TYPE_SCALE_IDS,
  type AppearanceConfig,
  type InventoryActionSlotId,
  type InventoryCardFieldId,
  type JobsViewMode,
  type NavItemId,
  type OptionalInventoryCardFieldId,
} from "./types"

export type AppearanceValidationIssue = {
  path: string
  message: string
}

export type AppearanceStrictValidationResult =
  | { ok: true; config: AppearanceConfig }
  | { ok: false; errors: AppearanceValidationIssue[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter((key) => !allowed.includes(key))
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
}

function validateExactPermutation<T extends string>(
  path: string,
  value: unknown,
  required: readonly T[],
  errors: AppearanceValidationIssue[],
): T[] | null {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "Must be an array." })
    return null
  }

  if (value.length !== required.length) {
    errors.push({
      path,
      message: `Must contain exactly ${required.length} entries (got ${value.length}).`,
    })
  }

  const seen = new Set<string>()
  const out: T[] = []

  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i]
    const entryPath = `${path}[${i}]`
    if (!isOneOf(entry, required)) {
      errors.push({
        path: entryPath,
        message: `Invalid id "${String(entry)}". Allowed: ${required.join(", ")}.`,
      })
      continue
    }
    if (seen.has(entry)) {
      errors.push({ path: entryPath, message: `Duplicate id "${entry}".` })
      continue
    }
    seen.add(entry)
    out.push(entry)
  }

  for (const id of required) {
    if (!seen.has(id)) {
      errors.push({ path, message: `Missing required id "${id}".` })
    }
  }

  if (out.length !== required.length || seen.size !== required.length) {
    return null
  }

  return out
}

/**
 * Nav order: inventory + jobs required once; estimate optional (0 or 1).
 * Allowlisted ids only; original valid order preserved. Length must be 2 or 3.
 */
function validateNavOrder(
  path: string,
  value: unknown,
  errors: AppearanceValidationIssue[],
): NavItemId[] | null {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "Must be an array." })
    return null
  }

  if (value.length !== 2 && value.length !== 3) {
    errors.push({
      path,
      message: `Must contain exactly 2 or 3 entries (got ${value.length}).`,
    })
  }

  const seen = new Set<string>()
  const out: NavItemId[] = []

  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i]
    const entryPath = `${path}[${i}]`
    if (!isOneOf(entry, NAV_ITEM_IDS)) {
      errors.push({
        path: entryPath,
        message: `Invalid id "${String(entry)}". Allowed: ${NAV_ITEM_IDS.join(", ")}.`,
      })
      continue
    }
    if (seen.has(entry)) {
      errors.push({ path: entryPath, message: `Duplicate id "${entry}".` })
      continue
    }
    seen.add(entry)
    out.push(entry)
  }

  for (const id of REQUIRED_NAV_ITEM_IDS) {
    if (!seen.has(id)) {
      errors.push({ path, message: `Missing required id "${id}".` })
    }
  }

  const lengthOk = value.length === 2 || value.length === 3
  const requiredOk = REQUIRED_NAV_ITEM_IDS.every((id) => seen.has(id))
  const allEntriesValid = out.length === value.length && seen.size === out.length

  if (!lengthOk || !requiredOk || !allEntriesValid) {
    return null
  }

  return out
}

function validateActionPartitions(
  actionOrderRaw: unknown,
  moreActionsRaw: unknown,
  errors: AppearanceValidationIssue[],
): { actionOrder: InventoryActionSlotId[]; moreActions: InventoryActionSlotId[] } | null {
  const actionPath = "inventory.card.actionOrder"
  const morePath = "inventory.card.moreActions"

  if (!Array.isArray(actionOrderRaw)) {
    errors.push({ path: actionPath, message: "Must be an array." })
  }
  if (!Array.isArray(moreActionsRaw)) {
    errors.push({ path: morePath, message: "Must be an array." })
  }
  if (!Array.isArray(actionOrderRaw) || !Array.isArray(moreActionsRaw)) {
    return null
  }

  const actionOrder: InventoryActionSlotId[] = []
  const moreActions: InventoryActionSlotId[] = []
  const seen = new Set<string>()

  const consume = (
    path: string,
    values: unknown[],
    target: InventoryActionSlotId[],
  ) => {
    for (let i = 0; i < values.length; i += 1) {
      const entry = values[i]
      const entryPath = `${path}[${i}]`
      if (!isOneOf(entry, INVENTORY_ACTION_SLOT_IDS)) {
        errors.push({
          path: entryPath,
          message: `Invalid action slot "${String(entry)}". Allowed: ${INVENTORY_ACTION_SLOT_IDS.join(", ")}.`,
        })
        continue
      }
      if (seen.has(entry)) {
        errors.push({
          path: entryPath,
          message: `Duplicate action slot "${entry}" (actionOrder and moreActions must be disjoint).`,
        })
        continue
      }
      seen.add(entry)
      target.push(entry)
    }
  }

  consume(actionPath, actionOrderRaw, actionOrder)
  consume(morePath, moreActionsRaw, moreActions)

  for (const id of INVENTORY_ACTION_SLOT_IDS) {
    if (!seen.has(id)) {
      errors.push({
        path: "inventory.card",
        message: `Missing action slot "${id}" — every slot must appear exactly once across actionOrder and moreActions.`,
      })
    }
  }

  if (seen.size !== INVENTORY_ACTION_SLOT_IDS.length) {
    return null
  }
  if (actionOrder.length + moreActions.length !== INVENTORY_ACTION_SLOT_IDS.length) {
    return null
  }

  return { actionOrder, moreActions }
}

function validateHiddenFields(
  hiddenRaw: unknown,
  errors: AppearanceValidationIssue[],
): OptionalInventoryCardFieldId[] | null {
  const path = "inventory.card.hiddenFields"
  if (!Array.isArray(hiddenRaw)) {
    errors.push({ path, message: "Must be an array." })
    return null
  }

  const requiredSet = new Set<string>(REQUIRED_INVENTORY_CARD_FIELDS)
  const seen = new Set<string>()
  const out: OptionalInventoryCardFieldId[] = []
  let ok = true

  for (let i = 0; i < hiddenRaw.length; i += 1) {
    const entry = hiddenRaw[i]
    const entryPath = `${path}[${i}]`
    if (typeof entry !== "string") {
      errors.push({ path: entryPath, message: "Must be a field id string." })
      ok = false
      continue
    }
    if (requiredSet.has(entry)) {
      errors.push({
        path: entryPath,
        message: `Required field "${entry}" cannot be hidden.`,
      })
      ok = false
      continue
    }
    if (!isOneOf(entry, OPTIONAL_INVENTORY_CARD_FIELDS)) {
      errors.push({
        path: entryPath,
        message: `Unknown or non-hideable field "${entry}".`,
      })
      ok = false
      continue
    }
    if (seen.has(entry)) {
      errors.push({ path: entryPath, message: `Duplicate hidden field "${entry}".` })
      ok = false
      continue
    }
    seen.add(entry)
    out.push(entry)
  }

  return ok ? out : null
}

/** Control chars / line breaks that must not appear in a single-line header title. */
const APP_TITLE_UNSAFE_CHARS = /[\u0000-\u001F\u007F\u2028\u2029]/

/**
 * Trim, reject empty / overlong / unsafe titles, and return the normalized title.
 * Callers keep React text escaping — this never interprets HTML.
 */
function normalizeAppTitle(
  title: unknown,
  errors: AppearanceValidationIssue[],
): string | null {
  const path = "branding.appTitle"
  if (typeof title !== "string") {
    errors.push({ path, message: "Must be a string." })
    return null
  }

  const trimmed = title.trim()
  if (trimmed.length === 0) {
    errors.push({ path, message: "Must not be empty." })
    return null
  }
  if (trimmed.length > APP_TITLE_MAX_LENGTH) {
    errors.push({
      path,
      message: `Must be at most ${APP_TITLE_MAX_LENGTH} characters (got ${trimmed.length}).`,
    })
    return null
  }
  if (APP_TITLE_UNSAFE_CHARS.test(trimmed)) {
    errors.push({
      path,
      message: "Must be a single line without control characters or line breaks.",
    })
    return null
  }

  return trimmed
}

/**
 * Strict validation for draft saving and editor feedback.
 * Unknown keys are rejected. Successful results return a clean config object.
 */
export function validateAppearanceConfigStrict(
  input: unknown,
): AppearanceStrictValidationResult {
  const errors: AppearanceValidationIssue[] = []

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Configuration must be a plain object." }],
    }
  }

  for (const key of unknownKeys(input, APPEARANCE_V1_KNOWN_TOP_LEVEL_KEYS)) {
    errors.push({ path: key, message: `Unknown key "${key}" is not allowed.` })
  }

  if (input.schemaVersion !== APPEARANCE_SCHEMA_VERSION) {
    errors.push({
      path: "schemaVersion",
      message: `Must be ${APPEARANCE_SCHEMA_VERSION} (got ${String(input.schemaVersion)}).`,
    })
  }

  // branding
  let appTitle: string | null = null
  if (!isPlainObject(input.branding)) {
    errors.push({ path: "branding", message: "Must be an object." })
  } else {
    for (const key of unknownKeys(input.branding, ["appTitle"])) {
      errors.push({ path: `branding.${key}`, message: `Unknown key "${key}" is not allowed.` })
    }
    appTitle = normalizeAppTitle(input.branding.appTitle, errors)
  }

  // nav
  let navOrder: NavItemId[] | null = null
  if (!isPlainObject(input.nav)) {
    errors.push({ path: "nav", message: "Must be an object." })
  } else {
    for (const key of unknownKeys(input.nav, ["order"])) {
      errors.push({ path: `nav.${key}`, message: `Unknown key "${key}" is not allowed.` })
    }
    navOrder = validateNavOrder("nav.order", input.nav.order, errors)
  }

  // jobs
  let tabOrder: JobsViewMode[] | null = null
  let defaultTab: JobsViewMode | null = null
  if (!isPlainObject(input.jobs)) {
    errors.push({ path: "jobs", message: "Must be an object." })
  } else {
    for (const key of unknownKeys(input.jobs, ["tabOrder", "defaultTab"])) {
      errors.push({ path: `jobs.${key}`, message: `Unknown key "${key}" is not allowed.` })
    }
    tabOrder = validateExactPermutation("jobs.tabOrder", input.jobs.tabOrder, JOBS_VIEW_MODES, errors)
    if (!isOneOf(input.jobs.defaultTab, JOBS_VIEW_MODES)) {
      errors.push({
        path: "jobs.defaultTab",
        message: `Invalid tab "${String(input.jobs.defaultTab)}". Allowed: ${JOBS_VIEW_MODES.join(", ")}.`,
      })
    } else {
      defaultTab = input.jobs.defaultTab
    }
  }

  // inventory
  let inventoryPartial: AppearanceConfig["inventory"] | null = null
  if (!isPlainObject(input.inventory)) {
    errors.push({ path: "inventory", message: "Must be an object." })
  } else {
    for (const key of unknownKeys(input.inventory, [
      "defaultView",
      "detailPresentation",
      "gridColumns",
      "card",
    ])) {
      errors.push({
        path: `inventory.${key}`,
        message: `Unknown key "${key}" is not allowed.`,
      })
    }

    const defaultView = input.inventory.defaultView
    const detailPresentation = input.inventory.detailPresentation
    const gridColumns = input.inventory.gridColumns

    if (!isOneOf(defaultView, INVENTORY_VIEW_MODES)) {
      errors.push({
        path: "inventory.defaultView",
        message: `Invalid view "${String(defaultView)}". Allowed: ${INVENTORY_VIEW_MODES.join(", ")}.`,
      })
    }
    if (!isOneOf(detailPresentation, DETAIL_PRESENTATIONS)) {
      errors.push({
        path: "inventory.detailPresentation",
        message: `Invalid presentation "${String(detailPresentation)}". Allowed: ${DETAIL_PRESENTATIONS.join(", ")}.`,
      })
    }
    if (!isOneOf(gridColumns, GRID_COLUMNS_PRESETS)) {
      errors.push({
        path: "inventory.gridColumns",
        message: `Invalid grid columns "${String(gridColumns)}". Allowed: ${GRID_COLUMNS_PRESETS.join(", ")}.`,
      })
    }

    if (!isPlainObject(input.inventory.card)) {
      errors.push({ path: "inventory.card", message: "Must be an object." })
    } else {
      for (const key of unknownKeys(input.inventory.card, [
        "fieldOrder",
        "hiddenFields",
        "actionOrder",
        "moreActions",
      ])) {
        errors.push({
          path: `inventory.card.${key}`,
          message: `Unknown key "${key}" is not allowed.`,
        })
      }

      const fieldOrder = validateExactPermutation(
        "inventory.card.fieldOrder",
        input.inventory.card.fieldOrder,
        INVENTORY_CARD_FIELD_IDS,
        errors,
      )
      const hiddenFields = validateHiddenFields(input.inventory.card.hiddenFields, errors)
      const actions = validateActionPartitions(
        input.inventory.card.actionOrder,
        input.inventory.card.moreActions,
        errors,
      )

      if (
        isOneOf(defaultView, INVENTORY_VIEW_MODES) &&
        isOneOf(detailPresentation, DETAIL_PRESENTATIONS) &&
        isOneOf(gridColumns, GRID_COLUMNS_PRESETS) &&
        fieldOrder &&
        hiddenFields &&
        actions
      ) {
        inventoryPartial = {
          defaultView,
          detailPresentation,
          gridColumns,
          card: {
            fieldOrder,
            hiddenFields,
            actionOrder: actions.actionOrder,
            moreActions: actions.moreActions,
          },
        }
      }
    }
  }

  // density
  let density: AppearanceConfig["density"] | null = null
  if (!isOneOf(input.density, DENSITY_PRESETS)) {
    errors.push({
      path: "density",
      message: `Invalid density "${String(input.density)}". Allowed: ${DENSITY_PRESETS.join(", ")}.`,
    })
  } else {
    density = input.density
  }

  // theme
  let theme: AppearanceConfig["theme"] | null = null
  if (!isPlainObject(input.theme)) {
    errors.push({ path: "theme", message: "Must be an object." })
  } else {
    for (const key of unknownKeys(input.theme, [
      "colorPreset",
      "typeScale",
      "spacingPreset",
      "buttonStyle",
      "colorScheme",
    ])) {
      errors.push({ path: `theme.${key}`, message: `Unknown key "${key}" is not allowed.` })
    }

    const colorPreset = input.theme.colorPreset
    const typeScale = input.theme.typeScale
    const spacingPreset = input.theme.spacingPreset
    const buttonStyle = input.theme.buttonStyle
    const colorScheme = input.theme.colorScheme

    if (!isOneOf(colorPreset, THEME_PRESET_IDS)) {
      errors.push({
        path: "theme.colorPreset",
        message: `Invalid color preset "${String(colorPreset)}". Allowed: ${THEME_PRESET_IDS.join(", ")}.`,
      })
    }
    if (!isOneOf(typeScale, TYPE_SCALE_IDS)) {
      errors.push({
        path: "theme.typeScale",
        message: `Invalid type scale "${String(typeScale)}". Allowed: ${TYPE_SCALE_IDS.join(", ")}.`,
      })
    }
    if (!isOneOf(spacingPreset, SPACING_PRESET_IDS)) {
      errors.push({
        path: "theme.spacingPreset",
        message: `Invalid spacing preset "${String(spacingPreset)}". Allowed: ${SPACING_PRESET_IDS.join(", ")}.`,
      })
    }
    if (!isOneOf(buttonStyle, BUTTON_STYLE_IDS)) {
      errors.push({
        path: "theme.buttonStyle",
        message: `Invalid button style "${String(buttonStyle)}". Allowed: ${BUTTON_STYLE_IDS.join(", ")}.`,
      })
    }
    if (!isOneOf(colorScheme, COLOR_SCHEME_PREFERENCES)) {
      errors.push({
        path: "theme.colorScheme",
        message: `Invalid color scheme "${String(colorScheme)}". Allowed: ${COLOR_SCHEME_PREFERENCES.join(", ")}.`,
      })
    }

    if (
      isOneOf(colorPreset, THEME_PRESET_IDS) &&
      isOneOf(typeScale, TYPE_SCALE_IDS) &&
      isOneOf(spacingPreset, SPACING_PRESET_IDS) &&
      isOneOf(buttonStyle, BUTTON_STYLE_IDS) &&
      isOneOf(colorScheme, COLOR_SCHEME_PREFERENCES)
    ) {
      theme = { colorPreset, typeScale, spacingPreset, buttonStyle, colorScheme }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  if (
    !appTitle ||
    !navOrder ||
    !tabOrder ||
    !defaultTab ||
    !inventoryPartial ||
    !density ||
    !theme
  ) {
    return {
      ok: false,
      errors: [{ path: "", message: "Configuration failed validation." }],
    }
  }

  const config: AppearanceConfig = {
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    branding: { appTitle },
    nav: { order: navOrder },
    jobs: { tabOrder, defaultTab },
    inventory: inventoryPartial,
    density,
    theme,
  }

  return { ok: true, config }
}

/**
 * Runtime validation that allows unknown keys to be stripped when the known
 * schema-version-1 fields are otherwise valid. Does not accept unknown keys
 * into the returned config.
 */
export function validateAppearanceConfigLenient(
  input: unknown,
): AppearanceStrictValidationResult {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Configuration must be a plain object." }],
    }
  }

  const picked: Record<string, unknown> = {}
  for (const key of APPEARANCE_V1_KNOWN_TOP_LEVEL_KEYS) {
    if (key in input) picked[key] = input[key]
  }

  // Strip unknown nested keys before strict check
  if (isPlainObject(picked.branding)) {
    picked.branding = { appTitle: picked.branding.appTitle }
  }
  if (isPlainObject(picked.nav)) {
    picked.nav = { order: picked.nav.order }
  }
  if (isPlainObject(picked.jobs)) {
    picked.jobs = {
      tabOrder: picked.jobs.tabOrder,
      defaultTab: picked.jobs.defaultTab,
    }
  }
  if (isPlainObject(picked.inventory)) {
    const inv = picked.inventory
    const card = isPlainObject(inv.card)
      ? {
          fieldOrder: inv.card.fieldOrder,
          hiddenFields: inv.card.hiddenFields,
          actionOrder: inv.card.actionOrder,
          moreActions: inv.card.moreActions,
        }
      : inv.card
    picked.inventory = {
      defaultView: inv.defaultView,
      detailPresentation: inv.detailPresentation,
      gridColumns: inv.gridColumns,
      card,
    }
  }
  if (isPlainObject(picked.theme)) {
    picked.theme = {
      colorPreset: picked.theme.colorPreset,
      typeScale: picked.theme.typeScale,
      spacingPreset: picked.theme.spacingPreset,
      buttonStyle: picked.theme.buttonStyle,
      colorScheme: picked.theme.colorScheme,
    }
  }

  return validateAppearanceConfigStrict(picked)
}

/** Always returns a complete config: validated input or compiled defaults. */
export function appearanceConfigOrDefault(input: unknown): AppearanceConfig {
  const result = validateAppearanceConfigLenient(input)
  if (result.ok) return result.config
  return cloneAppearanceConfig(DEFAULT_APPEARANCE_CONFIG)
}
