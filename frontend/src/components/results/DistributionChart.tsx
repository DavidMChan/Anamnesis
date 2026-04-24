import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ErrorBar } from 'recharts'

interface DistributionChartProps {
    distribution: { option: string; count: number; percentage: number; ciLower?: number; ciUpper?: number; errorRange?: [number, number] }[]
    colors: string[]
    onRef?: (el: HTMLDivElement | null) => void
}

interface CustomTooltipProps {
    active?: boolean
    payload?: { value: number; payload: { option: string; count: number; percentage: number; ciLower?: number; ciUpper?: number; errorRange?: [number, number] } }[]
    label?: string
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload
        return (
            <div className="bg-popover text-popover-foreground border rounded-md shadow-md p-2 text-sm z-50">
                <p className="font-semibold mb-1">{data.option}</p>
                <div className="flex flex-col gap-1">
                    <p>
                        <span className="font-medium">Count:</span> {data.count}
                    </p>
                    <p>
                        <span className="font-medium">Percentage:</span> {data.percentage}%
                    </p>
                    {data.errorRange !== undefined && data.ciLower !== undefined && data.ciUpper !== undefined && (
                        <p>
                            <span className="font-medium">95% CI:</span> {data.ciLower}% - {data.ciUpper}%
                        </p>
                    )}
                </div>
            </div>
        )
    }
    return null
}

export function DistributionChart({ distribution, colors, onRef }: DistributionChartProps) {
    // Compute the height of the chart based on the number of options
    const height = distribution.length * 80 + 50

    return (
        <div ref={onRef}>
            <ResponsiveContainer width="100%" height={height}>
                <BarChart data={distribution} layout="vertical" margin={{ left: 10, right: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--color-border)" />
                    <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        stroke="var(--color-muted-foreground)"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        type="category"
                        dataKey="option"
                        width={150}
                        tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <Tooltip
                        content={<CustomTooltip />}
                        cursor={{ fill: 'var(--color-muted)', opacity: 0.1 }}
                        animationDuration={200}
                    />
                    <Bar dataKey="percentage" radius={[0, 4, 4, 0]} animationDuration={500}>
                        <ErrorBar dataKey="errorRange" direction="x" stroke="var(--color-foreground)" width={5} strokeWidth={1.5} />
                        {distribution.map((_, i) => (
                            <Cell key={i} fill={colors[i % colors.length]} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}
