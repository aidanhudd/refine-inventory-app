import {
  APPEARANCE_LOAD_TIMEOUT_MS,
  withTimeout,
} from "./asyncUtils"
import {
  APPEARANCE_SCHEMA_VERSION,
  cloneAppearanceConfig,
  resolveAppearanceConfig,
  validateAppearanceConfigStrict,
  type AppearanceConfig,
  type AppearanceValidationIssue,
} from "./appearance"
import { supabase } from "./supabaseClient"

/** Typed row from `get_published_appearance()`. */
export type PublishedAppearanceRow = {
  config: unknown
  versionId: string
  versionNumber: bigint
  schemaVersion: number
}

export type FetchPublishedAppearanceResult =
  | { status: "published"; row: PublishedAppearanceRow }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "timeout"; message: string }

type PublishedAppearanceRpcRow = {
  config: unknown
  version_id: unknown
  version_number: unknown
  config_schema_version: unknown
}

/** Validated private draft row from `get_appearance_draft` / `upsert_appearance_draft`. */
export type AppearanceDraftRow = {
  id: string
  config: AppearanceConfig
  configSchemaVersion: number
  updatedAt: string
  restoredFromVersionId: string | null
}

export type GetAppearanceDraftResult =
  | { status: "draft"; row: AppearanceDraftRow }
  | { status: "missing" }
  | {
      status: "invalid"
      message: string
      issues: AppearanceValidationIssue[]
      fallbackConfig: AppearanceConfig
      draftId: string | null
      updatedAt: string | null
      restoredFromVersionId: string | null
    }
  | { status: "error"; message: string }
  | { status: "timeout"; message: string }

export type UpsertAppearanceDraftResult =
  | { status: "saved"; row: AppearanceDraftRow }
  | {
      status: "validation"
      message: string
      issues: AppearanceValidationIssue[]
      source: "client" | "server"
    }
  | { status: "error"; message: string }
  | { status: "timeout"; message: string }

type AppearanceDraftRpcRow = {
  id: unknown
  config: unknown
  config_schema_version: unknown
  updated_at: unknown
  restored_from_version_id: unknown
}

function parseBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value
  // Only accept numbers that survived JSON without losing integer precision.
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value)
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    try {
      return BigInt(value.trim())
    } catch {
      return null
    }
  }
  return null
}

function mapPublishedRow(data: PublishedAppearanceRpcRow): PublishedAppearanceRow | null {
  if (typeof data.version_id !== "string" || data.version_id.length === 0) return null
  const versionNumber = parseBigInt(data.version_number)
  if (versionNumber === null) return null
  if (
    typeof data.config_schema_version !== "number" ||
    !Number.isInteger(data.config_schema_version)
  ) {
    return null
  }

  return {
    config: data.config,
    versionId: data.version_id,
    versionNumber,
    schemaVersion: data.config_schema_version,
  }
}

function isTimeoutMessage(message: string): boolean {
  return message.includes("timed out")
}

/** Parse `APPEARANCE:<CODE>:<message>` RPC exceptions when present. */
export function parseAppearanceRpcError(message: string | null | undefined): {
  code: string | null
  detail: string
  path: string | null
} {
  const raw = (message || "").trim()
  const match = raw.match(/^APPEARANCE:([A-Z0-9_]+):([\s\S]*)$/)
  if (!match) {
    return { code: null, detail: raw || "Appearance request failed.", path: null }
  }

  const code = match[1]
  const detail = match[2].trim() || code
  // Prefer known config path prefixes from server/client validators.
  const pathMatch = detail.match(
    /^(schemaVersion|branding(?:\.[a-zA-Z]+)?|nav(?:\.[a-zA-Z]+)?|jobs(?:\.[a-zA-Z]+)?|inventory(?:\.[a-zA-Z.]+)?|density|theme(?:\.[a-zA-Z]+)?)\b/,
  )

  return { code, detail, path: pathMatch?.[1] ?? null }
}

