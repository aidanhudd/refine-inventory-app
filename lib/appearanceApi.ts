import { APPEARANCE_LOAD_TIMEOUT_MS, withTimeout } from "./asyncUtils"
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
    if (message.includes("timed out")) {
      return { status: "timeout", message }
    }
    return { status: "error", message }
  }
}

export { APPEARANCE_LOAD_TIMEOUT_MS }
