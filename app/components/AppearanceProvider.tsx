"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  DEFAULT_APPEARANCE_CONFIG,
  applyAppearanceAttributes,
  resolveAppearanceConfig,
  restoreAppearanceAttributes,
  type AppearanceAttributeSnapshot,
  type AppearanceConfig,
  type AppearanceConfigSource,
  type ResolvedAppearanceConfig,
} from "../../lib/appearance"
import { fetchPublishedAppearance } from "../../lib/appearanceApi"
import { hasAppAccess } from "../../lib/profiles"
import { useAuth } from "./AuthProvider"

export type AppearanceLoadStatus =
  | "idle"
  | "loading"
  | "published"
  | "missing"
  | "error"

export type AppearanceFallbackReason =
  | ResolvedAppearanceConfig["fallbackReason"]
  | "rpc_error"
  | "timeout"

type AppearanceContextValue = {
  /** Active appearance configuration (compiled defaults until a valid publish applies). */
  config: AppearanceConfig
  /** Where the active config came from. */
  source: AppearanceConfigSource
  /** True when serving compiled defaults rather than a published payload. */
  isUsingDefaults: boolean
  /** Valid published config when applied; otherwise null. */
  publishedConfig: AppearanceConfig | null
  /** Published version metadata (set when an RPC row was returned). */
  publishedVersionId: string | null
  publishedVersionNumber: bigint | null
  publishedSchemaVersion: number | null
  /** Read-only load lifecycle for later admin UI — never shown to normal users. */
  loadStatus: AppearanceLoadStatus
  /** Why defaults are active after a load attempt; null when unpublished/idle/success. */
  fallbackReason: AppearanceFallbackReason
}

type AppearanceRuntimeState = {
  config: AppearanceConfig
  source: AppearanceConfigSource
  isUsingDefaults: boolean
  publishedConfig: AppearanceConfig | null
  publishedVersionId: string | null
  publishedVersionNumber: bigint | null
  publishedSchemaVersion: number | null
  loadStatus: AppearanceLoadStatus
  fallbackReason: AppearanceFallbackReason
}

const DEFAULT_RUNTIME_STATE: AppearanceRuntimeState = {
  config: DEFAULT_APPEARANCE_CONFIG,
  source: "default",
  isUsingDefaults: true,
  publishedConfig: null,
  publishedVersionId: null,
  publishedVersionNumber: null,
  publishedSchemaVersion: null,
  loadStatus: "idle",
  fallbackReason: null,
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined)

function defaultsState(
  loadStatus: AppearanceLoadStatus,
  fallbackReason: AppearanceFallbackReason = null,
): AppearanceRuntimeState {
  return {
    ...DEFAULT_RUNTIME_STATE,
    loadStatus,
    fallbackReason,
  }
}

/**
 * Defaults-first AppearanceProvider (P3-3B).
 * Provides compiled defaults synchronously, never suspends, and loads published
 * appearance only after auth is ready for an approved app user.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { user, profile, loading: authLoading } = useAuth()
  const [runtime, setRuntime] = useState<AppearanceRuntimeState>(DEFAULT_RUNTIME_STATE)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (authLoading) return

    const requestId = ++requestIdRef.current
    let cancelled = false

    if (!user || !hasAppAccess(profile)) {
      setRuntime(defaultsState("idle"))
      return () => {
        cancelled = true
      }
    }

    // Defaults stay active while loading — never block on a prior user's config.
    setRuntime(defaultsState("loading"))

    void fetchPublishedAppearance().then((result) => {
      if (cancelled || requestId !== requestIdRef.current) return

      if (result.status === "missing") {
        setRuntime(defaultsState("missing"))
        return
      }

      if (result.status === "timeout") {
        console.warn("[Appearance] published load timed out:", result.message)
        setRuntime(defaultsState("error", "timeout"))
        return
      }

      if (result.status === "error") {
        console.warn("[Appearance] published load failed:", result.message)
        setRuntime(defaultsState("error", "rpc_error"))
        return
      }

      const resolved = resolveAppearanceConfig(result.row.config)
      if (resolved.isUsingDefaults) {
        console.warn(
          "[Appearance] published config rejected; using compiled defaults:",
          resolved.fallbackReason,
        )
        setRuntime({
          ...defaultsState("error", resolved.fallbackReason),
          publishedVersionId: result.row.versionId,
          publishedVersionNumber: result.row.versionNumber,
          publishedSchemaVersion: result.row.schemaVersion,
        })
        return
      }

      setRuntime({
        config: resolved.config,
        source: "published",
        isUsingDefaults: false,
        publishedConfig: resolved.config,
        publishedVersionId: result.row.versionId,
        publishedVersionNumber: result.row.versionNumber,
        publishedSchemaVersion: result.row.schemaVersion,
        loadStatus: "published",
        fallbackReason: null,
      })
    })

    return () => {
      cancelled = true
    }
  }, [authLoading, user, profile])

  useEffect(() => {
    const root = document.documentElement
    const snapshot: AppearanceAttributeSnapshot = applyAppearanceAttributes(
      root,
      runtime.config,
    )
    return () => {
      restoreAppearanceAttributes(root, snapshot)
    }
  }, [runtime.config])

  const value = useMemo<AppearanceContextValue>(
    () => ({
      config: runtime.config,
      source: runtime.source,
      isUsingDefaults: runtime.isUsingDefaults,
      publishedConfig: runtime.publishedConfig,
      publishedVersionId: runtime.publishedVersionId,
      publishedVersionNumber: runtime.publishedVersionNumber,
      publishedSchemaVersion: runtime.publishedSchemaVersion,
      loadStatus: runtime.loadStatus,
      fallbackReason: runtime.fallbackReason,
    }),
    [runtime],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) {
    throw new Error("useAppearance must be used inside AppearanceProvider")
  }
  return context
}