function mapDraftRow(data: AppearanceDraftRpcRow): {
  id: string
  config: unknown
  configSchemaVersion: number
  updatedAt: string
  restoredFromVersionId: string | null
} | null {
  if (typeof data.id !== "string" || data.id.length === 0) return null
  if (
    typeof data.config_schema_version !== "number" ||
    !Number.isInteger(data.config_schema_version)
  ) {
    return null
  }
  if (typeof data.updated_at !== "string" || data.updated_at.length === 0) return null
  if (
    data.restored_from_version_id != null &&
    typeof data.restored_from_version_id !== "string"
  ) {
    return null
  }

  return {
    id: data.id,
    config: data.config,
    configSchemaVersion: data.config_schema_version,
    updatedAt: data.updated_at,
    restoredFromVersionId: data.restored_from_version_id ?? null,
  }
}

function unsupportedDraftSchemaResult(mapped: {
  id: string
  updatedAt: string
  restoredFromVersionId: string | null
  configSchemaVersion: number
}): Extract<GetAppearanceDraftResult, { status: "invalid" }> {
  return {
    status: "invalid",
    message: `Draft config_schema_version must be ${APPEARANCE_SCHEMA_VERSION} (got ${mapped.configSchemaVersion}).`,
    issues: [
      {
        path: "config_schema_version",
        message: `Must be ${APPEARANCE_SCHEMA_VERSION} (got ${mapped.configSchemaVersion}).`,
      },
    ],
    fallbackConfig: cloneAppearanceConfig(),
    draftId: mapped.id,
    updatedAt: mapped.updatedAt,
    restoredFromVersionId: mapped.restoredFromVersionId,
  }
}

function isSupportedDraftSchemaVersion(version: number): boolean {
  return version === APPEARANCE_SCHEMA_VERSION
}

function validateDraftConfig(config: unknown): {
  ok: true
  config: AppearanceConfig
} | {
  ok: false
  issues: AppearanceValidationIssue[]
  message: string
} {
  const resolved = resolveAppearanceConfig(config)
  if (!resolved.isUsingDefaults && resolved.source === "published") {
    return { ok: true, config: resolved.config }
  }

  const strict = validateAppearanceConfigStrict(
    typeof config === "object" && config !== null ? config : {},
  )
  if (strict.ok) {
    return { ok: true, config: strict.config }
  }

  const reason = resolved.fallbackReason || "invalid_payload"
  return {
    ok: false,
    issues: strict.ok === false ? strict.errors : [{ path: "", message: `Rejected (${reason}).` }],
    message:
      reason === "unsupported_schema_version"
        ? "Draft schema version is unsupported by this app build."
        : reason === "malformed"
          ? "Draft configuration is malformed."
          : "Draft configuration failed validation.",
  }
}

/**
 * Read-only fetch of the company published appearance.
 * Never throws — callers distinguish published / missing / error / timeout.
 */
export async function fetchPublishedAppearance(): Promise<FetchPublishedAppearanceResult> {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc("get_published_appearance").maybeSingle(),
      APPEARANCE_LOAD_TIMEOUT_MS,
      "get_published_appearance",
    )

    if (error) {
      return { status: "error", message: error.message }
    }

    if (!data) {
      return { status: "missing" }
    }

    const row = mapPublishedRow(data as PublishedAppearanceRpcRow)
    if (!row) {
      return {
        status: "error",
        message: "Published appearance row has an unexpected shape.",
      }
    }

    return { status: "published", row }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown appearance load error"
    if (isTimeoutMessage(message)) {
      return { status: "timeout", message }
    }
    return { status: "error", message }
  }
}

/**
 * Load the signed-in admin’s private appearance draft.
 * Missing draft is normal. Invalid drafts fall back to compiled defaults for the editor.
 */
