interface OpenResponseListProps {
    responses?: string[]
}

export function OpenResponseList({ responses = [] }: OpenResponseListProps) {
    if (responses.length === 0) {
        return <p className="text-sm text-muted-foreground">No responses yet.</p>
    }

    return (
        <div className="space-y-2 max-h-64 overflow-y-auto">
            {responses.slice(0, 10).map((response, i) => (
                <div key={i} className="p-3 bg-muted rounded-md text-sm">
                    {response}
                </div>
            ))}
            {responses.length > 10 && (
                <p className="text-sm text-muted-foreground">
                    ...and {responses.length - 10} more responses
                </p>
            )}
        </div>
    )
}
