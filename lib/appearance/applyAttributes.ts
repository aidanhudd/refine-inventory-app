import type { AppearanceConfig } from "./types"
import {
  BUTTON_STYLE_IDS,
  COLOR_SCHEME_PREFERENCES,
  DENSITY_PRESETS,
  GRID_COLUMNS_PRESETS,
  SPACING_PRESET_IDS,
  THEME_PRESET_IDS,
  TYPE_SCALE_IDS,
} from "./types"

/** Allowlisted data-attribute names applied from AppearanceConfig. */
export const APPEARANCE_DATA_ATTR = {
  density: "data-density",
  colorPreset: "data-color-preset",
  typeScale: "data-type-scale",
  spacingPreset: "data-spacing",
  buttonStyle: "data-button-style",
  colorScheme: "data-color-scheme",
  gridColumns: "data-grid-columns",
} as const

export type AppearanceDataAttrName =
  (typeof APPEARANCE_DATA_ATTR)[keyof typeof APPEARANCE_DATA_ATTR]

export type AppearanceDataAttributes = Record<AppearanceDataAttrName, string>

const ATTR_NAMES = Object.values(APPEARANCE_DATA_ATTR)

function assertAllowlisted<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Appearance apply rejected non-allowlisted ${label}: ${value}`)
  }
  return value as T
}

/**
 * Pure mapping from AppearanceConfig presets to allowlisted data attributes.
 * Never passes through arbitrary strings into class names or CSS.
 */
export function appearanceConfigToDataAttributes(
  config: AppearanceConfig,
): AppearanceDataAttributes {
  return {
    [APPEARANCE_DATA_ATTR.density]: assertAllowlisted(
      config.density,
      DENSITY_PRESETS,
      "density",
    ),
    [APPEARANCE_DATA_ATTR.colorPreset]: assertAllowlisted(
      config.theme.colorPreset,
      THEME_PRESET_IDS,
      "colorPreset",
    ),
    [APPEARANCE_DATA_ATTR.typeScale]: assertAllowlisted(
      config.theme.typeScale,
      TYPE_SCALE_IDS,
      "typeScale",
    ),
    [APPEARANCE_DATA_ATTR.spacingPreset]: assertAllowlisted(
      config.theme.spacingPreset,
      SPACING_PRESET_IDS,
      "spacingPreset",
    ),
    [APPEARANCE_DATA_ATTR.buttonStyle]: assertAllowlisted(
      config.theme.buttonStyle,
      BUTTON_STYLE_IDS,
      "buttonStyle",
    ),
    [APPEARANCE_DATA_ATTR.colorScheme]: assertAllowlisted(
      config.theme.colorScheme,
      COLOR_SCHEME_PREFERENCES,
      "colorScheme",
    ),
    [APPEARANCE_DATA_ATTR.gridColumns]: assertAllowlisted(
      config.inventory.gridColumns,
      GRID_COLUMNS_PRESETS,
      "gridColumns",
    ),
  }
}

/** Previous attribute values for restore (null = attribute was absent). */
export type AppearanceAttributeSnapshot = Record<AppearanceDataAttrName, string | null>

export function readAppearanceAttributeSnapshot(
  target: Element,
): AppearanceAttributeSnapshot {
  const snapshot = {} as AppearanceAttributeSnapshot
  for (const name of ATTR_NAMES) {
    snapshot[name] = target.getAttribute(name)
  }
  return snapshot
}

/**
 * Apply allowlisted appearance attributes to any element (document root or
 * future preview container). Returns a snapshot for cleanup/restoration.
 */
export function applyAppearanceAttributes(
  target: Element,
  config: AppearanceConfig,
): AppearanceAttributeSnapshot {
  const snapshot = readAppearanceAttributeSnapshot(target)
  const next = appearanceConfigToDataAttributes(config)
  for (const name of ATTR_NAMES) {
    target.setAttribute(name, next[name])
  }
  return snapshot
}

/** Restore attributes previously captured by applyAppearanceAttributes. */
export function restoreAppearanceAttributes(
  target: Element,
  snapshot: AppearanceAttributeSnapshot,
): void {
  for (const name of ATTR_NAMES) {
    const previous = snapshot[name]
    if (previous === null) {
      target.removeAttribute(name)
    } else {
      target.setAttribute(name, previous)
    }
  }
}
