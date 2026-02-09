import { Link } from 'react-router-dom'
import { useAuthContext } from '@/contexts/AuthContext'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ClipboardList, BookOpen, Zap, Users } from 'lucide-react'

export function Home() {
  const { user } = useAuthContext()

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">Virtual Personas Arena</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Create surveys and run them on AI-generated personas to understand how different
            demographics might respond to your questions.
          </p>
          {!user && (
            <div className="flex gap-4 justify-center">
              <Link to="/register">
                <Button size="lg">Get Started</Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline">
                  Sign In
                </Button>
              </Link>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <ClipboardList className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Create Surveys</CardTitle>
              <CardDescription>
                Build surveys with multiple question types: multiple choice, multi-select,
                open response, and ranking questions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Multiple choice questions</li>
                <li>- Multi-select options</li>
                <li>- Open-ended responses</li>
                <li>- Ranking questions</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Users className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Target Demographics</CardTitle>
              <CardDescription>
                Filter backstories by demographic characteristics to understand how different
                groups might respond.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Age ranges</li>
                <li>- Gender</li>
                <li>- Political affiliation</li>
                <li>- Education level</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <BookOpen className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Upload Backstories</CardTitle>
              <CardDescription>
                Contribute your own backstories to the pool or keep them private for your
                own research.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Upload custom backstories</li>
                <li>- Public or private visibility</li>
                <li>- Custom demographic tagging</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Zap className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Run & Analyze</CardTitle>
              <CardDescription>
                Execute surveys using your preferred LLM and analyze results with built-in
                visualization and CSV export.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Real-time progress tracking</li>
                <li>- Distribution visualizations</li>
                <li>- CSV export for analysis</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {user && (
          <div className="flex gap-4 justify-center pt-4">
            <Link to="/surveys">
              <Button size="lg">Go to My Surveys</Button>
            </Link>
            <Link to="/backstories">
              <Button size="lg" variant="outline">
                My Backstories
              </Button>
            </Link>
          </div>
        )}
      </div>
    </Layout>
  )
}
