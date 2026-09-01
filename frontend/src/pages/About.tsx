import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ExternalLink, Github, Globe2, Linkedin } from 'lucide-react'
import { useAuthContext } from '@/contexts/AuthContext'
import { PublicLayout } from '@/components/layout/Layout'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const FOUNDATION_PAPERS = [
  {
    title: 'Anthology',
    href: 'https://arxiv.org/abs/2407.06576',
  },
  {
    title: 'Alterity',
    href: 'https://arxiv.org/abs/2504.11673',
  },
  {
    title: 'Decision Making',
    href: 'https://arxiv.org/abs/2601.16355',
  },
]

const TEAM = [
  {
    name: 'Song-Ze Yu',
    role: 'Researcher/Lead Developer',
    image: 'https://vaclis.net/images/me_grad.jpg',
    imagePosition: 'object-center',
    links: [
      { label: 'Website', href: 'https://vaclis.net', icon: Globe2 },
      { label: 'GitHub', href: 'https://github.com/vaclisinc', icon: Github },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/vaclis/', icon: Linkedin },
    ],
  },
  {
    name: 'David Chan',
    role: 'Developer/Advisor',
    image: 'https://dchan.cc/assets/images/cut-3.jpeg',
    imagePosition: 'object-top',
    links: [
      { label: 'Website', href: 'https://dchan.cc', icon: Globe2 },
      { label: 'GitHub', href: 'https://github.com/DavidMChan', icon: Github },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/david-m-chan/', icon: Linkedin },
    ],
  },
]

export function About() {
  const { user } = useAuthContext()

  return (
    <PublicLayout>
      <div className="min-h-screen bg-background">
        <header className="fixed inset-x-0 top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur-md">
          <nav aria-label="Primary navigation" className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <Link to="/" className="group flex min-w-0 items-center gap-3" aria-label="Anamnesis home">
              <img src="/Anamnesis.svg" alt="" className="h-11 w-11 shrink-0 transition-transform duration-300 ease-out group-hover:-rotate-3" />
              <span className="truncate text-base font-semibold tracking-[0.08em] sm:text-lg">ANAMNESIS</span>
            </Link>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              {user ? (
                <Link to="/surveys" className={buttonVariants({ size: 'sm' })}>
                  Dashboard <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : (
                <>
                  <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Sign in</Link>
                  <Link to="/register" className={cn(buttonVariants({ size: 'sm' }), 'hidden sm:inline-flex')}>Get started</Link>
                </>
              )}
            </div>
          </nav>
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-24 pt-28 sm:px-6 sm:pt-36 lg:px-8">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to home
          </Link>

          <section aria-labelledby="team-heading">
            <h1 id="team-heading" className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Team</h1>
            <p className="mt-5 max-w-3xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">
              We care about how to simulate representative human groups using large language models.
            </p>
            <div className="mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
              {TEAM.map((member) => (
                <article key={member.name} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                  <div className="flex items-center gap-5">
                    <img
                      src={member.image}
                      alt={`${member.name}, ${member.role}`}
                      className={cn('h-24 w-24 shrink-0 rounded-full bg-muted object-cover sm:h-28 sm:w-28', member.imagePosition)}
                    />
                    <div className="min-w-0">
                      <h2 className="text-2xl font-semibold tracking-tight">{member.name}</h2>
                      <p className="mt-1 text-muted-foreground">{member.role}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {member.links.map(({ label, href, icon: Icon }) => (
                      <a
                        key={label}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {label}
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-16 border-t border-border pt-10 sm:mt-20 sm:pt-12" aria-labelledby="affiliation-heading">
            <h2 id="affiliation-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Affiliation</h2>
            <div className="mt-6 flex items-center gap-4 rounded-2xl border border-border bg-muted/25 p-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
                <img src="https://bair.berkeley.edu/logos/BAIR_Logo_Blue_BearOnly.svg" alt="BAIR" className="h-8 w-8" />
              </span>
              <div>
                <h3 className="font-semibold">Berkeley Artificial Intelligence Research</h3>
                <p className="mt-1 text-sm text-muted-foreground">University of California, Berkeley</p>
              </div>
            </div>
          </section>

          <section className="mt-16 border-t border-border pt-10 sm:mt-20 sm:pt-12" aria-labelledby="research-heading">
            <h2 id="research-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Research</h2>
            <a
              href="https://arxiv.org/abs/2607.10628"
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 flex flex-col justify-between gap-8 rounded-2xl bg-brand-navy p-6 text-white transition-transform duration-200 hover:-translate-y-0.5 sm:flex-row sm:items-end sm:p-8"
            >
              <span>
                <span className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-gold">EMNLP 2026 Demo</span>
                <span className="mt-3 block max-w-2xl text-2xl font-semibold leading-tight sm:text-3xl">
                  Anamnesis: An Open-Source Platform for Large-Scale Backstory-Conditioned Survey Simulation
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-blue-50 group-hover:text-brand-gold">
                Read paper <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </span>
            </a>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>Research foundations:</span>
              {FOUNDATION_PAPERS.map((paper) => (
                <a
                  key={paper.title}
                  href={paper.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {paper.title} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>

          <section className="mt-16 border-t border-border pt-10 sm:mt-20 sm:pt-12" aria-labelledby="open-source-heading">
            <h2 id="open-source-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Open source</h2>
            <a
              href="https://github.com/DavidMChan/Anamnesis"
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 flex items-center justify-between gap-5 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:text-primary sm:p-6"
            >
              <span>
                <span className="block font-semibold">DavidMChan/Anamnesis</span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  Browse the code, file an issue, or contribute on GitHub.
                </span>
              </span>
              <Github className="h-6 w-6 shrink-0" aria-hidden="true" />
            </a>
          </section>

        </main>
      </div>
    </PublicLayout>
  )
}
