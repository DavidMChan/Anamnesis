import { useState } from 'react'
import { Link, useNavigate, Navigate } from 'react-router-dom'
import { useAuthContext } from '@/contexts/AuthContext'
import { PublicLayout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, CheckCircle } from 'lucide-react'

export function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const { signUp, user, loading: authLoading } = useAuthContext()
  const navigate = useNavigate()

  // Redirect logged-in users to surveys (don't wait for loading - that can hang)
  if (user) {
    return <Navigate to="/surveys" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // If already logged in, just redirect
    if (user) {
      navigate('/surveys', { replace: true })
      return
    }

    setError(null)
    setLoading(true)

    try {
      const { error } = await signUp(email, password, name)

      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        setSuccess(true)
        setTimeout(() => navigate('/surveys'), 2000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setLoading(false)
    }
  }

  if (success) {
    return (
      <PublicLayout>
        <div className="flex items-center justify-center min-h-screen px-4">
          <Card className="w-full max-w-md">
            <CardHeader className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-green-500">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-bold text-green-600">Success!</CardTitle>
                <CardDescription>
                  Your account has been created. Check your email to verify your account.
                </CardDescription>
              </div>
            </CardHeader>
            <CardFooter>
              <Link to="/login" className="w-full">
                <Button variant="outline" className="w-full">
                  Go to Login
                </Button>
              </Link>
            </CardFooter>
          </Card>
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <div className="flex items-center justify-center min-h-screen px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <BookOpen className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-2xl font-bold">Create an account</CardTitle>
              <CardDescription>
                Get started with Survey Arena
              </CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">
                  Must be at least 6 characters
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button type="submit" className="w-full" loading={loading} disabled={authLoading}>
                Create account
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                Already have an account?{' '}
                <Link to="/login" className="text-primary font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </PublicLayout>
  )
}
