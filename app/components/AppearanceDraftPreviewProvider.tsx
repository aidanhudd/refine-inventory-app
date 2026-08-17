"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import {
  APPEARANCE_SCOPE_ATTR,
  appearanceConfigToDataAttributes,
  type AppearanceConfig,
} from "../../lib/appearance"

type AppearanceDraftPreviewContextValue = {
  config: AppearanceConfig
}

const AppearanceDraftPreviewContext = createContext<
  AppearanceDraftPreviewContextValue | undefined
>(undefined)

type AppearanceDraftPreviewProviderProps = {
  config: AppearanceConfig
  className?: string
  children: ReactNode
}

/**
 * Isolated draft preview scope. Allowlisted appearance attributes and
 * data-appearance-scope are rendered declaratively on the wrapper only —
 * never on document.documentElement / live AppearanceProvider.
 */
export function AppearanceDraftPreviewProvider({
  config,
  className = "",
  children,
}: AppearanceDraftPreviewProviderProps) {
  const value = useMemo(() => ({ config }), [config])
  const appearanceAttrs = useMemo(() => appearanceConfigToDataAttributes(config), [config])

  return (
    <AppearanceDraftPreviewContext.Provider value={value}>
      <div
        className={["appearance-draft-preview-scope", className].filter(Boolean).join(" ")}
        {...{ [APPEARANCE_SCOPE_ATTR]: "preview" }}
        {...appearanceAttrs}
      >
        {children}
      </div>
    </AppearanceDraftPreviewContext.Provider>
  )
}

export function useAppearanceDraftPreview(): AppearanceDraftPreviewContextValue {
  const context = useContext(AppearanceDraftPreviewContext)
  if (!context) {
    throw new Error(
      "useAppearanceDraftPreview must be used inside AppearanceDraftPreviewProvider",
    )
  }
  return context
}
