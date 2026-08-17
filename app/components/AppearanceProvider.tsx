"use client"

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react"
import {
  DEFAULT_APPEARANCE_CONFIG,
  applyAppearanceAttributes,
  restoreAppearanceAttributes,
  type AppearanceAttributeSnapshot,
  type AppearanceConfig,
  type AppearanceConfigSource,
} from "../../lib/appearance"

type AppearanceContextValue = {
  /** Active appearance configuration (compiled defaults until published load). */
  config: AppearanceConfig
  /** Where the active config came from. */
  source: AppearanceConfigSource
  /** True when serving compiled defaults rather than a published payload. */
  isUsingDefaults: boolean
  /**
   * Future published configuration once Supabase wiring lands.
   * Always null while the provider remains defaults-only.
   */
  publishedConfig: AppearanceConfig | null
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined)

/**
 * Defaults-only AppearanceProvider (P3-2A).
 * Synchronously provides compiled defaults, applies allowlisted data attributes
 * to the document root, and never fetches Supabase or blocks render.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AppearanceContextValue>(
    () => ({
      config: DEFAULT_APPEARANCE_CONFIG,
      source: "default",
      isUsingDefaults: true,
      publishedConfig: null,
    }),
    [],
  )

  useEffect(() => {
    const root = document.documentElement
    const snapshot: AppearanceAttributeSnapshot = applyAppearanceAttributes(
      root,
      value.config,
    )
    return () => {
      restoreAppearanceAttributes(root, snapshot)
    }
  }, [value.config])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) {
    throw new Error("useAppearance must be used inside AppearanceProvider")
  }
  return context
}
