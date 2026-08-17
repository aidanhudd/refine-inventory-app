/** Supported appearance schema version for this application build. */
export const APPEARANCE_SCHEMA_VERSION = 1 as const

export const APP_TITLE_MAX_LENGTH = 40

export type DensityPreset = "compact" | "comfortable" | "spacious"
export type InventoryViewMode = "list" | "category"
export type JobsViewMode = "customers" | "holds" | "usage"
export type DetailPresentation = "expand" | "modal"
export type GridColumnsPreset = "one" | "two" | "three"
export type NavItemId = "inventory" | "jobs" | "estimate"
export type ThemePresetId = "systemDefault" | "slate" | "ocean"
export type TypeScaleId = "sm" | "md" | "lg"
export type SpacingPresetId = "tight" | "normal" | "relaxed"
export type ButtonStyleId = "solid" | "soft"
export type ColorSchemePreference = "system" | "light"

export const NAV_ITEM_IDS = ["inventory", "jobs", "estimate"] as const satisfies readonly NavItemId[]
export const JOBS_VIEW_MODES = ["customers", "holds", "usage"] as const satisfies readonly JobsViewMode[]
export const INVENTORY_VIEW_MODES = ["list", "category"] as const satisfies readonly InventoryViewMode[]
export const DETAIL_PRESENTATIONS = ["expand", "modal"] as const satisfies readonly DetailPresentation[]
export const GRID_COLUMNS_PRESETS = ["one", "two", "three"] as const satisfies readonly GridColumnsPreset[]
export const DENSITY_PRESETS = ["compact", "comfortable", "spacious"] as const satisfies readonly DensityPreset[]
export const THEME_PRESET_IDS = ["systemDefault", "slate", "ocean"] as const satisfies readonly ThemePresetId[]
export const TYPE_SCALE_IDS = ["sm", "md", "lg"] as const satisfies readonly TypeScaleId[]
export const SPACING_PRESET_IDS = ["tight", "normal", "relaxed"] as const satisfies readonly SpacingPresetId[]
export const BUTTON_STYLE_IDS = ["solid", "soft"] as const satisfies readonly ButtonStyleId[]
export const COLOR_SCHEME_PREFERENCES = ["system", "light"] as const satisfies readonly ColorSchemePreference[]

/** Required card fields — always present and never hideable. */
export const REQUIRED_INVENTORY_CARD_FIELDS = [
  "holdStatus",
  "productName",
  "quantity",
] as const

/** Optional card fields — may appear in hiddenFields. */
export const OPTIONAL_INVENTORY_CARD_FIELDS = [
  "badges",
  "unitCost",
  "location",
  "dimensions",
  "totalValue",
  "status",
  "createdAt",
  "notes",
  "usageHistory",
  "photos",
] as const

export const INVENTORY_CARD_FIELD_IDS = [
  ...REQUIRED_INVENTORY_CARD_FIELDS,
  ...OPTIONAL_INVENTORY_CARD_FIELDS,
] as const

export type InventoryCardFieldId = (typeof INVENTORY_CARD_FIELD_IDS)[number]
export type RequiredInventoryCardFieldId = (typeof REQUIRED_INVENTORY_CARD_FIELDS)[number]
export type OptionalInventoryCardFieldId = (typeof OPTIONAL_INVENTORY_CARD_FIELDS)[number]

/**
 * Configurable inventory action slots (appearance model).
 * These are not the raw rendered button IDs used by InventoryItemActions.
 *
 * Slot → rendered IDs (later apply layer):
 * - edit → Edit normally; Save + Cancel while editing
 * - hold → Hold or Release Hold by item state
 * - use / addPhotos / markSold / undoMarkSold / delete → same-named controls
 *
 * Save, Cancel, and Release Hold are not independently reorderable entries.
 */
export const INVENTORY_ACTION_SLOT_IDS = [
  "edit",
  "use",
  "hold",
  "addPhotos",
  "markSold",
  "undoMarkSold",
  "delete",
] as const

export type InventoryActionSlotId = (typeof INVENTORY_ACTION_SLOT_IDS)[number]

export type AppearanceConfig = {
  schemaVersion: typeof APPEARANCE_SCHEMA_VERSION
  branding: {
    /** Display title; max APP_TITLE_MAX_LENGTH characters. */
    appTitle: string
  }
  nav: {
    /** Permutation of Inventory, Jobs, Estimate — all exactly once. */
    order: NavItemId[]
  }
  jobs: {
    tabOrder: JobsViewMode[]
    defaultTab: JobsViewMode
  }
  inventory: {
    /** Company fallback when the browser has no list/category preference (wired in P3-2). */
    defaultView: InventoryViewMode
    detailPresentation: DetailPresentation
    gridColumns: GridColumnsPreset
    card: {
      fieldOrder: InventoryCardFieldId[]
      /** Optional fields only; required fields cannot be listed. */
      hiddenFields: InventoryCardFieldId[]
      /** Primary action-slot order (configurable slots, not save/cancel/releaseHold). */
      actionOrder: InventoryActionSlotId[]
      /** Overflow slots; disjoint from actionOrder; default empty. */
      moreActions: InventoryActionSlotId[]
    }
  }
  density: DensityPreset
  theme: {
    colorPreset: ThemePresetId
    typeScale: TypeScaleId
    spacingPreset: SpacingPresetId
    buttonStyle: ButtonStyleId
    colorScheme: ColorSchemePreference
  }
}

/** Known top-level + nested keys for schema version 1 (runtime may strip anything else). */
export const APPEARANCE_V1_KNOWN_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "branding",
  "nav",
  "jobs",
  "inventory",
  "density",
  "theme",
] as const
