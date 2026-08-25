import { Link, Navigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  Database,
  ExternalLink,
  FileText,
  Github,
  LineChart,
  Users,
} from 'lucide-react'
import { useAuthContext } from '@/contexts/AuthContext'
import { PublicLayout } from '@/components/layout/Layout'
import { buttonVariants } from '@/components/ui/button'
import { Typewriter } from '@/components/ui/typewriter'
import { cn } from '@/lib/utils'
import conceptDiagram from '@/assets/anamnesis.jpg'
import architectureDiagram from '@/assets/arch.png'

const HERO_WORDS = ['demographics', 'cultural backgrounds', 'socioeconomic statuses', 'life philosophies']

const METHOD_STEPS = [
  {
    number: '01',
    icon: Database,
    title: 'Build a diverse persona pool',
    description:
      'Generate open-ended life histories that go beyond demographics to formative experiences, values, and worldview.',
    technical: 'Backstory generation and demographic annotation',
  },
  {
    number: '02',
    icon: FileText,
    title: 'Run a study with virtual participants',
    description:
      'Condition each response on a single backstory, then run the full survey across your sampled population.',
    technical: 'Persona conditioning and distributed execution',
  },
  {
    number: '03',
    icon: BarChart3,
    title: 'Compare patterns, not anecdotes',
    description:
      'Analyze response distributions and correlations, then compare them against human survey baselines where available.',
    technical: 'Distributional and covariance-aware evaluation',
  },
]

const METRICS = [
  {
    name: 'Wasserstein distance',
    meaning: 'How closely the simulated response distribution matches the human one.',
  },
  {
    name: 'Frobenius norm',
    meaning: 'How well the correlations between answers match the human data.',
  },
]

const PUBLICATIONS = [
  {
    title: 'Anthology',
    description: 'Virtual Personas for Language Models via an Anthology of Backstories',
    href: 'https://arxiv.org/abs/2407.06576',
  },
  {
    title: 'Alterity',
    description: 'Deep Binding of Language Model Virtual Personas',
    href: 'https://arxiv.org/abs/2504.11673',
  },
  {
    title: 'Decision Making',
    description: 'Identity, Cooperation and Framing Effects within Groups of Real and Simulated Humans',
    href: 'https://arxiv.org/abs/2601.16355',
  },
]

