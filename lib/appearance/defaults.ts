import {
  APPEARANCE_SCHEMA_VERSION,
  type AppearanceConfig,
} from "./types"

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
  }
  return value
}

/**
 * Compiled default appearance for schema version 1.
 * Matches current product chrome (title, nav, jobs tabs, inventory layout, tokens).
 * Frozen so consumers cannot mutate it by accident — use cloneAppearanceConfig for editors.
 */
export const DEFAULT_APPEARANCE_CONFIG: Readonly<AppearanceConfig> = deepFreeze({
  schemaVersion: APPEARANCE_SCHEMA_VERSION,
  branding: {
    appTitle: "Warehouse Inventory",
  },
  nav: {
    order: ["inventory", "jobs", "estimate"],
  },
  jobs: {
    tabOrder: ["customers", "holds", "usage"],
    defaultTab: "customers",
  },
  inventory: {
    defaultView: "list",
    detailPresentation: "expand",
    gridColumns: "three",
    card: {
      fieldOrder: [
        "holdStatus",
        "productName",
        "badges",
        "unitCost",
        "quantity",
        "location",
        "dimensions",
        "totalValue",
        "status",
        "createdAt",
        "notes",
        "usageHistory",
        "photos",
      ],
      hiddenFields: [],
      actionOrder: [
        "edit",
        "use",
        "hold",
        "addPhotos",
        "markSold",
        "undoMarkSold",
        "delete",
      ],
      moreActions: [],
    },
  },
  density: "comfortable",
  theme: {
    colorPreset: "systemDefault",
    typeScale: "md",
    spacingPreset: "normal",
    buttonStyle: "solid",
    colorScheme: "system",
  },
})

/** Deep clone for mutable editor / draft state. Defaults to the compiled default. */
export function cloneAppearanceConfig(
  config: AppearanceConfig = DEFAULT_APPEARANCE_CONFIG as AppearanceConfig,
): AppearanceConfig {
  return structuredClone(config)
}
