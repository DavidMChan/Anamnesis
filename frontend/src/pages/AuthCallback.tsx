import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Listen for auth state changes - Supabase will automatically
    // detect and process the OAuth tokens from the URL hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth event:', event, 'Session:', !!session)

      if (event === 'SIGNED_IN' && session) {
        // Successfully signed in, redirect to surveys
        navigate('/surveys', { replace: true })
      } else if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        // Ignore these events
      }
    })

    // Also check immediately if there's already a session
    // (in case the auth state change already fired)
    const checkSession = async () => {
      // Give Supabase a moment to process the URL hash
      await new Promise(resolve => setTimeout(resolve, 500))

      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        console.error('Session error:', error)
        setError(error.message)
        return
      }

      if (session) {
        navigate('/surveys', { replace: true })
      } else {
        // No session after waiting, something went wrong
        console.error('No session found after OAuth callback')
        setError('Failed to complete sign in. Please try again.')
      }
    }

    checkSession()

    return () => subscription.unsubscribe()
  }, [navigate])

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="text-primary underline"
          >
            Back to login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  )
}
