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

// ---------------------------------------------------------------------------
// Reset / history / restore (P3-5A) — never throws into React
// ---------------------------------------------------------------------------

export type AppearanceVersionSource = "publish" | "restore_publish"

/** History row safe for UI — never includes raw config JSON. */
export type AppearanceVersionHistoryEntry = {
  id: string
  versionNumber: bigint
  label: string | null
  configSchemaVersion: number
  createdBy: string
  createdAt: string
  source: AppearanceVersionSource | "unknown"
  /** False when schema/config cannot be restored through this app build. */
  restorable: boolean
  unavailableReason: string | null
}

export type ResetAppearanceDraftResult =
  | { status: "reset" }
  | { status: "error"; message: string; code: string | null }
  | { status: "timeout"; message: string }

export type ListAppearanceVersionsResult =
  | { status: "history"; versions: AppearanceVersionHistoryEntry[] }
  | { status: "error"; message: string; code: string | null }
  | { status: "timeout"; message: string }

export type RestoreAppearanceVersionResult =
  | { status: "restored"; row: AppearanceDraftRow }
  | {
      status: "invalid"
      message: string
      issues: AppearanceValidationIssue[]
      code: string | null
    }
  | { status: "error"; message: string; code: string | null }
  | { status: "timeout"; message: string }

type AppearanceVersionRpcRow = {
  id: unknown
  version_number: unknown
  label: unknown
  config: unknown
  config_schema_version: unknown
  created_by: unknown
  created_at: unknown
  source: unknown
}

function isAppearanceVersionSource(value: unknown): value is AppearanceVersionSource {
  return value === "publish" || value === "restore_publish"
}

function mapVersionHistoryEntry(data: AppearanceVersionRpcRow): AppearanceVersionHistoryEntry | null {
  if (typeof data.id !== "string" || data.id.length === 0) return null
  const versionNumber = parseBigInt(data.version_number)
  if (versionNumber === null) return null
  if (
    typeof data.config_schema_version !== "number" ||
    !Number.isInteger(data.config_schema_version)
  ) {
    return null
  }
  if (typeof data.created_by !== "string" || data.created_by.length === 0) return null
  if (typeof data.created_at !== "string" || data.created_at.length === 0) return null
  if (data.label != null && typeof data.label !== "string") return null

  const label = data.label ?? null
  const base = {
    id: data.id,
    versionNumber,
    label,
    configSchemaVersion: data.config_schema_version,
    createdBy: data.created_by,
    createdAt: data.created_at,
  }

  if (!isAppearanceVersionSource(data.source)) {
    return {
      ...base,
      source: "unknown",
      restorable: false,
      unavailableReason: "This version has an unsupported publish source and cannot be restored.",
    }
  }

  if (!isSupportedDraftSchemaVersion(data.config_schema_version)) {
    return {
      ...base,
      source: data.source,
      restorable: false,
      unavailableReason: `Schema version ${data.config_schema_version} is unsupported by this app build.`,
    }
  }

  const validated = validateDraftConfig(data.config)
  if (!validated.ok) {
    return {
      ...base,
      source: data.source,
      restorable: false,
      unavailableReason: validated.message,
    }
  }

  return {
    ...base,
    source: data.source,
    restorable: true,
    unavailableReason: null,
  }
}

function appearanceErrorMessage(code: string | null, detail: string): string {
  switch (code) {
    case "FORBIDDEN":
      return "You do not have permission to perform this appearance action."
    case "VERSION_NOT_FOUND":
      return "That appearance version was not found."
    case "DRAFT_NOT_FOUND":
      return "No private appearance draft exists to publish. Save Draft first."
    case "INVALID_LABEL":
      return detail || "Publish label is invalid."
    case "INVALID_CONFIG":
      return detail || "Appearance configuration is invalid."
    case "UNSUPPORTED_SCHEMA":
      return detail || "Appearance schema version is unsupported by this app build."
    case "SETTINGS_NOT_FOUND":
      return "Appearance settings are missing. Publishing cannot continue."
    default:
      return detail || "Appearance request failed."
  }
}

/**
 * Delete the signed-in admin’s private draft only.
 * Does not change published/live appearance. Never throws.
 */