export async function getAppearanceDraft(): Promise<GetAppearanceDraftResult> {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc("get_appearance_draft").maybeSingle(),
      APPEARANCE_LOAD_TIMEOUT_MS,
      "get_appearance_draft",
    )

    if (error) {
      const parsed = parseAppearanceRpcError(error.message)
      return { status: "error", message: parsed.detail }
    }

    if (!data) {
      return { status: "missing" }
    }

    const mapped = mapDraftRow(data as AppearanceDraftRpcRow)
    if (!mapped) {
      return {
        status: "invalid",
        message: "Appearance draft row has an unexpected shape.",
        issues: [{ path: "", message: "Unexpected draft row shape." }],
        fallbackConfig: cloneAppearanceConfig(),
        draftId: null,
        updatedAt: null,
        restoredFromVersionId: null,
      }
    }

    if (!isSupportedDraftSchemaVersion(mapped.configSchemaVersion)) {
      return unsupportedDraftSchemaResult(mapped)
    }

    const validated = validateDraftConfig(mapped.config)
    if (!validated.ok) {
      return {
        status: "invalid",
        message: validated.message,
        issues: validated.issues,
        fallbackConfig: cloneAppearanceConfig(),
        draftId: mapped.id,
        updatedAt: mapped.updatedAt,
        restoredFromVersionId: mapped.restoredFromVersionId,
      }
    }

    return {
      status: "draft",
      row: {
        id: mapped.id,
        config: validated.config,
        configSchemaVersion: mapped.configSchemaVersion,
        updatedAt: mapped.updatedAt,
        restoredFromVersionId: mapped.restoredFromVersionId,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown appearance draft load error"
    if (isTimeoutMessage(message)) {
      return { status: "timeout", message }
    }
    return { status: "error", message }
  }
}

/**
 * Upsert the signed-in admin’s private draft after strict client validation.
 * Server RPC remains authoritative.
 */
export async function upsertAppearanceDraft(
  config: AppearanceConfig,
): Promise<UpsertAppearanceDraftResult> {
  const clientValidation = validateAppearanceConfigStrict(config)
  if (!clientValidation.ok) {
    return {
      status: "validation",
      message: "Draft failed client validation.",
      issues: clientValidation.errors,
      source: "client",
    }
  }

  try {
    const { data, error } = await withTimeout(
      supabase
        .rpc("upsert_appearance_draft", { p_config: clientValidation.config })
        .maybeSingle(),
      APPEARANCE_LOAD_TIMEOUT_MS,
      "upsert_appearance_draft",
    )

    if (error) {
      const parsed = parseAppearanceRpcError(error.message)
      if (parsed.code === "INVALID_CONFIG" || parsed.code === "UNSUPPORTED_SCHEMA") {
        const issues: AppearanceValidationIssue[] = [
          {
            path: parsed.path || "",
            message: parsed.detail,
          },
        ]
        return {
          status: "validation",
          message: parsed.detail,
          issues,
          source: "server",
        }
      }
      return { status: "error", message: parsed.detail }
    }

    if (!data) {
      return {
        status: "error",
        message: "Upsert appearance draft returned no row.",
      }
    }

    const mapped = mapDraftRow(data as AppearanceDraftRpcRow)
    if (!mapped) {
      return {
        status: "error",
        message: "Upsert appearance draft returned an unexpected shape.",
      }
    }

    if (!isSupportedDraftSchemaVersion(mapped.configSchemaVersion)) {
      const invalid = unsupportedDraftSchemaResult(mapped)
      return {
        status: "validation",
        message: invalid.message,
        issues: invalid.issues,
        source: "server",
      }
    }

    const validated = validateDraftConfig(mapped.config)
    if (!validated.ok) {
      return {
        status: "validation",
        message: validated.message,
        issues: validated.issues,
        source: "server",
      }
    }

    return {
      status: "saved",
      row: {
        id: mapped.id,
        config: validated.config,
        configSchemaVersion: mapped.configSchemaVersion,
        updatedAt: mapped.updatedAt,
        restoredFromVersionId: mapped.restoredFromVersionId,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown appearance draft save error"
    if (isTimeoutMessage(message)) {
      return { status: "timeout", message }
    }
    return { status: "error", message }
  }
}

export { APPEARANCE_LOAD_TIMEOUT_MS }
