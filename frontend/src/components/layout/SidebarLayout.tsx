import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { ThemeProvider } from '@/components/ui/theme-toggle'

interface SidebarLayoutProps {
  children: ReactNode
}

export function SidebarLayout({ children }: SidebarLayoutProps) {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        {/* Main content area with left margin for sidebar */}
        <main className="lg:ml-[280px] min-h-screen">
          {/* Add top padding on mobile to account for fixed menu button */}
          <div className="container max-w-screen-2xl py-6 px-4 lg:px-8 pt-16 lg:pt-6">
            {children}
          </div>
        </main>
      </div>
    </ThemeProvider>
  )
}
