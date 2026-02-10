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
          <div className="container max-w-6xl py-6 px-4 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </ThemeProvider>
  )
}
