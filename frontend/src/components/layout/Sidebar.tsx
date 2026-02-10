import { Link, useLocation } from 'react-router-dom'
import { useAuthContext } from '@/contexts/AuthContext'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { Button } from '@/components/ui/button'
import {
  ClipboardList,
  BookOpen,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const mainNavItems: NavItem[] = [
  { label: 'Surveys', href: '/surveys', icon: ClipboardList },
  { label: 'Backstories', href: '/backstories', icon: BookOpen },
]

const accountNavItems: NavItem[] = [
  { label: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const { user, profile, signOut } = useAuthContext()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    // Use hard navigation to avoid ProtectedRoute redirect race condition
    window.location.href = '/'
  }

  const isActive = (href: string) => {
    if (href === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(href)
  }

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href)
    const Icon = item.icon

    return (
      <Link
        to={item.href}
        onClick={() => setIsOpen(false)}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
          active
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </Link>
    )
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 pt-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Survey Arena</span>
          <span className="text-xs text-muted-foreground">BAIR Lab</span>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-3 my-4 h-px bg-border" />

      {/* Main Navigation */}
      <div className="flex-1 space-y-1 px-3">
        <div className="mb-2">
          <span className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            MAIN
          </span>
        </div>
        {mainNavItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}

        {/* Divider */}
        <div className="!my-4 h-px bg-border" />

        <div className="mb-2">
          <span className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            ACCOUNT
          </span>
        </div>
        {accountNavItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </div>

      {/* User Section */}
      <div className="mt-auto border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          {user?.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              alt="Avatar"
              className="h-9 w-9 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="text-sm font-medium">
                {(profile?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {profile?.name || user?.user_metadata?.full_name || 'User'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.email}
            </p>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="h-8 w-8 shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        data-testid="mobile-menu-button"
        onClick={() => setIsOpen(!isOpen)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl bg-card shadow-md lg:hidden"
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-border bg-card transition-transform duration-300 lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
