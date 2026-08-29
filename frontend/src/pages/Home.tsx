import { Link, Navigate } from 'react-router-dom'
import {
  ArrowRight,
  ExternalLink,
  Github,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { useAuthContext } from '@/contexts/AuthContext'
import { PublicLayout } from '@/components/layout/Layout'
import { buttonVariants } from '@/components/ui/button'
import { Typewriter } from '@/components/ui/typewriter'
import { cn } from '@/lib/utils'
import conceptDiagram from '@/assets/anamnesis.jpg'
import architectureDiagram from '@/assets/arch.png'

const HERO_WORDS = ['demographics', 'cultural backgrounds', 'socioeconomic statuses', 'life philosophies']

const ATP_RESULTS = [
  {
    conditioning: 'BIO',
    matching: 'n/a',
    wave34: '0.258',
    fro34: '1.556',
    wave92: '0.346',
    fro92: '2.078',
    wave99: '0.277',
    fro99: '1.229',
  },
  {
    conditioning: 'QA',
    matching: 'n/a',
    wave34: '0.235',
    fro34: '1.481',
    wave92: '0.392',
    fro92: '1.719',
    wave99: '0.180',
    fro99: '1.475',
  },
  {
    conditioning: 'Anamnesis',
    matching: 'max weight',
    wave34: '0.160',
    fro34: '0.837',
    wave92: '0.251',
    fro92: '1.603',
    wave99: '0.148',
    fro99: '1.026',
  },
  {
    conditioning: 'Anamnesis',
    matching: 'greedy',
    wave34: '0.147',
    fro34: '0.964',
    wave92: '0.218',
    fro92: '1.414',
    wave99: '0.139',
    fro99: '1.352',
  },
  {
    conditioning: 'Human',
    matching: '—',
    wave34: '0.057',
    fro34: '0.418',
    wave92: '0.091',
    fro92: '0.411',
    wave99: '0.081',
    fro99: '0.327',
  },
]

const PUBLICATIONS = [
  {
    title: 'Anamnesis',
    description: 'An Open-Source Platform for Large-Scale Backstory-Conditioned Survey Simulation',
    href: 'https://arxiv.org/abs/2607.10628',
  },
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
              <a href="#difference" className="transition-colors hover:text-foreground">The difference</a>
              <a href="#system" className="transition-colors hover:text-foreground">Under the hood</a>
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
                <a
                  href="https://arxiv.org/abs/2607.10628"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-3 py-1.5 text-sm font-semibold text-blue-50 transition-colors hover:border-brand-gold/60 hover:text-brand-gold"
                >
                  EMNLP 2026 Demo <span className="text-white/35" aria-hidden="true">·</span> Read the paper
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
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
                  An open-source interface for social scientists, product researchers, and NLP teams to run backstory-conditioned survey simulations.
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <Link
                    to="/register"
                    className={cn(buttonVariants({ size: 'lg' }), 'bg-brand-gold text-brand-navy shadow-none hover:bg-brand-gold/90 hover:shadow-md')}
                  >
                    Access the platform <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a
                    href="#difference"
                    className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white')}
                  >
                    See how it works
                  </a>
                </div>
              </div>

              <figure className="relative mx-auto w-full max-w-xl lg:max-w-none">
                <div className="absolute -inset-4 rounded-[2rem] border border-white/10" aria-hidden="true" />
                <div className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-[0_30px_80px_rgb(0_0_0_/_0.28)] sm:p-6">
                  <div className="mb-4 border-b border-slate-200 pb-3 text-left text-xs font-semibold text-slate-500">
                    <span>The idea in one glance</span>
                  </div>
                  <img
                    src={conceptDiagram}
                    alt="Diagram showing an LLM conditioned into multiple distinct personas whose virtual opinions are compared with a human study"
                    width="642"
                    height="376"
                    className="h-auto w-full"
                  />
                </div>
              </figure>
            </div>
          </section>

          <section id="difference" className="scroll-mt-18 border-b border-border bg-background px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">How Anamnesis differs</p>
                <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
                  Random labels don’t reproduce real populations.
                </h2>
              </div>

              <figure className="mt-12 grid overflow-hidden rounded-3xl border border-border bg-white shadow-sm lg:grid-cols-2">
                <div className="flex flex-col p-6 sm:p-10">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-xl font-semibold text-slate-900">Typical approach</h3>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Top-down</span>
                  </div>
                  <div className="mt-10 flex flex-col items-center" aria-label="Many random combinations of demographic attributes are each expanded into a story, creating a synthetic persona pool">
                    <div className="flex flex-wrap justify-center gap-2">
                      {['Age: 42', 'Gender: Woman', 'Education: College', 'Politics: Independent', 'Income: $50–75K', 'Region: Midwest'].map((label) => (
                        <span key={label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 shadow-sm">
                          {label}
                        </span>
                      ))}
                    </div>
                    <span className="my-3 text-xl text-slate-300" aria-hidden="true">↓</span>
                    <div className="grid w-full max-w-md grid-cols-3 gap-2" aria-label="Multiple generated personas">
                      {[
                        'I’m a 42-year-old college-educated woman.',
                        'I’m an Independent woman from the Midwest.',
                        'I’m a college graduate earning $50–75K.',
                      ].map((story) => (
                        <div key={story} className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-center">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-500">
                            <UserRound className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="mt-2 text-xs font-medium leading-4 text-slate-500">“{story}”</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="mx-auto mt-auto max-w-sm pt-8 text-center text-sm font-medium leading-6 text-slate-600">
                    Random combinations do not reproduce the joint distribution of a real population.
                  </p>
                </div>

                <div className="flex flex-col border-t border-border bg-blue-50/60 p-6 sm:p-10 lg:border-l lg:border-t-0">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-xl font-semibold text-brand-navy">Anamnesis</h3>
                    <span className="rounded-full bg-brand-navy px-3 py-1 text-xs font-semibold text-white">Bottom-up</span>
                  </div>
                  <div className="relative mt-10 rounded-2xl border border-blue-200 bg-blue-50/40 px-4 pb-5 pt-7 sm:px-5" aria-label="Anthology algorithm: sample many narratives from an open-ended prompt, then survey their demographics">
                    <span className="absolute -top-3 left-4 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-brand-blue">
                      Anthology algorithm
                    </span>
                    <div className="flex flex-col items-center">
                      <div className="rounded-md border border-blue-200 bg-white px-4 py-2 font-mono text-xs text-brand-navy shadow-sm">
                        “Tell me about yourself.”
                      </div>
                      <span className="my-3 text-xl text-brand-blue" aria-hidden="true">↓</span>
                      <div className="relative grid w-full max-w-md grid-cols-3 gap-2" aria-label="Multiple sampled narrative personas">
                        <Sparkles className="absolute -right-3 -top-3 z-10 h-7 w-7 rounded-full bg-brand-gold p-1.5 text-brand-navy" aria-hidden="true" />
                        {[
                          'Family restaurant',
                          'Transit mechanic',
                          'Raised by grandmother',
                        ].map((story) => (
                          <div key={story} className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-blue-200 bg-white px-2 py-3 text-center shadow-sm">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-navy text-white">
                              <UserRound className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <span className="mt-2 text-xs font-medium leading-4 text-brand-navy">{story}</span>
                          </div>
                        ))}
                      </div>
                      <span className="my-3 text-xl text-brand-blue" aria-hidden="true">↓</span>
                      <div className="rounded-lg bg-brand-navy px-4 py-2 text-xs font-semibold text-white">
                        Demographic survey
                      </div>
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {['Age', 'Gender', 'Education', 'Politics'].map((label) => (
                          <span key={label} className="rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-navy">{label}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="mx-auto mt-auto max-w-sm pt-8 text-center text-sm font-semibold leading-6 text-brand-navy">
                    The narratives define the people; demographics are used afterward for sampling.
                  </p>
                </div>
                <figcaption className="sr-only">
                  Typical methods randomly combine demographic labels and invent personas. Anthology samples narrative backstories first; Anamnesis then uses demographic annotations to match personas to a target population.
                </figcaption>
              </figure>
            </div>
          </section>

          <section id="system" className="scroll-mt-18 bg-background px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
                <div>
                  <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Under the hood</h2>
                  <p className="mt-4 max-w-[50ch] text-pretty leading-7 text-muted-foreground">
                    Anthology generates the backstories. Anamnesis samples them, runs the survey, and analyzes the responses.
                  </p>
                </div>
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
              </figure>
            </div>
          </section>

          <section id="evidence" className="scroll-mt-18 border-y border-slate-200 bg-[#eef3f5] px-4 py-20 text-brand-navy sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-blue">Evidence map</p>
                  <h2 className="mt-3 max-w-[20ch] text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
                    Validated against human survey distributions.
                  </h2>
                </div>
                <p className="max-w-[58ch] text-pretty text-base leading-7 text-slate-600 lg:justify-self-end">
                  We compare simulated and human response patterns across three survey waves. Every annotation below is anchored to the exact source, topic, or metric it describes.
                </p>
              </div>

              <figure className="mt-14">
                <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center md:gap-5">
                  <div className="shrink-0">
                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-brand-blue">Study population</p>
                    <h3 className="mt-1 font-mono text-lg font-bold tracking-[-0.04em] text-brand-navy sm:text-xl">American Trends Panel</h3>
                  </div>
                  <span className="relative hidden h-px flex-1 bg-brand-blue/45 sm:block" aria-hidden="true">
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-brand-blue" />
                  </span>
                  <p className="max-w-md border border-dashed border-brand-blue/55 bg-white/65 px-4 py-3 text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">
                    Pew Research Center questionnaires answered by U.S. adults, paired with respondent demographics.
                  </p>
                </div>

                <p className="mb-3 font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] text-brand-blue sm:hidden">
                  Swipe to trace every annotation →
                </p>
                <div className="overflow-x-auto pb-3">
                  <div className="min-w-[73rem]">
                    <div className="relative z-30 mr-[16rem] grid grid-cols-[11rem_8rem_repeat(3,minmax(0,1fr))]">
                      <div />
                      <div />
                      {[
                        { wave: 'W34', topic: 'biomedical and food issues', color: '#b66046', border: 'border-[#b66046]/55', text: 'text-[#8f402d]' },
                        { wave: 'W92', topic: 'political typology', color: '#376f91', border: 'border-[#376f91]/55', text: 'text-[#285d7d]' },
                        { wave: 'W99', topic: 'AI and human enhancement', color: '#4f7b68', border: 'border-[#4f7b68]/55', text: 'text-[#356451]' },
                      ].map((item) => (
                        <div key={item.wave} className="relative mx-3 flex min-h-24 items-center justify-center pb-6 text-center">
                          <div className={cn('w-full border border-dashed bg-white/70 px-3 py-2.5', item.border)}>
                            <span className={cn('font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em]', item.text)}>{item.wave}</span>
                            <span className="mt-1 block text-xs font-semibold leading-4 text-slate-700">{item.topic}</span>
                          </div>
                          <span className="absolute -bottom-[3.125rem] left-1/2 h-[4.625rem] w-px -translate-x-1/2" style={{ backgroundColor: item.color }} aria-hidden="true" />
                          <span className="absolute -bottom-[3.375rem] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-white/80" style={{ backgroundColor: item.color }} aria-hidden="true" />
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_14rem] items-start gap-8">
                      <div className="overflow-hidden border border-slate-300 bg-[#fbfcfc] shadow-[0_24px_70px_rgb(15_40_58_/_0.12)]">
                        <table className="w-full table-fixed border-collapse text-left text-sm text-slate-800">
                          <caption className="border-b border-slate-300 bg-[#173e5d] px-5 py-3 text-left font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-blue-50">
                            LLaMA-3.1-8B <span className="mx-2 text-white/35">/</span> replication results
                          </caption>
                          <colgroup>
                            <col className="w-[11rem]" />
                            <col className="w-[8rem]" />
                            <col span={6} />
                          </colgroup>
                          <thead className="text-xs text-slate-700">
                            <tr>
                              <th scope="col" rowSpan={2} className="sticky left-0 z-20 border-r border-slate-300 bg-[#f4f6f7] px-5 py-4 align-bottom font-semibold">Conditioning</th>
                              <th scope="col" rowSpan={2} className="border-r border-slate-300 bg-[#f4f6f7] px-5 py-4 align-bottom font-semibold">Matching</th>
                              <th scope="colgroup" colSpan={2} className="border-r border-[#b66046]/25 bg-[#f6eae5] px-3 py-3 text-center font-semibold text-[#7e3928]">ATP Wave 34</th>
                              <th scope="colgroup" colSpan={2} className="border-r border-[#376f91]/25 bg-[#e8f0f5] px-3 py-3 text-center font-semibold text-[#285d7d]">ATP Wave 92</th>
                              <th scope="colgroup" colSpan={2} className="bg-[#e8f1ed] px-3 py-3 text-center font-semibold text-[#356451]">ATP Wave 99</th>
                            </tr>
                            <tr className="border-t border-slate-300 bg-[#f4f6f7] font-mono">
                              <th scope="col" className="px-3 py-3 text-right font-semibold text-[#8f402d]">WD ↓</th>
                              <th scope="col" className="border-r border-slate-300 px-3 py-3 text-right font-semibold text-[#8f402d]">Fro. ↓</th>
                              <th scope="col" className="px-3 py-3 text-right font-semibold text-[#285d7d]">WD ↓</th>
                              <th scope="col" className="border-r border-slate-300 px-3 py-3 text-right font-semibold text-[#285d7d]">Fro. ↓</th>
                              <th scope="col" className="px-3 py-3 text-right font-semibold text-[#356451]">WD ↓</th>
                              <th scope="col" className="px-4 py-3 text-right font-semibold text-[#356451]">Fro. ↓</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                            {ATP_RESULTS.map((result) => (
                              <tr
                                key={`${result.conditioning}-${result.matching}`}
                                className={cn(
                                  'transition-colors hover:bg-[#edf3f6]',
                                  result.conditioning === 'Anamnesis' && 'bg-[#fff7da]',
                                  result.conditioning === 'Human' && 'border-t-2 border-slate-400 bg-[#eef1f2]',
                                  result.conditioning === 'Anamnesis' && result.matching === 'max weight' && 'border-t-2 border-slate-300',
                                )}
                              >
                                <th
                                  scope="row"
                                  className={cn(
                                    'sticky left-0 z-10 border-r border-slate-300 bg-[#fbfcfc] px-5 py-4 font-sans font-semibold',
                                    result.conditioning === 'Anamnesis' && 'bg-[#fff7da] text-[#7a5600]',
                                    result.conditioning === 'Human' && 'bg-[#eef1f2]',
                                  )}
                                >
                                  {result.conditioning}
                                </th>
                                <td className="border-r border-slate-300 px-5 py-4 font-sans text-slate-500">{result.matching}</td>
                                <td className="bg-[#b66046]/[0.035] px-3 py-4 text-right">{result.wave34}</td>
                                <td className="border-r border-slate-300 bg-[#b66046]/[0.035] px-3 py-4 text-right">{result.fro34}</td>
                                <td className="bg-[#376f91]/[0.035] px-3 py-4 text-right">{result.wave92}</td>
                                <td className="border-r border-slate-300 bg-[#376f91]/[0.035] px-3 py-4 text-right">{result.fro92}</td>
                                <td className="bg-[#4f7b68]/[0.035] px-3 py-4 text-right">{result.wave99}</td>
                                <td className="bg-[#4f7b68]/[0.035] px-4 py-4 text-right">{result.fro99}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <aside className="relative mt-[5.4rem] border-y border-r border-dashed border-brand-blue/45 bg-white/55 px-5 py-5" aria-label="Metric definitions">
                        <span className="absolute -left-7 top-5 h-px w-7 bg-brand-blue/60" aria-hidden="true" />
                        <span className="absolute -left-9 top-4 h-2 w-2 rounded-full bg-brand-blue ring-2 ring-white/80" aria-hidden="true" />
                        <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] text-brand-blue">Metrics · lower is better</p>
                        <dl className="mt-4 space-y-4 text-xs leading-5 text-slate-600">
                          <div>
                            <dt className="font-mono text-sm font-bold text-brand-navy">WD</dt>
                            <dd>Response distributions</dd>
                          </div>
                          <div>
                            <dt className="font-mono text-sm font-bold text-brand-navy">Fro.</dt>
                            <dd>Cross-question correlations</dd>
                          </div>
                        </dl>
                      </aside>
                    </div>
                  </div>
                </div>
                <figcaption className="mt-4 text-xs leading-5 text-slate-500">
                  Wasserstein distance (WD) and Frobenius norm (Fro.) compare each simulated distribution with held-out human responses.
                </figcaption>
              </figure>

              <div className="mt-16 grid gap-8 border-t border-slate-300 pt-10 md:grid-cols-[12rem_1fr] lg:mt-20">
                <h3 className="text-xl font-semibold">Read the research</h3>
                <div className="grid border-t border-slate-300 sm:grid-cols-2 sm:gap-x-10">
                  {PUBLICATIONS.map((publication) => (
                    <a
                      key={publication.title}
                      href={publication.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-h-28 items-center justify-between gap-5 border-b border-slate-300 py-5 transition-colors hover:text-brand-blue"
                    >
                      <span>
                        <span className="block font-semibold">{publication.title}</span>
                        <span className="mt-1 block text-sm leading-6 text-slate-600 group-hover:text-slate-800">{publication.description}</span>
                      </span>
                      <ExternalLink className="h-5 w-5 shrink-0 transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ))}
                </div>
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
              <a href="https://arxiv.org/abs/2607.10628" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">Research</a>
              <a href="https://github.com/DavidMChan/Anamnesis" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
                <Github className="h-4 w-4" aria-hidden="true" />
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
