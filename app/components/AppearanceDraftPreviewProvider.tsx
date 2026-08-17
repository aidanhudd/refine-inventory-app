"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import {
  APPEARANCE_SCOPE_ATTR,
  applyAppearanceAttributes,
  restoreAppearanceAttributes,
  type AppearanceAttributeSnapshot,
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
 * Isolated draft preview scope. Applies allowlisted appearance attributes only to
 * the preview wrapper — never to document.documentElement / live AppearanceProvider.
 */
export function AppearanceDraftPreviewProvider({
  config,
  className = "",
  children,
}: AppearanceDraftPreviewProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const value = useMemo(() => ({ config }), [config])

  useEffect(() => {
    const target = containerRef.current
    if (!target) return

    target.setAttribute(APPEARANCE_SCOPE_ATTR, "preview")
    const snapshot: AppearanceAttributeSnapshot = applyAppearanceAttributes(target, config)

    return () => {
      restoreAppearanceAttributes(target, snapshot)
      target.removeAttribute(APPEARANCE_SCOPE_ATTR)
    }
  }, [config])

  return (
    <AppearanceDraftPreviewContext.Provider value={value}>
      <div
        ref={containerRef}
        className={["appearance-draft-preview-scope", className].filter(Boolean).join(" ")}
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
