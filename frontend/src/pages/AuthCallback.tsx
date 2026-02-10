import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Parse tokens from URL hash
        const hash = window.location.hash.substring(1)
        console.log('Full hash:', hash.substring(0, 100) + '...')

        const params = new URLSearchParams(hash)

        // Check for OAuth error first
        const oauthError = params.get('error')
        const errorDescription = params.get('error_description')
        if (oauthError) {
          console.error('OAuth error:', oauthError, errorDescription)
          setError(`OAuth error: ${errorDescription || oauthError}`)
          return
        }

        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')

        console.log('OAuth callback - has access_token:', !!accessToken, 'has refresh_token:', !!refreshToken)
        console.log('access_token length:', accessToken?.length)
        console.log('refresh_token length:', refreshToken?.length)

        if (!accessToken || !refreshToken) {
          // No tokens, check if already have session
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            console.log('Already have session, redirecting')
            navigate('/surveys', { replace: true })
          } else {
            console.error('No tokens in URL and no existing session')
            setError('No authentication tokens found')
          }
          return
        }

        // Manually set the session with tokens from URL
        console.log('Setting session with tokens...')
        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (sessionError) {
          console.error('Error setting session:', sessionError)
          setError(sessionError.message)
          return
        }

        if (data.session) {
          console.log('Session set successfully, redirecting to /surveys')
          // Clear the hash from URL before navigating
          window.history.replaceState(null, '', window.location.pathname)
          navigate('/surveys', { replace: true })
        } else {
          console.error('No session after setSession')
          setError('Failed to establish session')
        }
      } catch (err) {
        console.error('Unexpected error:', err)
        setError(err instanceof Error ? err.message : 'Unexpected error')
      }
    }

    handleCallback()
  }, [navigate])

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4 max-w-md">
          <p className="text-destructive font-semibold">Sign in failed</p>
          <p className="text-sm text-muted-foreground break-all">{error}</p>
          <p className="text-xs text-muted-foreground">Check browser console for details</p>
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
