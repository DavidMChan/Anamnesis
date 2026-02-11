import { Link, Navigate } from 'react-router-dom'
import { useAuthContext } from '@/contexts/AuthContext'
import { PublicLayout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Typewriter } from '@/components/ui/typewriter'
import { ArrowRight, Sparkles, Users, FileQuestion, BarChart3 } from 'lucide-react'

const HERO_WORDS = [
  'perspectives',
  'demographics',
  'generations',
  'cultures',
  'beliefs',
  'backgrounds',
]

export function Home() {
  const { user } = useAuthContext()

  // Redirect logged-in users to surveys (don't wait for loading - that can hang)
  if (user) {
    return <Navigate to="/surveys" replace />
  }

  return (
    <PublicLayout>
      <div className="min-h-screen">
        {/* Navigation Bar */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="container max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
                <img
                  src="https://bair.berkeley.edu/logos/BAIR_Logo_Blue_BearOnly.svg"
                  alt="BAIR Logo"
                  className="h-6 w-6"
                />
              </div>
              <span className="font-semibold">Survey Arena</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link to="/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link to="/register">
                <Button>Get Started</Button>
              </Link>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="pt-32 pb-16 px-4">
          <div className="container max-w-4xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              BAIR Lab @ UC Berkeley
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
              Understand how your questions
              <br className="hidden sm:block" />
              resonate across{' '}
              <Typewriter
                phrases={HERO_WORDS}
                className="text-primary"
                typingSpeed={70}
                deletingSpeed={40}
                pauseDuration={2500}
              />
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
              Run surveys on AI-generated personas with diverse backstories.
              Get insights into how different demographics might respond.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link to="/register">
                <Button size="lg" className="w-full sm:w-auto gap-2">
                  Start Free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* How It Works - Steps */}
        <section className="py-20 px-4 bg-muted/30 overflow-hidden">
          <div className="container max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4">How it works</h2>
              <p className="text-muted-foreground">Three simple steps to get insights</p>
            </div>

            {/* Steps */}
            <div className="grid md:grid-cols-3 gap-8">
              {/* Step 1 */}
              <div
                className="relative flex flex-col items-center text-center group animate-fade-in-up"
                style={{ animationDelay: '0ms' }}
              >
                {/* Connector line to next step */}
                <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-primary/40 to-primary/10" />

                <div className="relative z-10 h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-5 shadow-lg group-hover:scale-105 group-hover:shadow-xl transition-all duration-300">
                  <Users className="h-7 w-7" />
                  <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-card border-2 border-primary text-primary text-xs font-bold flex items-center justify-center">
                    1
                  </span>
                </div>
                <h3 className="font-semibold text-lg mb-2">Prepare Backstories</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[240px]">
                  Create, use, or upload backstories based on your target demographics
                </p>
              </div>

              {/* Step 2 */}
              <div
                className="relative flex flex-col items-center text-center group animate-fade-in-up"
                style={{ animationDelay: '150ms' }}
              >
                {/* Connector line to next step */}
                <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-primary/40 to-primary/10" />

                <div className="relative z-10 h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-5 shadow-lg group-hover:scale-105 group-hover:shadow-xl transition-all duration-300">
                  <FileQuestion className="h-7 w-7" />
                  <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-card border-2 border-primary text-primary text-xs font-bold flex items-center justify-center">
                    2
                  </span>
                </div>
                <h3 className="font-semibold text-lg mb-2">Create Survey</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[240px]">
                  Design your survey with multiple question types
                </p>
              </div>

              {/* Step 3 */}
              <div
                className="relative flex flex-col items-center text-center group animate-fade-in-up"
                style={{ animationDelay: '300ms' }}
              >
                <div className="relative z-10 h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-5 shadow-lg group-hover:scale-105 group-hover:shadow-xl transition-all duration-300">
                  <BarChart3 className="h-7 w-7" />
                  <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-card border-2 border-primary text-primary text-xs font-bold flex items-center justify-center">
                    3
                  </span>
                </div>
                <h3 className="font-semibold text-lg mb-2">Run & Analyze</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[240px]">
                  Execute surveys and visualize results instantly
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 px-4">
          <div className="container max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Create your free account and start exploring how different perspectives respond to your surveys.
            </p>
            <Link to="/register">
              <Button size="lg" className="gap-2">
                Create Free Account <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 px-4 border-t border-border">
          <div className="container max-w-6xl mx-auto text-center text-sm text-muted-foreground">
            <p>Survey Arena - <span className="font-medium">BAIR Lab</span>, UC Berkeley</p>
            <p className="mt-2">
              Built by{' '}
              <a
                href="https://github.com/vaclisinc"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:text-foreground transition-colors"
              >
                Song-Ze Yu
              </a>
              {' · '}
              <a
                href="https://www.linkedin.com/in/vaclis/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                LinkedIn
              </a>
            </p>
          </div>
        </footer>
      </div>
    </PublicLayout>
  )
}