export async function resetAppearanceDraft(): Promise<ResetAppearanceDraftResult> {
  try {
    const { error } = await withTimeout(
      supabase.rpc("reset_appearance_draft"),
      APPEARANCE_LOAD_TIMEOUT_MS,
      "reset_appearance_draft",
    )

    if (error) {
      const parsed = parseAppearanceRpcError(error.message)
      return {
        status: "error",
        message: appearanceErrorMessage(parsed.code, parsed.detail),
        code: parsed.code,
      }
    }

    return { status: "reset" }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown appearance draft reset error"
    if (isTimeoutMessage(message)) {
      return { status: "timeout", message }
    }
    return { status: "error", message, code: null }
  }
}

/**
 * List published appearance versions (newest first). Config is validated privately
 * and never returned to the UI. Never throws.
 */
export async function listAppearanceVersions(): Promise<ListAppearanceVersionsResult> {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc("list_appearance_versions"),
      APPEARANCE_LOAD_TIMEOUT_MS,
      "list_appearance_versions",
    )

    if (error) {
      const parsed = parseAppearanceRpcError(error.message)
      return {
        status: "error",
        message: appearanceErrorMessage(parsed.code, parsed.detail),
        code: parsed.code,
      }
    }

    const rows = Array.isArray(data) ? data : data == null ? [] : [data]
    const versions: AppearanceVersionHistoryEntry[] = []
    for (const row of rows) {
      if (!row || typeof row !== "object") continue
      const mapped = mapVersionHistoryEntry(row as AppearanceVersionRpcRow)
      if (mapped) versions.push(mapped)
    }

    return { status: "history", versions }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown appearance history load error"
    if (isTimeoutMessage(message)) {
      return { status: "timeout", message }
    }
    return { status: "error", message, code: null }
  }
}

/**
 * Copy a published version into the caller’s private draft (no publish).
 * Strictly validates the restored config before returning it. Never throws.
 */
