import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth'

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [member, setMember] = useState(null)
  const [ready, setReady] = useState(false)
  const [recovering, setRecovering] = useState(false)

  const loadMember = useCallback(async (user) => {
    if (!user) {
      setMember(null)
      return
    }
    const { data } = await supabase.from('members').select('*').eq('id', user.id).maybeSingle()
    setMember(data)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadMember(data.session?.user)
      if (alive) setReady(true)
    })
    // Keep this callback synchronous — awaiting Supabase inside it can stall sign-in.
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(nextSession)
      setTimeout(() => loadMember(nextSession?.user), 0)
    })
    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [loadMember])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    member,
    ready,
    recovering,
    finishRecovery: () => setRecovering(false),
    isAdmin: member?.role === 'admin' && member?.status === 'active',
    refreshMember: () => loadMember(session?.user),
    signOut: () => supabase.auth.signOut(),
  }), [session, member, ready, recovering, loadMember])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