export function Home() {
  const { user } = useAuthContext()

  // Redirect logged-in users to surveys (don't wait for loading - that can hang)
  if (user) {
    return <Navigate to="/surveys" replace />
  }

  return (
    <PublicLayout>
      <div className="min-h-screen overflow-x-hidden">
        <a
          href="#main-content"
          className="fixed left-4 top-3 z-50 -translate-y-20 rounded-lg bg-background px-4 py-2 text-sm font-semibold shadow-lg transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>

        <header className="fixed inset-x-0 top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur-md">
          <nav
            aria-label="Primary navigation"
            className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
          >
            <Link to="/" className="group flex min-w-0 items-center gap-3" aria-label="Anamnesis home">
              <img
                src="/Anamnesis.svg"
                alt=""
                className="h-11 w-11 shrink-0 transition-transform duration-300 ease-out group-hover:-rotate-3"
              />
              <span className="truncate text-base font-semibold tracking-[0.08em] sm:text-lg">ANAMNESIS</span>
            </Link>

            <div className="hidden items-center gap-7 text-sm font-medium text-muted-foreground lg:flex">
              <a href="#approach" className="transition-colors hover:text-foreground">Why backstories</a>
              <a href="#method" className="transition-colors hover:text-foreground">How it works</a>
              <a href="#evidence" className="transition-colors hover:text-foreground">Evidence</a>
            </div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <Link to="/about" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}>About</Link>
              <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Sign in</Link>
              <Link to="/register" className={cn(buttonVariants({ size: 'sm' }), 'hidden sm:inline-flex')}>Get started</Link>
            </div>
          </nav>
        </header>

        <main id="main-content">
          <section className="relative overflow-hidden border-b border-border bg-brand-navy pt-18 text-white">
            <div className="pointer-events-none absolute inset-0 home-grid opacity-25" aria-hidden="true" />
            <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:px-8 lg:py-24">
              <div className="max-w-2xl">
                <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-3 py-1.5 text-sm font-medium text-blue-50">
                  <Users className="h-4 w-4 text-brand-gold" aria-hidden="true" />
                  An open-source platform for survey simulation
                </p>
                <h1 className="text-balance text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[1.06] tracking-[-0.03em]">
                  Conditioning LLMs to simulate representative virtual personas across
                  <span className="mt-2 block text-brand-gold">
                    <Typewriter
                      phrases={HERO_WORDS}
                      typingSpeed={70}
                      deletingSpeed={40}
                      pauseDuration={2500}
                    />
                  </span>
                </h1>
                <p className="mt-7 max-w-[62ch] text-pretty text-lg leading-8 text-blue-50/88 sm:text-xl">
                  Anamnesis builds each virtual participant from a full narrative backstory, so researchers can survey a diverse sample instead of reducing people to a few demographic labels.
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <Link
                    to="/register"
                    className={cn(buttonVariants({ size: 'lg' }), 'bg-brand-gold text-brand-navy shadow-none hover:bg-brand-gold/90 hover:shadow-md')}
                  >
                    Access the platform <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a
                    href="#method"
                    className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white')}
                  >
                    See how it works
                  </a>
                </div>
                <p className="mt-8 text-sm text-blue-100/72">
                  Designed for social scientists, product researchers, and NLP teams.
                </p>
              </div>

              <figure className="relative mx-auto w-full max-w-xl lg:max-w-none">
                <div className="absolute -inset-4 rounded-[2rem] border border-white/10" aria-hidden="true" />
                <div className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-[0_30px_80px_rgb(0_0_0_/_0.28)] sm:p-6">
                  <div className="mb-4 flex items-center justify-between gap-4 border-b border-slate-200 pb-3 text-left text-xs font-semibold text-slate-500">
                    <span>The idea in one glance</span>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-brand-blue">Backstory conditioning</span>
                  </div>
                  <img
                    src={conceptDiagram}
                    alt="Diagram showing an LLM conditioned into multiple distinct personas whose virtual opinions are compared with a human study"
                    width="642"
                    height="376"
                    className="h-auto w-full"
                  />
                </div>
                <figcaption className="mt-5 max-w-lg text-sm leading-6 text-blue-100/78">
                  One language model becomes many participants, each answering from a full life history rather than a short demographic prompt.
                </figcaption>
              </figure>
            </div>
          </section>

          <section aria-label="Platform flow" className="border-b border-border bg-background">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
              <p className="font-semibold text-foreground">From research question to interpretable results</p>
              <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground">
                <li>Define a sample</li>
                <li aria-hidden="true" className="text-primary">→</li>
                <li>Run virtual participants</li>
                <li aria-hidden="true" className="text-primary">→</li>
                <li>Analyze distributions</li>
              </ol>
            </div>
          </section>

          <section id="approach" className="scroll-mt-18 bg-background px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)] lg:items-start lg:gap-24">
              <div>
                <h2 className="max-w-[18ch] text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
                  People are more than a demographic profile.
                </h2>
                <div className="mt-8 max-w-[68ch] space-y-5 text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                  <p>
                    Labels like age, location, and gender can define a sample, but they cannot stand in for a person. Prompted with labels alone, models tend to fall back on stereotypical, flattened responses.
                  </p>
                  <p>
                    Anamnesis conditions models on narrative backstories instead. A life history carries context that a label cannot, and the platform runs it across a whole sample rather than one chat at a time.
                  </p>
                </div>
              </div>

              <aside className="rounded-2xl border border-border bg-muted/35 p-6 sm:p-8" aria-labelledby="research-value-heading">
                <div className="flex items-center gap-3">
                  <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
                  <h3 id="research-value-heading" className="text-xl font-semibold">What backstories add</h3>
                </div>
                <ul className="mt-7 space-y-6">
                  <li className="flex gap-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <div>
                      <p className="font-semibold">Within-group variation</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">Personas can share demographics without collapsing into one point of view.</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <div>
                      <p className="font-semibold">Coherent individual context</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">Each response stays grounded in one consistent life history.</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <div>
                      <p className="font-semibold">Sample-level analysis</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">Researchers can examine distributions and the correlations between responses across a sample.</p>
                    </div>
                  </li>
                </ul>
              </aside>
            </div>
          </section>

          <section id="method" className="scroll-mt-18 border-y border-border bg-muted/25 px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
                <div>
                  <h2 className="max-w-[18ch] text-balance text-3xl font-semibold tracking-tight sm:text-5xl">A study workflow, not a prompt trick.</h2>
                </div>
                <p className="max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
                  The platform turns backstory-conditioned simulation into a repeatable pipeline, from sampling through statistical analysis.
                </p>
              </div>

              <ol className="mt-14 border-t border-border">
                {METHOD_STEPS.map(({ number, icon: Icon, title, description, technical }) => (
                  <li key={number} className="grid gap-5 border-b border-border py-8 sm:grid-cols-[4rem_minmax(0,0.7fr)_minmax(0,1fr)] sm:gap-8 sm:py-10">
                    <span className="text-sm font-semibold tabular-nums text-primary">{number}</span>
                    <div className="flex items-start gap-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className="pt-1.5 text-xl font-semibold leading-7">{title}</h3>
                    </div>
                    <div>
                      <p className="max-w-[60ch] leading-7 text-muted-foreground">{description}</p>
                      <p className="mt-3 text-sm font-medium text-foreground">Technical layer: {technical}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="bg-background px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
                <div>
                  <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Under the hood</h2>
                  <p className="mt-4 max-w-[50ch] text-pretty leading-7 text-muted-foreground">
                    Anamnesis connects survey construction and demographic targeting to a distributed execution engine, then returns results for sample-level analysis.
                  </p>
                </div>
                <p className="text-sm leading-6 text-muted-foreground lg:text-right">
                  Reference architecture shown below · Select the image to inspect the full-resolution diagram
                </p>
              </div>

              <figure className="mt-10">
                <a
                  href={architectureDiagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-2xl border border-border bg-white p-2 shadow-sm transition-shadow duration-300 ease-out hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 sm:p-4"
                  aria-label="Open the full-resolution Anamnesis architecture diagram in a new tab"
                >
                  <img
                    src={architectureDiagram}
                    alt="Architecture diagram showing Anthology backstory generation, a 34,907-person persona database, survey construction, demographic targeting, distributed LLM execution, and result analysis"
                    width="3660"
                    height="2248"
                    loading="lazy"
                    className="h-auto w-full"
                  />
                </a>
                <figcaption className="mt-4 text-sm leading-6 text-muted-foreground">
                  System architecture from persona generation through result analysis. The execution layer scales across workers and LLM providers, and every run keeps a snapshot of its survey and sampling configuration.
                </figcaption>
              </figure>
            </div>
          </section>

          <section id="evidence" className="scroll-mt-18 border-y border-border bg-brand-navy px-4 py-20 text-white sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto grid max-w-7xl gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-24">
              <div>
                <LineChart className="h-8 w-8 text-brand-gold" aria-hidden="true" />
                <h2 className="mt-6 max-w-[18ch] text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
                  Validated against human survey distributions.
                </h2>
                <p className="mt-6 max-w-[62ch] text-pretty text-lg leading-8 text-blue-50/82">
                  On three American Trends Panel waves from the Pew Research Center, backstory-conditioned personas match the human response distribution more closely than demographic-prompting baselines, and better preserve how answers correlate.
                </p>

                <dl className="mt-10 divide-y divide-white/15 border-y border-white/15">
                  {METRICS.map((metric) => (
                    <div key={metric.name} className="grid gap-2 py-5 sm:grid-cols-[11rem_1fr] sm:gap-6">
                      <dt className="font-semibold text-white">{metric.name}</dt>
                      <dd className="text-sm leading-6 text-blue-100/76">{metric.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="lg:pt-14">
                <h3 className="text-xl font-semibold">Read the research</h3>
                <p className="mt-3 max-w-[48ch] text-sm leading-6 text-blue-100/76">
                  These papers cover the methodology, its evaluation, and the wider research program behind the platform.
                </p>
                <div className="mt-7 divide-y divide-white/15 border-y border-white/15">
                  {PUBLICATIONS.map((publication) => (
                    <a
                      key={publication.title}
                      href={publication.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-h-24 items-center justify-between gap-5 py-5 transition-colors hover:text-brand-gold"
                    >
                      <span>
                        <span className="block font-semibold">{publication.title}</span>
                        <span className="mt-1 block text-sm leading-6 text-blue-100/70 group-hover:text-blue-50">{publication.description}</span>
                      </span>
                      <ExternalLink className="h-5 w-5 shrink-0 transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="bg-background px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
              <h2 className="max-w-[20ch] text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Bring virtual participants into your research workflow.</h2>
              <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground">
                Construct a survey, target a demographic sample, run backstory-conditioned personas, and inspect the resulting distributions in one platform.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link to="/register" className={buttonVariants({ size: 'lg' })}>Get started <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                <Link to="/about" className={buttonVariants({ variant: 'outline', size: 'lg' })}>Learn about the team</Link>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-border bg-muted/25 px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-foreground">
              <img src="/Anamnesis.svg" alt="" className="h-8 w-8" />
              <span className="font-semibold tracking-[0.08em]">ANAMNESIS</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link to="/about" className="transition-colors hover:text-foreground">About</Link>
              <a href="https://arxiv.org/abs/2407.06576" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">Research</a>
              <a href="https://github.com/DavidMChan/Anamnesis" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
                <Github className="h-4 w-4" />
                GitHub
              </a>
              <span>© {new Date().getFullYear()} The Regents of the University of California</span>
            </div>
          </div>
        </footer>
      </div>
    </PublicLayout>
  )
}
