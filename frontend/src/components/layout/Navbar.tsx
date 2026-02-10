import { Link, useNavigate } from 'react-router-dom'
import { useAuthContext } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { ClipboardList, BookOpen, Settings, LogOut, User } from 'lucide-react'

export function Navbar() {
  const { user, profile, signOut } = useAuthContext()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    // Use hard navigation to avoid ProtectedRoute redirect race condition
    window.location.href = '/'
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 flex">
          <Link to="/" className="mr-6 flex items-center space-x-2">
            <span className="font-bold text-xl">Virtual Personas</span>
          </Link>
        </div>

        {user && (
          <nav className="flex items-center space-x-6 text-sm font-medium">
            <Link
              to="/surveys"
              className="flex items-center space-x-1 transition-colors hover:text-foreground/80 text-foreground/60"
            >
              <ClipboardList className="h-4 w-4" />
              <span>My Surveys</span>
            </Link>
            <Link
              to="/backstories"
              className="flex items-center space-x-1 transition-colors hover:text-foreground/80 text-foreground/60"
            >
              <BookOpen className="h-4 w-4" />
              <span>My Backstories</span>
            </Link>
          </nav>
        )}

        <div className="flex flex-1 items-center justify-end space-x-2">
          {user ? (
            <>
              <Link to="/settings">
                <Button variant="ghost" size="icon">
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>{profile?.name || user.email}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <Link to="/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link to="/register">
                <Button>Sign Up</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
