import { useEffect, useState, useCallback } from 'react'
import type { User as SupabaseUser, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types/database'

export type ApiKeyType = 'openrouter' | 'vllm'

interface MaskedApiKeys {
  openrouter: string | null
  vllm: string | null
}

interface AuthState {
  user: SupabaseUser | null
  profile: User | null
  session: Session | null
  loading: boolean
  maskedApiKey: string | null  // Legacy: defaults to openrouter
  maskedApiKeys: MaskedApiKeys
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
    maskedApiKey: null,
    maskedApiKeys: { openrouter: null, vllm: null },
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

  const fetchMaskedApiKey = useCallback(async (keyType?: ApiKeyType) => {
    // If no keyType specified, use legacy no-arg version (defaults to openrouter)
    const { data, error } = keyType
      ? await supabase.rpc('get_my_masked_api_key', { p_key_type: keyType })
      : await supabase.rpc('get_my_masked_api_key')

    if (error) {
      console.error(`Error fetching masked API key (${keyType || 'default'}):`, error)
      return null
    }
    return data as string | null
  }, [])

  const fetchAllMaskedApiKeys = useCallback(async (): Promise<MaskedApiKeys> => {
    const [openrouter, vllm] = await Promise.all([
      fetchMaskedApiKey('openrouter'),
      fetchMaskedApiKey('vllm'),
    ])
    return { openrouter, vllm }
  }, [fetchMaskedApiKey])

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // Set user and session immediately (don't wait for profile)
      setState((prev) => ({
        ...prev,
        user: session?.user ?? null,
        session,
        loading: false,
      }))

      // Fetch profile and masked API keys in background (don't block)
      if (session?.user) {
        fetchProfile(session.user.id).then((profile) => {
          setState((prev) => ({ ...prev, profile }))
        })
        fetchAllMaskedApiKeys().then((maskedApiKeys) => {
          setState((prev) => ({
            ...prev,
            maskedApiKey: maskedApiKeys.openrouter,
            maskedApiKeys,
          }))
        })
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // Set user and session immediately (don't wait for profile)
      setState((prev) => ({
        ...prev,
        user: session?.user ?? null,
        session,
        loading: false,
      }))

      // Fetch profile and masked API keys in background (don't block)
      if (session?.user) {
        fetchProfile(session.user.id).then((profile) => {
          setState((prev) => ({ ...prev, profile }))
        })
        fetchAllMaskedApiKeys().then((maskedApiKeys) => {
          setState((prev) => ({
            ...prev,
            maskedApiKey: maskedApiKeys.openrouter,
            maskedApiKeys,
          }))
        })
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile, fetchAllMaskedApiKeys])

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

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
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

  const storeApiKey = async (apiKey: string, keyType: ApiKeyType = 'openrouter') => {
    if (!state.user) return { error: new Error('Not authenticated'), success: false }

    const { data, error } = await supabase.rpc('store_my_api_key', {
      p_key_type: keyType,
      p_api_key: apiKey,
    })

    if (error) {
      console.error(`Error storing API key (${keyType}):`, error)
      return { error, success: false }
    }

    // Refresh masked API keys after storing
    const maskedApiKeys = await fetchAllMaskedApiKeys()
    setState((prev) => ({
      ...prev,
      maskedApiKey: maskedApiKeys.openrouter,
      maskedApiKeys,
    }))

    return { error: null, success: data === true }
  }

  const clearApiKey = async (keyType: ApiKeyType = 'openrouter') => {
    if (!state.user) return { error: new Error('Not authenticated'), success: false }

    const { data, error } = await supabase.rpc('delete_my_api_key', {
      p_key_type: keyType,
    })

    if (error) {
      console.error(`Error clearing API key (${keyType}):`, error)
      return { error, success: false }
    }

    // Refresh masked API keys after clearing
    const maskedApiKeys = await fetchAllMaskedApiKeys()
    setState((prev) => ({
      ...prev,
      maskedApiKey: maskedApiKeys.openrouter,
      maskedApiKeys,
    }))

    return { error: null, success: data === true }
  }

  const refreshMaskedApiKeys = async () => {
    const maskedApiKeys = await fetchAllMaskedApiKeys()
    setState((prev) => ({
      ...prev,
      maskedApiKey: maskedApiKeys.openrouter,
      maskedApiKeys,
    }))
    return maskedApiKeys
  }

  return {
    user: state.user,
    profile: state.profile,
    session: state.session,
    loading: state.loading,
    maskedApiKey: state.maskedApiKey,
    maskedApiKeys: state.maskedApiKeys,
    signIn,
    signUp,
    signOut,
    signInWithGoogle,
    updateProfile,
    storeApiKey,
    clearApiKey,
    refreshMaskedApiKeys,
  }
}
