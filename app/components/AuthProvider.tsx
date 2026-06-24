"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "../../lib/supabaseClient"
import { isUserRole, PROFILE_SELECT, type Profile } from "../../lib/profiles"

type AuthContextType = {
  user: User | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<Profile | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      setProfile(null)
      return null
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", nextUser.id)
      .maybeSingle()

    if (error || !data) {
      setProfile(null)
      return null
    }

    const nextProfile: Profile = {
      id: data.id,
      email: data.email ?? nextUser.email ?? null,
      role: isUserRole(data.role) ? data.role : "pending",
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

    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      const nextUser = session?.user ?? null
      setUser(nextUser)
      await loadProfile(nextUser)
      setLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      await loadProfile(nextUser)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      refreshProfile,
    }),
    [user, profile, loading, refreshProfile],
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
