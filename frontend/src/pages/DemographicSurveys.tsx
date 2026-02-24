import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import type { Survey, DemographicKey, DemographicKeyStatus } from '@/types/database'
import { Plus, Eye, FlaskConical } from 'lucide-react'

const statusVariants: Record<DemographicKeyStatus, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' | 'gold'> = {
  pending: 'outline',
  running: 'info',
  finished: 'gold',
  failed: 'destructive',
}

interface DemographicSurveyRow extends Survey {
  demographic_keys: DemographicKey | null
}

export function DemographicSurveys() {
  const { user } = useAuthContext()
  const [surveys, setSurveys] = useState<DemographicSurveyRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      fetchSurveys()
    }
  }, [user])

  const fetchSurveys = async () => {
    // Query surveys with type='demographic', join demographic_keys for status
    const { data, error } = await supabase
      .from('surveys')
      .select('*, demographic_keys(*)')
      .eq('type', 'demographic')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching demographic surveys:', error)
    } else {
      setSurveys((data as DemographicSurveyRow[]) || [])
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="space-y-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Demographic Surveys</h1>
            <p className="text-muted-foreground">
              Need a demographic that doesn't exist yet? Create one here.
            </p>
          </div>
          <Link to="/demographic-surveys/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Demographic Survey
            </Button>
          </Link>
        </div>

        {surveys.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                <FlaskConical className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No demographic surveys yet</h3>
              <p className="text-muted-foreground text-sm mb-4 text-center max-w-sm">
                Define your first new demographic here!
              </p>
              <Link to="/demographic-surveys/new">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Your First Demographic Survey
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {surveys.map((survey) => {
              const dk = survey.demographic_keys
              const keyStatus = dk?.status || 'pending'

              return (
                <Card key={survey.id} interactive className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base line-clamp-1">
                        {dk?.display_name || survey.name}
                      </CardTitle>
                      <Badge variant={statusVariants[keyStatus]}>
                        {keyStatus}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs space-y-0.5">
                      <span className="block font-mono">{survey.demographic_key}</span>
                      <span className="block">
                        {dk?.value_type === 'enum'
                          ? `${dk.enum_values?.length || 0} values`
                          : dk?.value_type || 'unknown'}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col">
                    <div className="mt-auto pt-4 flex items-center gap-2 border-t border-border">
                      <Link to={`/demographic-surveys/${survey.id}`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full gap-1">
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                      </Link>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-3">
                      Created {new Date(survey.created_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
