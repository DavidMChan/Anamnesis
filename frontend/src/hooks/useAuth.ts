import { useEffect, useState, useCallback } from 'react'
import type { User as SupabaseUser, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types/database'

interface AuthState {
  user: SupabaseUser | null
  profile: User | null
  session: Session | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
  })

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching profile:', error)
      return null
    }
    return data as User
  }, [])

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      let profile: User | null = null
      if (session?.user) {
        profile = await fetchProfile(session.user.id)
      }
      setState({
        user: session?.user ?? null,
        profile,
        session,
        loading: false,
      })
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      let profile: User | null = null
      if (session?.user) {
        profile = await fetchProfile(session.user.id)
      }
      setState({
        user: session?.user ?? null,
        profile,
        session,
        loading: false,
      })
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error }
  }

  const signUp = async (email: string, password: string, name?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    })
    return { error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const updateProfile = async (updates: Partial<User>) => {
    if (!state.user) return { error: new Error('Not authenticated') }

    const { error } = await supabase
      .from('users')
      .update(updates as Record<string, unknown>)
      .eq('id', state.user.id)

    if (!error) {
      const profile = await fetchProfile(state.user.id)
      setState((prev) => ({ ...prev, profile }))
    }

    return { error }
  }

  return {
    user: state.user,
    profile: state.profile,
    session: state.session,
    loading: state.loading,
    signIn,
    signUp,
    signOut,
    updateProfile,
  }
}
