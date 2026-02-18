import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { X, Plus } from 'lucide-react'
import type { DemographicKey } from '@/types/database'
import { Badge } from '@/components/ui/badge'

interface DemographicFilterProps {
    demographicKeys: DemographicKey[] | null
    selectedFilters: { key: string; value: string }[]
    onFiltersChange: (filters: { key: string; value: string }[]) => void
    onTriggerFetch: () => void
    isLoading: boolean
}

export function DemographicFilter({
    demographicKeys,
    selectedFilters,
    onFiltersChange,
    onTriggerFetch,
    isLoading,
}: DemographicFilterProps) {
    const [selectedKey, setSelectedKey] = useState<string>('')
    const [selectedValue, setSelectedValue] = useState<string>('')

    const handleKeyChange = (key: string) => {
        setSelectedKey(key)
        setSelectedValue('')
        onTriggerFetch()
    }

    const addFilter = () => {
        if (selectedKey && selectedValue) {
            const exists = selectedFilters.find((f) => f.key === selectedKey)
            if (exists) {
                // Replace existing filter for same key
                onFiltersChange(
                    selectedFilters.map((f) => (f.key === selectedKey ? { key: selectedKey, value: selectedValue } : f))
                )
            } else {
                onFiltersChange([...selectedFilters, { key: selectedKey, value: selectedValue }])
            }
            setSelectedKey('')
            setSelectedValue('')
        }
    }

    const removeFilter = (key: string) => {
        onFiltersChange(selectedFilters.filter((f) => f.key !== key))
    }

    const clearAll = () => {
        onFiltersChange([])
    }

    const currentKeyInfo = demographicKeys?.find((k) => k.key === selectedKey)
    const availableValues = currentKeyInfo?.enum_values || []

    // Filter out already selected keys from the dropdown (unless we want to allow OR logic later, but for now let's keep it simple)
    // Actually, replacing the value for a key is common, so let's allow it but highlight it.

    return (
        <div className="space-y-4 bg-muted/30 p-4 rounded-xl border border-border">
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Filter results by:</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Select value={selectedKey} onValueChange={handleKeyChange} disabled={!demographicKeys}>
                        <SelectTrigger className="w-[200px] h-9">
                            <SelectValue placeholder="Add demographic..." />
                        </SelectTrigger>
                        <SelectContent>
                            {demographicKeys?.map((dk) => (
                                <SelectItem key={dk.key} value={dk.key}>
                                    {dk.display_name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {selectedKey && (
                        <>
                            <Select
                                value={selectedValue}
                                onValueChange={setSelectedValue}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="w-[180px] h-9">
                                    <SelectValue placeholder="Select value..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableValues.map((val) => (
                                        <SelectItem key={val} value={val}>
                                            {val}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Button
                                size="sm"
                                className="h-9"
                                onClick={addFilter}
                                disabled={!selectedValue || isLoading}
                            >
                                <Plus className="h-4 w-4 mr-1" />
                                Add
                            </Button>
                        </>
                    )}

                    {selectedFilters.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearAll}
                            className="h-9 px-2 text-muted-foreground hover:text-foreground"
                        >
                            Clear all
                        </Button>
                    )}

                    {isLoading && (
                        <div className="flex items-center gap-2 ml-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                            <span className="text-xs text-muted-foreground">Loading...</span>
                        </div>
                    )}
                </div>
            </div>

            {selectedFilters.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
                    {selectedFilters.map((filter) => {
                        const keyInfo = demographicKeys?.find((k) => k.key === filter.key)
                        return (
                            <Badge key={filter.key} variant="secondary" className="pl-3 pr-1 py-1 h-7 text-sm gap-1">
                                <span className="text-muted-foreground">{keyInfo?.display_name || filter.key}:</span>
                                <span className="font-semibold">{filter.value}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 ml-1 hover:bg-muted-foreground/20 rounded-full"
                                    onClick={() => removeFilter(filter.key)}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </Badge>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
