"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useAuth } from "./AuthProvider"
import {
  canUseHidePricesToggle,
  readHidePricesPreference,
  writeHidePricesPreference,
} from "../../lib/hidePrices"

type HidePricesContextType = {
  hidePrices: boolean
  canToggleHidePrices: boolean
  setHidePrices: (hide: boolean) => void
}

const HidePricesContext = createContext<HidePricesContextType | undefined>(undefined)

export function HidePricesProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  const [hidePrices, setHidePricesState] = useState(false)
  const canToggleHidePrices = canUseHidePricesToggle(profile)

  useEffect(() => {
    setHidePricesState(readHidePricesPreference())
  }, [])

  useEffect(() => {
    if (!canToggleHidePrices && hidePrices) {
      setHidePricesState(false)
      writeHidePricesPreference(false)
    }
  }, [canToggleHidePrices, hidePrices])

  const setHidePrices = useCallback(
    (hide: boolean) => {
      if (!canToggleHidePrices) return
      setHidePricesState(hide)
      writeHidePricesPreference(hide)
    },
    [canToggleHidePrices],
  )

  const value = useMemo(
    () => ({
      hidePrices: canToggleHidePrices ? hidePrices : false,
      canToggleHidePrices,
      setHidePrices,
    }),
    [hidePrices, canToggleHidePrices, setHidePrices],
  )

  return <HidePricesContext.Provider value={value}>{children}</HidePricesContext.Provider>
}

export function useHidePrices() {
  const context = useContext(HidePricesContext)
  if (!context) {
    throw new Error("useHidePrices must be used inside HidePricesProvider")
  }
  return context
}
