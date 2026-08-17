"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import {
  DEFAULT_APPEARANCE_CONFIG,
  type AppearanceConfig,
  type AppearanceConfigSource,
} from "../../lib/appearance"


type AppearanceContextValue = {
  /** Active appearance configuration (compiled defaults in P3-1). */
  config: AppearanceConfig
  /** Where the active config came from. */
  source: AppearanceConfigSource
  /** True when serving compiled defaults rather than a published payload. */
  isUsingDefaults: boolean
  /**
   * Future published configuration once Supabase wiring lands.
   * Always null in P3-1 (defaults-only provider).
   */
  publishedConfig: AppearanceConfig | null
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined)

/**
 * Defaults-only AppearanceProvider (P3-1).
 * Synchronously provides compiled defaults. Does not fetch Supabase, suspend, or
 * apply configurable DOM/CSS yet (no visible behavior change).
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

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) {
    throw new Error("useAppearance must be used inside AppearanceProvider")
  }
  return context
}