export async function restoreAppearanceVersionToDraft(
  versionId: string,
): Promise<RestoreAppearanceVersionResult> {
  if (typeof versionId !== "string" || versionId.trim().length === 0) {
    return {
      status: "error",
      message: "That appearance version was not found.",
      code: "VERSION_NOT_FOUND",
    }
  }

  try {
    const { data, error } = await withTimeout(
      supabase
        .rpc("restore_appearance_version_to_draft", { p_version_id: versionId.trim() })
        .maybeSingle(),
      APPEARANCE_LOAD_TIMEOUT_MS,
      "restore_appearance_version_to_draft",
    )

    if (error) {
      const parsed = parseAppearanceRpcError(error.message)
      if (parsed.code === "INVALID_CONFIG" || parsed.code === "UNSUPPORTED_SCHEMA") {
        return {
          status: "invalid",
          message: appearanceErrorMessage(parsed.code, parsed.detail),
          issues: [
            {
              path: parsed.path || "",
              message: parsed.detail,
            },
          ],
          code: parsed.code,
        }
      }
      return {
        status: "error",
        message: appearanceErrorMessage(parsed.code, parsed.detail),
        code: parsed.code,
      }
    }

    if (!data) {
      return {
        status: "error",
        message: "Restore appearance version returned no draft row.",
        code: null,
      }
    }

    const mapped = mapDraftRow(data as AppearanceDraftRpcRow)
    if (!mapped) {
      return {
        status: "invalid",
        message: "Restored appearance draft has an unexpected shape.",
        issues: [{ path: "", message: "Unexpected restored draft row shape." }],
        code: null,
      }
    }

    if (!isSupportedDraftSchemaVersion(mapped.configSchemaVersion)) {
      const invalid = unsupportedDraftSchemaResult(mapped)
      return {
        status: "invalid",
        message: invalid.message,
        issues: invalid.issues,
        code: "UNSUPPORTED_SCHEMA",
      }
    }

    const validated = validateDraftConfig(mapped.config)
    if (!validated.ok) {
      return {
        status: "invalid",
        message: validated.message,
        issues: validated.issues,
        code: "INVALID_CONFIG",
      }
    }

    return {
      status: "restored",
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
      error instanceof Error ? error.message : "Unknown appearance restore error"
    if (isTimeoutMessage(message)) {
      return { status: "timeout", message }
    }
    return { status: "error", message, code: null }
  }
}

// ---------------------------------------------------------------------------
// Publish (P3-5B) — never throws into React; does not duplicate server logic
// ---------------------------------------------------------------------------

export const APPEARANCE_PUBLISH_LABEL_MAX_LENGTH = 120

const PUBLISH_LABEL_UNSAFE = /[\u0000-\u001F\u007F\u2028\u2029]/

export type PublishAppearanceDraftResult =
  | { status: "published"; versionId: string; versionNumber: bigint }
  | {
      status: "validation"
      message: string
      issues: AppearanceValidationIssue[]
      code: string | null
    }
  | { status: "error"; message: string; code: string | null }
  | { status: "timeout"; message: string }

type PublishAppearanceRpcRow = {
  version_id: unknown
  version_number: unknown
}

/**
 * Normalize an optional publish label for the RPC.
 * Empty / whitespace-only → null. Does not throw.
 */
export function normalizeAppearancePublishLabel(label: string | null | undefined): {
  ok: true
  value: string | null
} | {
  ok: false
  message: string
} {
  if (label == null) return { ok: true, value: null }
  const trimmed = label.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (trimmed.length > APPEARANCE_PUBLISH_LABEL_MAX_LENGTH) {
    return {
      ok: false,
      message: `Publish label must be at most ${APPEARANCE_PUBLISH_LABEL_MAX_LENGTH} characters.`,
    }
  }
  if (PUBLISH_LABEL_UNSAFE.test(trimmed)) {
    return {
      ok: false,
      message: "Publish label must be a single line without control characters or line breaks.",
    }
  }
  return { ok: true, value: trimmed }
}

function mapPublishRow(data: PublishAppearanceRpcRow): {
  versionId: string
  versionNumber: bigint
} | null {
  if (typeof data.version_id !== "string" || data.version_id.length === 0) return null
  const versionNumber = parseBigInt(data.version_number)
  if (versionNumber === null) return null
  return { versionId: data.version_id, versionNumber }
}

/**
 * Publish the signed-in admin’s private draft to company appearance history.
 * Never throws. A timeout means the outcome is uncertain (server may have succeeded).
 */
export async function publishAppearanceDraft(
  label?: string | null,
): Promise<PublishAppearanceDraftResult> {
  const normalized = normalizeAppearancePublishLabel(label)
  if (!normalized.ok) {
    return {
      status: "validation",
      message: normalized.message,
      issues: [{ path: "label", message: normalized.message }],
      code: "INVALID_LABEL",
    }
  }

  try {
    const { data, error } = await withTimeout(
      supabase
        .rpc("publish_appearance_draft", { p_label: normalized.value })
        .maybeSingle(),
      APPEARANCE_LOAD_TIMEOUT_MS,
      "publish_appearance_draft",
    )

    if (error) {
      const parsed = parseAppearanceRpcError(error.message)
      if (
        parsed.code === "INVALID_LABEL" ||
        parsed.code === "INVALID_CONFIG" ||
        parsed.code === "UNSUPPORTED_SCHEMA"
      ) {
        return {
          status: "validation",
          message: appearanceErrorMessage(parsed.code, parsed.detail),
          issues: [
            {
              path: parsed.code === "INVALID_LABEL" ? "label" : parsed.path || "",
              message: parsed.detail,
            },
          ],
          code: parsed.code,
        }
      }
      return {
        status: "error",
        message: appearanceErrorMessage(parsed.code, parsed.detail),
        code: parsed.code,
      }
    }

    if (!data) {
      return {
        status: "error",
        message: "Publish appearance draft returned no version row.",
        code: null,
      }
    }

    const mapped = mapPublishRow(data as PublishAppearanceRpcRow)
    if (!mapped) {
      return {
        status: "error",
        message: "Publish appearance draft returned an unexpected shape.",
        code: null,
      }
    }

    return {
      status: "published",
      versionId: mapped.versionId,
      versionNumber: mapped.versionNumber,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown appearance publish error"
    if (isTimeoutMessage(message)) {
      return {
        status: "timeout",
        message:
          "Publish timed out. The outcome is uncertain — the publish may have succeeded on the server. Reload this page and inspect version history before trying again.",
      }
    }
    return { status: "error", message, code: null }
  }
}

export { APPEARANCE_LOAD_TIMEOUT_MS }
