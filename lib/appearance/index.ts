export {
  APPEARANCE_SCHEMA_VERSION,
  APP_TITLE_MAX_LENGTH,
  APPEARANCE_V1_KNOWN_TOP_LEVEL_KEYS,
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
  SPACING_PRESET_IDS,
  THEME_PRESET_IDS,
  TYPE_SCALE_IDS,
  type AppearanceConfig,
  type ButtonStyleId,
  type ColorSchemePreference,
  type DensityPreset,
  type DetailPresentation,
  type GridColumnsPreset,
  type InventoryActionSlotId,
  type InventoryCardFieldId,
  type InventoryViewMode,
  type JobsViewMode,
  type NavItemId,
  type OptionalInventoryCardFieldId,
  type RequiredInventoryCardFieldId,
  type SpacingPresetId,
  type ThemePresetId,
  type TypeScaleId,
} from "./types"

export { DEFAULT_APPEARANCE_CONFIG, cloneAppearanceConfig } from "./defaults"

export {
  appearanceConfigOrDefault,
  validateAppearanceConfigLenient,
  validateAppearanceConfigStrict,
  type AppearanceStrictValidationResult,
  type AppearanceValidationIssue,
} from "./validate"

export {
  coerceAppearanceConfig,
  resolveAppearanceConfig,
  type AppearanceConfigSource,
  type ResolvedAppearanceConfig,
} from "./schemaCompat"

export {
  APPEARANCE_DATA_ATTR,
  APPEARANCE_SCOPE_ATTR,
  appearanceConfigToDataAttributes,
  applyAppearanceAttributes,
  readAppearanceAttributeSnapshot,
  restoreAppearanceAttributes,
  type AppearanceAttributeSnapshot,
  type AppearanceDataAttrName,
  type AppearanceDataAttributes,
} from "./applyAttributes"

export { JOBS_TAB_REGISTRY, NAV_LINK_REGISTRY } from "./registries"
