import type { Profile } from "./profiles"
import { hasAppAccess } from "./profiles"
import { safeGetItem, safeSetItem } from "./storageSafe"

export const HIDE_PRICES_SESSION_KEY = "hide-prices"

export function canUseHidePricesToggle(
  profile: Pick<Profile, "role" | "approved"> | null | undefined,
): boolean {
  return hasAppAccess(profile)
}

export function readHidePricesPreference(): boolean {
  return safeGetItem("session", HIDE_PRICES_SESSION_KEY) === "1"
}

export function writeHidePricesPreference(hidePrices: boolean): void {
  safeSetItem("session", HIDE_PRICES_SESSION_KEY, hidePrices ? "1" : "0")
}
