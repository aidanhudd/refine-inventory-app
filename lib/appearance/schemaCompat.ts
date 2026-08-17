import { DEFAULT_APPEARANCE_CONFIG, cloneAppearanceConfig } from "./defaults"
import { APPEARANCE_SCHEMA_VERSION, type AppearanceConfig } from "./types"
import { validateAppearanceConfigLenient } from "./validate"

export type AppearanceConfigSource = "default" | "published"

export type ResolvedAppearanceConfig = {
  config: AppearanceConfig
  source: AppearanceConfigSource
  /** True when the active config is the compiled default (not a published payload). */
  isUsingDefaults: boolean
  /**
   * Why defaults were used when input was present but rejected.
   * null when input was absent or successfully applied.
   */
  fallbackReason:
    | null
    | "missing"
    | "malformed"
    | "unsupported_schema_version"
    | "invalid_payload"
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function defaultResolution(
  reason: ResolvedAppearanceConfig["fallbackReason"],
): ResolvedAppearanceConfig {
  return {
    config: cloneAppearanceConfig(DEFAULT_APPEARANCE_CONFIG as AppearanceConfig),
    source: "default",
    isUsingDefaults: true,
    fallbackReason: reason,
  }
}

/**
 * Schema compatibility + runtime normalization.
 *
 * - Missing / null / non-object → full compiled defaults
 * - schemaVersion newer than this app supports → full defaults (no partial apply)
 * - schemaVersion older / unsupported (only v1 exists today) → full defaults
 *   until an explicit migration function exists
 * - schemaVersion === 1 → lenient validate (strip unknown keys); on failure → defaults
 */
export function resolveAppearanceConfig(input: unknown): ResolvedAppearanceConfig {
  if (input === null || input === undefined) {
    return defaultResolution("missing")
  }

  if (!isPlainObject(input)) {
    return defaultResolution("malformed")
  }

  const version = input.schemaVersion
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return defaultResolution("malformed")
  }

  if (version > APPEARANCE_SCHEMA_VERSION) {
    return defaultResolution("unsupported_schema_version")
  }

  if (version < APPEARANCE_SCHEMA_VERSION) {
    // No migration path yet — only v1 is supported.
    return defaultResolution("unsupported_schema_version")
  }

  const validated = validateAppearanceConfigLenient(input)
  if (!validated.ok) {
    return defaultResolution("invalid_payload")
  }

  return {
    config: validated.config,
    source: "published",
    isUsingDefaults: false,
    fallbackReason: null,
  }
}

/** Convenience: always a complete AppearanceConfig (defaults on any failure). */
export function coerceAppearanceConfig(input: unknown): AppearanceConfig {
  return resolveAppearanceConfig(input).config
}
