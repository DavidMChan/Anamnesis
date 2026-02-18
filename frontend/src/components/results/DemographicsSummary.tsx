import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DistributionChart } from '@/components/results/DistributionChart'
import type { Backstory, DemographicKey } from '@/types/database'
import { useMemo, useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface DemographicsSummaryProps {
    backstoryIds: string[]
    colors: string[]
}

export function DemographicsSummary({ backstoryIds, colors }: DemographicsSummaryProps) {
    const [backstories, setBackstories] = useState<Backstory[]>([])
    const [demographicKeys, setDemographicKeys] = useState<DemographicKey[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const loadData = async () => {
            setLoading(true)

            // Fetch demographic keys for canonical labels
            const { data: keysData } = await supabase
                .from('demographic_keys')
                .select('*')

            if (keysData) {
                setDemographicKeys(keysData as DemographicKey[])
            }

            if (!backstoryIds || backstoryIds.length === 0) {
                setLoading(false)
                return
            }

            const { data, error } = await supabase
                .from('backstories')
                .select('*')
                .in('id', backstoryIds)

            if (error) {
                console.error('Error fetching backstories for demographics:', error)
            } else {
                setBackstories(data as Backstory[])
            }
            setLoading(false)
        }

        loadData()
    }, [backstoryIds])
    const aggregatedDemographics = useMemo(() => {
        if (!backstories || backstories.length === 0) return []

        // 1. Identify all unique keys present in the backstories' demographics or canonical keys
        const allKeys = new Set<string>()
        demographicKeys.forEach(dk => allKeys.add(dk.key))
        backstories.forEach(b => {
            if (b.demographics) {
                Object.keys(b.demographics).forEach(k => allKeys.add(k))
            }
        })

        // 2. Aggregate distributions for each key
        return Array.from(allKeys).map(key => {
            const valueCounts: Record<string, number> = {}
            const keyInfo = demographicKeys.find(dk => dk.key === key)

            // Pre-populate with canonical enum values if available
            if (keyInfo?.enum_values) {
                keyInfo.enum_values.forEach(val => {
                    valueCounts[val] = 0
                })
            }

            backstories.forEach(b => {
                const demographicData = b.demographics?.[key]
                if (!demographicData) return

                if (demographicData.distribution && Object.keys(demographicData.distribution).length > 0) {
                    Object.entries(demographicData.distribution).forEach(([value, probability]) => {
                        if (value) { // Ensure label is not empty
                            valueCounts[value] = (valueCounts[value] || 0) + probability
                        }
                    })
                } else if (demographicData.value) {
                    // Fallback to the top choice if distribution is missing
                    valueCounts[demographicData.value] = (valueCounts[demographicData.value] || 0) + 1
                }
            })

            // 3. Convert to array format for Recharts
            const distribution = Object.entries(valueCounts).map(([value, count]) => ({
                option: value,
                count: Math.round(count * 10) / 10,
                percentage: Math.round((count / backstories.length) * 100)
            }))

            // If we have canonical enum values, maintain that order, otherwise sort by count
            if (!keyInfo?.enum_values) {
                distribution.sort((a, b) => b.count - a.count)
            }

            const displayName = keyInfo?.display_name || key.replace(/^c_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

            return {
                key,
                displayName,
                distribution
            }
        })
    }, [backstories])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    if (!backstories || backstories.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">No demographic data available.</p>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {aggregatedDemographics.map((demo) => (
                <Card key={demo.key} className="h-full">
                    <CardHeader>
                        <CardTitle className="text-lg">{demo.displayName}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DistributionChart
                            distribution={demo.distribution}
                            colors={colors}
                        />
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
