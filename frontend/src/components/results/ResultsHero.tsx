import { Button } from '@/components/ui/button'
import { ArrowLeft, Download } from 'lucide-react'
import type { Survey } from '@/types/database'

interface ResultsHeroProps {
    survey: Survey
    totalResponses: number
    onBack: () => void
    onDownloadCSV: () => void
}

export function ResultsHero({ survey, totalResponses, onBack, onDownloadCSV }: ResultsHeroProps) {
    return (
        <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
                <h1 className="text-3xl font-bold">{survey.name || 'Untitled Survey'} - Results</h1>
                <p className="text-muted-foreground">
                    {totalResponses} responses • {survey.questions.length} questions
                </p>
            </div>
            <Button onClick={onDownloadCSV}>
                <Download className="h-4 w-4 mr-2" />
                Download CSV
            </Button>
        </div>
    )
}
