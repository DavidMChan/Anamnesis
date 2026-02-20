import { Link, Navigate } from 'react-router-dom'
import { useAuthContext } from '@/contexts/AuthContext'
import { PublicLayout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Typewriter } from '@/components/ui/typewriter'
import { ArrowRight, Sparkles, BookOpen, Database, BarChart3, LineChart, FileText, ExternalLink } from 'lucide-react'

const HERO_WORDS = [
  'demographics',
  'cultural backgrounds',
  'socioeconomic statuses',
  'life philosophies',
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
              <div className="flex h-16 w-16 items-center justify-center rounded-full">
                <img
                  src="/Anamnesis.svg"
                  alt="Anamnesis Logo"
                  className="h-16 w-16"
                />
              </div>
              <span className="font-light text-xl tracking-tight pl-4">ANAMNESIS</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link to="/about">
                <Button variant="ghost" size="sm" className="hidden sm:inline-flex">About Us</Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost" size="sm">Sign In</Button>
              </Link>
              <Link to="/register">
                <Button size="sm">Get Started</Button>
              </Link>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="pt-32 pb-16 px-4 bg-gradient-to-b from-background to-muted/20">
          <div className="container max-w-4xl mx-auto text-center space-y-8">
            <h1 className="text-4xl sm:text-5xl lg:text-5xl font-bold tracking-tight leading-tight">
              Conditioning LLMs to simulate representative<br className="hidden sm:block" /> virtual personas across<br />
              <span className="block mt-2 text-primary">
                <Typewriter
                  phrases={HERO_WORDS}
                  typingSpeed={70}
                  deletingSpeed={40}
                  pauseDuration={2500}
                />
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Anamnesis is a platform for steering LLMs to represent individual human samples with increased fidelity by grounding models in naturalistic, richly detailed backstories.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link to="/register">
                <Button size="lg" className="w-full sm:w-auto gap-2">
                  Access Platform <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/about" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full">
                  About Us
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* The Anthology Approach */}
        <section id="approach" className="py-20 px-4 bg-background">
          <div className="container max-w-5xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <h2 className="text-3xl font-bold tracking-tight">The Anamnesis Platform</h2>
                <p className="text-muted-foreground leading-relaxed">
                  A significant limitation in steering LLMs to virtual personas is the inability to approximate individual human samples using broad demographic tuples. This causes models to default to stereotypical portrayals and prevents rigorous statistical analysis like covariance.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Anamnesis tackles this by generating and utilizing massive sets of rich backstories. Through these narratives, the model captures implicit and explicit markers of personal identity, yielding nuanced survey responses rather than prototypical approximations.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-6">
                <div className="flex items-start gap-4 p-6 rounded-2xl bg-muted/50 border border-border">
                  <BookOpen className="h-8 w-8 text-primary shrink-0" />
                  <div>
                    <h3 className="font-semibold mb-2">Representative Personas</h3>
                    <p className="text-sm text-muted-foreground">Conditioning models with open-ended individual life expressions rather than simplistic variables like "25-year-old from California."</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-6 rounded-2xl bg-muted/50 border border-border">
                  <LineChart className="h-8 w-8 text-primary shrink-0" />
                  <div>
                    <h3 className="font-semibold mb-2">Empirical Fidelity</h3>
                    <p className="text-sm text-muted-foreground">Responses capture distributions matching real-world samples from Pew Research Center ATP surveys, minimizing Wasserstein distance.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works - Steps (Academic adaptation) */}
        <section className="py-20 px-4 bg-muted/30 border-y border-border">
          <div className="container max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4">Methodology</h2>
              <p className="text-muted-foreground">Simulating human baseline studies via virtual participants.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 relative">
              {/* Connector lines */}
              <div className="hidden md:block absolute top-8 left-[20%] right-[20%] h-0.5 bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20" />

              <div className="relative flex flex-col items-center text-center group">
                <div className="relative z-10 h-16 w-16 rounded-2xl bg-background border-2 border-primary text-primary flex items-center justify-center mb-5 shadow-sm transition-transform hover:scale-105">
                  <Database className="h-7 w-7" />
                </div>
                <h3 className="font-semibold text-lg mb-2">1. Backstory Generation</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[240px]">
                  Produce large-scale contextual backstories covering a diverse spectrum of demographics via LLMs.
                </p>
              </div>

              <div className="relative flex flex-col items-center text-center group">
                <div className="relative z-10 h-16 w-16 rounded-2xl bg-background border-2 border-primary text-primary flex items-center justify-center mb-5 shadow-sm transition-transform hover:scale-105">
                  <FileText className="h-7 w-7" />
                </div>
                <h3 className="font-semibold text-lg mb-2">2. Persona Conditioning</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[240px]">
                  Condition LLMs with the naturalistic narratives acting as implicit markers of social constructs.
                </p>
              </div>

              <div className="relative flex flex-col items-center text-center group">
                <div className="relative z-10 h-16 w-16 rounded-2xl bg-background border-2 border-primary text-primary flex items-center justify-center mb-5 shadow-sm transition-transform hover:scale-105">
                  <BarChart3 className="h-7 w-7" />
                </div>
                <h3 className="font-semibold text-lg mb-2">3. Alignment & Analysis</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[240px]">
                  Run surveys and match virtual personas against public opinion polling distributions for validation.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Results summary */}
        <section className="py-20 px-4 bg-background">
          <div className="container max-w-4xl mx-auto text-center space-y-8">
            <h2 className="text-3xl font-bold">Closer Approximation of Public Opinion Polls</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              When evaluated on Pew Research Center ATP survey waves, our backstory-based methodology consistently outperforms traditional prompting approaches across tested large language models. Success is quantified by minimizing error across three statistical measures:
            </p>
            <div className="pt-8 grid sm:grid-cols-3 gap-6">
              <div className="p-6 rounded-xl border border-border bg-card shadow-sm">
                <div className="text-2xl font-bold text-primary mb-2">Wasserstein Distance</div>
                <div className="text-sm text-muted-foreground font-medium">Measuring distributional representativeness</div>
              </div>
              <div className="p-6 rounded-xl border border-border bg-card shadow-sm">
                <div className="text-2xl font-bold text-primary mb-2">Frobenius Norm</div>
                <div className="text-sm text-muted-foreground font-medium">Measuring cross-response consistency</div>
              </div>
              <div className="p-6 rounded-xl border border-border bg-card shadow-sm">
                <div className="text-2xl font-bold text-primary mb-2">Cronbach’s Alpha</div>
                <div className="text-sm text-muted-foreground font-medium">Measuring internal reliability</div>
              </div>
            </div>

            {/* Research Links */}
            <div className="pt-12 mt-12 border-t border-border">
              <h3 className="text-xl font-bold mb-6">Read our research:</h3>
              <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
                <a href="https://arxiv.org/abs/2407.06576" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors border border-border">
                  <ExternalLink className="h-4 w-4 text-primary" />
                  <span className="font-medium">Anthology</span>
                </a>
                <a href="https://arxiv.org/abs/2504.11673" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors border border-border">
                  <ExternalLink className="h-4 w-4 text-primary" />
                  <span className="font-medium">Alterity</span>
                </a>
                <a href="https://arxiv.org/abs/2601.16355" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors border border-border">
                  <ExternalLink className="h-4 w-4 text-primary" />
                  <span className="font-medium">Decision Making</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 px-4 bg-primary/5 border-t border-border">
          <div className="container max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">Explore Virtual Social Sciences</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Utilize Anamnesis to conduct scalable, cost-effective, and ethical public opinion surveys on representative LLM personas.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link to="/register">
                <Button size="lg" className="gap-2">
                  Launch Platform <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 px-4 border-t border-border bg-background">
          <div className="container max-w-6xl mx-auto flex flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-6">
              <Link to="/about" className="hover:text-foreground transition-colors font-medium">
                About
              </Link>
            </div>
            <p className="text-xs">
              © {new Date().getFullYear()} Anamnesis. A platform for virtual persona simulation and survey execution.
            </p>
          </div>
        </footer>
      </div>
    </PublicLayout>
  )
}
