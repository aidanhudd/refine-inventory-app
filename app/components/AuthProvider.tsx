"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { AUTH_INIT_TIMEOUT_MS, withTimeout } from "../../lib/asyncUtils"
import { supabase } from "../../lib/supabaseClient"
import { isUserRole, PROFILE_SELECT, type Profile } from "../../lib/profiles"

type AuthContextType = {
  user: User | null
  profile: Profile | null
  loading: boolean
  authError: string | null
  refreshProfile: () => Promise<Profile | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profileReady, setProfileReady] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const loadProfile = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      setProfile(null)
      return null
    }

    let { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", nextUser.id)
      .maybeSingle()

    if (error) {
      console.error("[AuthProvider] profile lookup failed:", error)
    }

    if (!data && !error) {
      const ensured = await supabase.rpc("ensure_user_profile")
      if (ensured.error) {
        console.error("[AuthProvider] ensure_user_profile failed:", ensured.error)
      } else if (ensured.data) {
        data = ensured.data as typeof data
        error = null
      }
    }

    if (error || !data) {
      setProfile(null)
      return null
    }

    const nextProfile: Profile = {
      id: data.id,
      email: data.email ?? nextUser.email ?? null,
      role: isUserRole(data.role) ? data.role : "pending",
      approved: data.approved === true,
      approved_at: data.approved_at ?? null,
      approved_by: data.approved_by ?? null,
      full_name: data.full_name ?? null,
      created_at: data.created_at ?? null,
    }

    setProfile(nextProfile)
    return nextProfile
  }, [])

  const refreshProfile = useCallback(async () => loadProfile(user), [loadProfile, user])

  useEffect(() => {
    let mounted = true

    const initSession = async () => {
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_INIT_TIMEOUT_MS,
          "Supabase auth.getSession()",
        )

        if (error) {
          console.error("[AuthProvider] getSession returned error:", error)
          if (mounted) setAuthError(error.message)
        }

        if (!mounted) return

        setUser(data.session?.user ?? null)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown auth initialization error"
        console.error("[AuthProvider] session initialization failed:", error)
        if (mounted) {
          setAuthError(message)
          setUser(null)
        }
      } finally {
        if (mounted) setSessionReady(true)
      }
    }

    void initSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return

      // Never call other Supabase client methods here — it can deadlock getSession()
      // in Chromium-based browsers (Edge, Chrome).
      console.debug("[AuthProvider] auth state changed:", event)
      setUser(session?.user ?? null)
      setSessionReady(true)
      setAuthError(null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!sessionReady) return

    if (!user) {
      setProfile(null)
      setProfileReady(true)
      return
    }

    let mounted = true
    setProfileReady(false)

    void loadProfile(user)
      .catch((error) => {
        console.error("[AuthProvider] loadProfile threw:", error)
        if (mounted) setProfile(null)
      })
      .finally(() => {
        if (mounted) setProfileReady(true)
      })

    return () => {
      mounted = false
    }
  }, [user, sessionReady, loadProfile])

  const loading = !sessionReady || (!!user && !profileReady)

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      authError,
      refreshProfile,
    }),
    [user, profile, loading, authError, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider")
  }
  return context
}
