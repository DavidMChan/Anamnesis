import { Button } from '@/components/ui/button'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import type { Survey, SurveyRun } from '@/types/database'
import { getModelName } from '@/lib/llmConfig'

interface ResultsHeroProps {
    survey: Survey
    run?: SurveyRun | null
    totalResponses: number
    onBack: () => void
    onDownloadCSV: () => void
    isDownloadingCSV?: boolean
}

export function ResultsHero({ survey, run, totalResponses, onBack, onDownloadCSV, isDownloadingCSV }: ResultsHeroProps) {
    const modelName = run ? getModelName(run.llm_config) : undefined

    return (
        <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
                <h1 className="text-3xl font-bold">{survey.name || 'Untitled Survey'} - Results</h1>
                <p className="text-muted-foreground">
                    {totalResponses} responses • {survey.questions.length} questions
                    {modelName && ` • ${modelName}`}
                </p>
            </div>
            <Button onClick={onDownloadCSV} disabled={isDownloadingCSV}>
                {isDownloadingCSV
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Download className="h-4 w-4 mr-2" />}
                {isDownloadingCSV ? 'Downloading...' : 'Download CSV'}
            </Button>
        </div>
    )
}
