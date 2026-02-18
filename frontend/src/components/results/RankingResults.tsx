import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface RankingStat {
    option: string
    avgRank: number
    bordaScore: number
    firstPlaceCount: number
}

interface RankingResultsProps {
    rankingStats: RankingStat[]
    colors: string[]
    onRef?: (el: HTMLDivElement | null) => void
}

export function RankingResults({ rankingStats, colors, onRef }: RankingResultsProps) {
    return (
        <div className="space-y-4">
            {/* Borda Score Chart */}
            <div>
                <h4 className="text-sm font-medium mb-2 text-muted-foreground">
                    Borda Score (higher = more preferred)
                </h4>
                <div className="h-48" ref={onRef}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={rankingStats} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis
                                type="category"
                                dataKey="option"
                                width={150}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip
                                formatter={(value, name) => {
                                    if (name === 'bordaScore') return [`${value} points`, 'Borda Score']
                                    return [value, name]
                                }}
                            />
                            <Bar dataKey="bordaScore" radius={[0, 4, 4, 0]}>
                                {rankingStats.map((_, i) => (
                                    <Cell key={i} fill={colors[i % colors.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            {/* Detailed Stats Table */}
            <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted">
                        <tr>
                            <th className="text-left p-2 font-medium">Option</th>
                            <th className="text-right p-2 font-medium">Avg Rank</th>
                            <th className="text-right p-2 font-medium">Borda Score</th>
                            <th className="text-right p-2 font-medium">#1 Votes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rankingStats.map((item, i) => (
                            <tr key={item.option} className="border-t">
                                <td className="p-2 flex items-center gap-2">
                                    <span
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: colors[i % colors.length] }}
                                    />
                                    {item.option}
                                </td>
                                <td className="text-right p-2">{item.avgRank || '-'}</td>
                                <td className="text-right p-2 font-medium">{item.bordaScore}</td>
                                <td className="text-right p-2">{item.firstPlaceCount}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
