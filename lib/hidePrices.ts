import type { Profile } from "./profiles"
import { hasAppAccess } from "./profiles"

export const HIDE_PRICES_SESSION_KEY = "hide-prices"

export function canUseHidePricesToggle(
  profile: Pick<Profile, "role" | "approved"> | null | undefined,
): boolean {
  return hasAppAccess(profile)
}

export function readHidePricesPreference(): boolean {
  if (typeof window === "undefined") return false
  return window.sessionStorage.getItem(HIDE_PRICES_SESSION_KEY) === "1"
}

export function writeHidePricesPreference(hidePrices: boolean): void {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(HIDE_PRICES_SESSION_KEY, hidePrices ? "1" : "0")
}
