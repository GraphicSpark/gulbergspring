import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

/**
 * Holds the Supabase session, the logged-in user's `profiles` row, and the
 * effective permission map (role defaults + this user's overrides).
 *
 * `can(page, action)` is the single gate the UI uses:
 *   - super_admin  -> always allowed
 *   - inactive     -> never allowed
 *   - otherwise    -> user override (if any) else role default else denied
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [permissions, setPermissions] = useState({}) // { [page]: { [action]: bool } }
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    const { data: prof, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error || !prof) {
      setProfile(null)
      setPermissions({})
      // A real error here (expired/rotated token, missing profile row) means the
      // session is unusable - clear it so the user lands on a clean login rather
      // than a half-broken portal. PGRST116 = "no row", also unrecoverable.
      await supabase.auth.signOut()
      return
    }

    const merged = {}
    if (prof.is_active && prof.role !== 'super_admin') {
      const [{ data: roleRows }, { data: userRows }] = await Promise.all([
        supabase.from('role_permissions').select('page, action, allowed').eq('role', prof.role),
        supabase.from('user_permissions').select('page, action, allowed').eq('user_id', userId),
      ])
      for (const r of roleRows ?? []) {
        ;(merged[r.page] ??= {})[r.action] = r.allowed
      }
      for (const r of userRows ?? []) {
        ;(merged[r.page] ??= {})[r.action] = r.allowed // override wins
      }
    }

    setProfile(prof)
    setPermissions(merged)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (nextSession) {
        // Defer: calling supabase inside this callback synchronously can deadlock.
        setTimeout(() => {
          if (active) loadProfile(nextSession.user.id)
        }, 0)
      } else {
        setProfile(null)
        setPermissions({})
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(
    (email, password) => supabase.auth.signInWithPassword({ email, password }),
    [],
  )
  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const can = useCallback(
    (page, action = 'view') => {
      if (!profile || !profile.is_active) return false
      if (profile.role === 'super_admin') return true
      return permissions[page]?.[action] === true
    },
    [profile, permissions],
  )

  const value = useMemo(
    () => ({
      session,
      profile,
      permissions,
      loading,
      isAuthenticated: Boolean(session),
      isActive: Boolean(profile?.is_active),
      isSuperAdmin: profile?.role === 'super_admin',
      can,
      signIn,
      signOut,
      reloadProfile: () => (session ? loadProfile(session.user.id) : undefined),
    }),
    [session, profile, permissions, loading, can, signIn, signOut, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
