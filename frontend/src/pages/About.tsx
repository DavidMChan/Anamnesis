import { Link } from 'react-router-dom'
import { useAuthContext } from '@/contexts/AuthContext'
import { PublicLayout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { ExternalLink, Github, Linkedin, ArrowRight } from 'lucide-react'

export function About() {
    const { user } = useAuthContext()

    return (
        <PublicLayout>
            <div className="min-h-screen pb-20">
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
                            {user ? (
                                <Link to="/surveys">
                                    <Button size="sm" className="gap-1">
                                        Dashboard <ArrowRight className="h-3 w-3" />
                                    </Button>
                                </Link>
                            ) : (
                                <>
                                    <Link to="/login">
                                        <Button variant="ghost" size="sm">Sign In</Button>
                                    </Link>
                                    <Link to="/register">
                                        <Button size="sm">Get Started</Button>
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                </nav>

                {/* Content Section */}
                <div className="pt-32 px-4 container max-w-3xl mx-auto space-y-12">

                    <section className="space-y-4">
                        <h1 className="text-4xl font-bold tracking-tight">About Anamnesis</h1>
                        <p className="text-lg text-muted-foreground leading-relaxed">
                            Anamnesis is a platform for steering Large Language Models (LLMs) to represent individual human samples with increased fidelity by grounding models in naturalistic, richly detailed backstories.
                        </p>
                    </section>

                    {/* Research Section */}
                    <section className="space-y-6">
                        <h2 className="text-2xl font-semibold">Our Research</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            Our methodology aims to conduct scalable, cost-effective, and ethical public opinion surveys on representative LLM personas. To dive deeper into the theoretical foundations and empirical findings behind Anamnesis, please refer to our related publications:
                        </p>
                        <div className="flex flex-col gap-3">
                            <a href="https://arxiv.org/abs/2407.06576" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:bg-muted/50 transition-colors">
                                <ExternalLink className="h-5 w-5 text-primary shrink-0" />
                                <span className="font-medium">Anthology</span>
                            </a>
                            <a href="https://arxiv.org/abs/2504.11673" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:bg-muted/50 transition-colors">
                                <ExternalLink className="h-5 w-5 text-primary shrink-0" />
                                <span className="font-medium">Alterity</span>
                            </a>
                            <a href="https://arxiv.org/abs/2601.16355" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:bg-muted/50 transition-colors">
                                <ExternalLink className="h-5 w-5 text-primary shrink-0" />
                                <span className="font-medium">Decision Making</span>
                            </a>
                        </div>
                    </section>

                    {/* Creator Section */}
                    <section className="space-y-6">
                        <h2 className="text-2xl font-semibold">Team</h2>
                        <div className="p-8 rounded-2xl bg-card border border-border bg-gradient-to-br from-background to-muted/50 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                            <div className="relative z-10">
                                <h3 className="text-2xl font-bold mb-2">Song-Ze Yu</h3>
                                <p className="text-muted-foreground mb-6 max-w-lg leading-relaxed">
                                    Lead Developer
                                </p>
                                <div className="flex items-center gap-4">
                                    <a
                                        href="https://github.com/vaclisinc"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors bg-background border border-border px-4 py-2 rounded-lg hover:shadow-sm"
                                    >
                                        <Github className="h-4 w-4" />
                                        GitHub
                                    </a>
                                    <a
                                        href="https://www.linkedin.com/in/vaclis/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors bg-background border border-border px-4 py-2 rounded-lg hover:shadow-sm"
                                    >
                                        <Linkedin className="h-4 w-4" />
                                        LinkedIn
                                    </a>
                                </div>
                            </div>
                        </div>
                        <div className="p-8 rounded-2xl bg-card border border-border bg-gradient-to-br from-background to-muted/50 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                            <div className="relative z-10">
                                <h3 className="text-2xl font-bold mb-2">David Chan</h3>
                                <p className="text-muted-foreground mb-6 max-w-lg leading-relaxed">
                                    Developer / Advisor
                                </p>
                                <div className="flex items-center gap-4">
                                    <a href="https://dchan.cc"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors bg-background border border-border px-4 py-2 rounded-lg hover:shadow-sm">
                                        <ExternalLink className="h-4 w-4" />
                                        Website
                                    </a>
                                    <a
                                        href="https://github.com/DavidMChan"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors bg-background border border-border px-4 py-2 rounded-lg hover:shadow-sm"
                                    >
                                        <Github className="h-4 w-4" />
                                        GitHub
                                    </a>
                                    <a
                                        href="https://www.linkedin.com/in/david-m-chan/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors bg-background border border-border px-4 py-2 rounded-lg hover:shadow-sm"
                                    >
                                        <Linkedin className="h-4 w-4" />
                                        LinkedIn
                                    </a>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Affiliations Section */}
                    <section className="space-y-6">
                        <h2 className="text-2xl font-semibold">Research Affiliations</h2>
                        <div className="p-6 rounded-2xl bg-muted/30 border border-border space-y-8">
                            <div className="flex items-center gap-4">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm shrink-0">
                                    <img
                                        src="https://bair.berkeley.edu/logos/BAIR_Logo_Blue_BearOnly.svg"
                                        alt="BAIR Logo"
                                        className="h-8 w-8"
                                    />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">BAIR Lab</h3>
                                    <p className="text-muted-foreground">Berkeley Artificial Intelligence Research, UC Berkeley</p>
                                </div>
                            </div>
                        </div>
                    </section>

                </div>
            </div>
        </PublicLayout>
    )
}
