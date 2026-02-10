import type { ReactNode } from 'react'
import { SidebarLayout } from './SidebarLayout'
import { ThemeProvider } from '@/components/ui/theme-toggle'

interface LayoutProps {
  children: ReactNode
}

// Layout for authenticated pages with sidebar
export function Layout({ children }: LayoutProps) {
  return <SidebarLayout>{children}</SidebarLayout>
}

// Layout for public pages (login, register, home)
export function PublicLayout({ children }: LayoutProps) {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background">
        {children}
      </div>
    </ThemeProvider>
  )
}
