import type { Survey, SurveyResults as SurveyResultsType } from '@/types/database'

interface ResultsTableProps {
    survey: Survey
    results: SurveyResultsType
}

export function ResultsTable({ survey, results }: ResultsTableProps) {
    const resultEntries = Object.entries(results || {})
    const displayedEntries = resultEntries.slice(0, 20)

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b">
                        <th className="text-left p-2 font-medium">Backstory ID</th>
                        {survey.questions.map((q, i) => (
                            <th key={q.qkey} className="text-left p-2 font-medium">
                                Q{i + 1}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {displayedEntries.map(([backstoryId, responses]) => (
                        <tr key={backstoryId} className="border-b">
                            <td className="p-2 font-mono text-xs">
                                {backstoryId.slice(0, 8)}...
                            </td>
                            {survey.questions.map((q) => (
                                <td key={q.qkey} className="p-2">
                                    {Array.isArray(responses[q.qkey])
                                        ? (responses[q.qkey] as string[]).join(', ')
                                        : (responses[q.qkey] as string) || '-'}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {resultEntries.length > 20 && (
                <p className="text-sm text-muted-foreground mt-4">
                    Showing 20 of {resultEntries.length} responses. Download CSV for full data.
                </p>
            )}
        </div>
    )
}
