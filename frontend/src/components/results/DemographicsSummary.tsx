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
    const [aggregatedDemographics, setAggregatedDemographics] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const loadData = async () => {
            if (!backstoryIds || backstoryIds.length === 0) {
                setLoading(false)
                return
            }

            // Create a stable cache key based on sorted backstory IDs
            const rawKey = [...backstoryIds].sort().join('_')
            const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(rawKey))
                .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16))

            const cacheKey = `demo_cache_${hash}`
            const cached = sessionStorage.getItem(cacheKey)

            if (cached) {
                try {
                    setAggregatedDemographics(JSON.parse(cached))
                    setLoading(false)
                    return
                } catch (e) {
                    console.error('Error parsing cached demographics:', e)
                    sessionStorage.removeItem(cacheKey)
                }
            }

            setLoading(true)

            // Fetch demographic keys for canonical labels
            const { data: keysData } = await supabase
                .from('demographic_keys')
                .select('*')

            const { data: backstoriesData, error } = await supabase
                .from('backstories')
                .select('*')
                .in('id', backstoryIds)

            if (error) {
                console.error('Error fetching backstories for demographics:', error)
                setLoading(false)
                return
            }

            const backstories = backstoriesData as Backstory[]
            const demographicKeys = (keysData || []) as DemographicKey[]

            // Identify all unique keys present in the backstories' demographics or canonical keys
            const allKeys = new Set<string>()
            demographicKeys.forEach(dk => allKeys.add(dk.key))
            backstories.forEach(b => {
                if (b.demographics) {
                    Object.keys(b.demographics).forEach(k => allKeys.add(k))
                }
            })

            // Aggregate distributions for each key
            const result = Array.from(allKeys).map(key => {
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
                            if (value) {
                                valueCounts[value] = (valueCounts[value] || 0) + probability
                            }
                        })
                    } else if (demographicData.value) {
                        valueCounts[demographicData.value] = (valueCounts[demographicData.value] || 0) + 1
                    }
                })

                // Convert to array format for Recharts
                const distribution = Object.entries(valueCounts).map(([value, count]) => ({
                    option: value,
                    count: Math.round(count * 10) / 10,
                    percentage: Math.round((count / backstories.length) * 100)
                }))

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

            // Filter out empty results before caching
            const filteredResult = result.filter(r => r.distribution.length > 0)

            sessionStorage.setItem(cacheKey, JSON.stringify(filteredResult))
            setAggregatedDemographics(filteredResult)
            setLoading(false)
        }

        loadData()
    }, [backstoryIds])

    const columns = useMemo(() => {
        const cols: (typeof aggregatedDemographics)[] = [[], [], [], []]
        aggregatedDemographics.forEach((demo, index) => {
            cols[index % 4].push(demo)
        })
        return cols
    }, [aggregatedDemographics])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    if (!aggregatedDemographics || aggregatedDemographics.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">No demographic data available.</p>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
            {columns.map((column, colIndex) => (
                <div key={colIndex} className="grid gap-4 h-fit">
                    {column.map((demo) => (
                        <Card key={demo.key} className="h-auto">
                            <CardHeader className="p-4 pb-2">
                                <CardTitle className="text-base font-medium">
                                    {demo.displayName}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 pt-0">
                                <DistributionChart
                                    distribution={demo.distribution}
                                    colors={colors}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ))}
        </div>
    )
}
