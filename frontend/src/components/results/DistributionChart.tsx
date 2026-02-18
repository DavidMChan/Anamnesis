import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface DistributionChartProps {
    distribution: { option: string; count: number; percentage: number }[]
    colors: string[]
    onRef?: (el: HTMLDivElement | null) => void
}

interface CustomTooltipProps {
    active?: boolean
    payload?: { value: number; payload: { option: string; count: number; percentage: number } }[]
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
                </div>
            </div>
        )
    }
    return null
}

export function DistributionChart({ distribution, colors, onRef }: DistributionChartProps) {
    return (
        <div className="h-64" ref={onRef}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution} layout="vertical" margin={{ left: 10, right: 10 }}>
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
                        {distribution.map((_, i) => (
                            <Cell key={i} fill={colors[i % colors.length]} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}
