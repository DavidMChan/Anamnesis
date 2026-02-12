import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import type { DemographicFilter as DemographicFilterType, DemographicKey } from '@/types/database'
import { Plus, X } from 'lucide-react'

interface DemographicFilterProps {
  value: DemographicFilterType
  onChange: (value: DemographicFilterType) => void
  /** Optional limit on number of backstories to use. undefined = use all matching */
  sampleSize?: number
  onSampleSizeChange?: (size: number | undefined) => void
}

interface ActiveFilter {
  key: string
  demographicKey: DemographicKey
}

interface CustomFilter {
  id: string
  key: string
  value: string
}

export function DemographicFilter({ value, onChange, sampleSize, onSampleSizeChange }: DemographicFilterProps) {
  const [demographicKeys, setDemographicKeys] = useState<DemographicKey[]>([])
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([])
  const [selectedKeyToAdd, setSelectedKeyToAdd] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [matchCount, setMatchCount] = useState<number | null>(null)

  useEffect(() => {
    fetchDemographicKeys()
  }, [])

  useEffect(() => {
    // Initialize active filters and custom filters from value prop
    if (demographicKeys.length > 0 && Object.keys(value).length > 0) {
      const filters: ActiveFilter[] = []
      const customs: CustomFilter[] = []

      for (const key of Object.keys(value)) {
        const dk = demographicKeys.find((d) => d.key === key)
        if (dk) {
          filters.push({ key, demographicKey: dk })
        } else if (key.startsWith('custom_')) {
          // It's a custom filter
          const filterValue = value[key]
          if (Array.isArray(filterValue) && filterValue.length > 0) {
            customs.push({
              id: key,
              key: key.replace('custom_', ''),
              value: filterValue[0] as string,
            })
          }
        }
      }
      setActiveFilters(filters)
      setCustomFilters(customs)
    }
  }, [demographicKeys])

  useEffect(() => {
    estimateMatchCount()
  }, [value])

  const fetchDemographicKeys = async () => {
    const { data, error } = await supabase
      .from('demographic_keys')
      .select('*')
      .order('display_name')

    if (error) {
      console.error('Error fetching demographic keys:', error)
    } else {
      setDemographicKeys((data as DemographicKey[]) || [])
    }
    setLoading(false)
  }

  const estimateMatchCount = async () => {
    // For now, just count all public backstories
    // TODO: Implement proper filtering query
    const { count } = await supabase
      .from('backstories')
      .select('id', { count: 'exact', head: true })
      .eq('is_public', true)

    setMatchCount(count)
  }

  const addFilter = () => {
    if (!selectedKeyToAdd) return

    const dk = demographicKeys.find((d) => d.key === selectedKeyToAdd)
    if (!dk) return

    // Check if already added
    if (activeFilters.some((f) => f.key === selectedKeyToAdd)) return

    setActiveFilters([...activeFilters, { key: selectedKeyToAdd, demographicKey: dk }])

    // Initialize the filter value
    if (dk.value_type === 'numeric') {
      onChange({ ...value, [selectedKeyToAdd]: { min: undefined, max: undefined } })
    } else {
      onChange({ ...value, [selectedKeyToAdd]: [] })
    }

    setSelectedKeyToAdd('')
  }

  const removeFilter = (key: string) => {
    setActiveFilters(activeFilters.filter((f) => f.key !== key))
    const newValue = { ...value }
    delete newValue[key]
    onChange(newValue)
  }

  const updateNumericFilter = (key: string, field: 'min' | 'max', val: string) => {
    const current = (value[key] as { min?: number; max?: number }) || {}
    const numVal = val === '' ? undefined : parseInt(val, 10)
    onChange({
      ...value,
      [key]: { ...current, [field]: numVal },
    })
  }

  const toggleEnumValue = (key: string, enumVal: string, checked: boolean) => {
    const current = (value[key] as string[]) || []
    let newArr: string[]

    if (checked) {
      newArr = [...current, enumVal]
    } else {
      newArr = current.filter((v) => v !== enumVal)
    }

    onChange({
      ...value,
      [key]: newArr.length > 0 ? newArr : undefined,
    })
  }

  const addCustomFilter = () => {
    const id = `custom_${Date.now()}`
    setCustomFilters([...customFilters, { id, key: '', value: '' }])
  }

  const updateCustomFilter = (id: string, field: 'key' | 'value', val: string) => {
    setCustomFilters(
      customFilters.map((f) => (f.id === id ? { ...f, [field]: val } : f))
    )

    // Update the value object
    const filter = customFilters.find((f) => f.id === id)
    if (filter) {
      const newValue = { ...value }
      // Remove old key if key changed
      if (field === 'key' && filter.key) {
        delete newValue[`custom_${filter.key}`]
      }
      // Set new value
      const newKey = field === 'key' ? val : filter.key
      const newVal = field === 'value' ? val : filter.value
      if (newKey && newVal) {
        newValue[`custom_${newKey}`] = [newVal]
      }
      onChange(newValue)
    }
  }

  const removeCustomFilter = (id: string) => {
    const filter = customFilters.find((f) => f.id === id)
    if (filter && filter.key) {
      const newValue = { ...value }
      delete newValue[`custom_${filter.key}`]
      onChange(newValue)
    }
    setCustomFilters(customFilters.filter((f) => f.id !== id))
  }

  const availableKeys = demographicKeys.filter(
    (dk) => !activeFilters.some((f) => f.key === dk.key)
  )

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="animate-pulse">Loading demographic options...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target Demographics</CardTitle>
        <CardDescription>
          Add filters to target specific demographics. The system will match backstories accordingly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Active filters */}
        {activeFilters.map(({ key, demographicKey }) => (
          <div key={key} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base font-semibold">{demographicKey.display_name}</Label>
              <Button variant="ghost" size="icon" onClick={() => removeFilter(key)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {demographicKey.value_type === 'numeric' && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`${key}-min`} className="text-sm text-muted-foreground">
                    Min:
                  </Label>
                  <Input
                    id={`${key}-min`}
                    type="number"
                    className="w-24"
                    value={(value[key] as { min?: number; max?: number })?.min ?? ''}
                    onChange={(e) => updateNumericFilter(key, 'min', e.target.value)}
                    placeholder="Any"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`${key}-max`} className="text-sm text-muted-foreground">
                    Max:
                  </Label>
                  <Input
                    id={`${key}-max`}
                    type="number"
                    className="w-24"
                    value={(value[key] as { min?: number; max?: number })?.max ?? ''}
                    onChange={(e) => updateNumericFilter(key, 'max', e.target.value)}
                    placeholder="Any"
                  />
                </div>
              </div>
            )}

            {demographicKey.value_type === 'enum' && demographicKey.enum_values && (
              <div className="flex flex-wrap gap-4">
                {demographicKey.enum_values.map((enumVal) => (
                  <div key={enumVal} className="flex items-center space-x-2">
                    <Checkbox
                      id={`${key}-${enumVal}`}
                      checked={((value[key] as string[]) || []).includes(enumVal)}
                      onCheckedChange={(checked) =>
                        toggleEnumValue(key, enumVal, checked as boolean)
                      }
                    />
                    <label htmlFor={`${key}-${enumVal}`} className="text-sm capitalize">
                      {enumVal.replace(/_/g, ' ')}
                    </label>
                  </div>
                ))}
              </div>
            )}

            {demographicKey.value_type === 'text' && (
              <Input
                placeholder={`Enter ${demographicKey.display_name.toLowerCase()}...`}
                value={((value[key] as string[]) || [])[0] || ''}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]: e.target.value ? [e.target.value] : undefined,
                  })
                }
              />
            )}
          </div>
        ))}

        {/* Add filter */}
        <div className="flex items-center gap-2">
          {availableKeys.length > 0 && (
            <>
              <Select value={selectedKeyToAdd} onValueChange={setSelectedKeyToAdd}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Add filter..." />
                </SelectTrigger>
                <SelectContent>
                  {availableKeys.map((dk) => (
                    <SelectItem key={dk.key} value={dk.key}>
                      {dk.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={addFilter} disabled={!selectedKeyToAdd}>
                <Plus className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button variant="outline" onClick={addCustomFilter} className="ml-auto">
            <Plus className="h-4 w-4 mr-2" />
            Custom Filter
          </Button>
        </div>

        {/* Custom filters */}
        {customFilters.map((filter) => (
          <div key={filter.id} className="border rounded-lg p-4 border-dashed">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base font-semibold">Custom Filter</Label>
              <Button variant="ghost" size="icon" onClick={() => removeCustomFilter(filter.id)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">Key</Label>
                <Input
                  placeholder="e.g., occupation"
                  value={filter.key}
                  onChange={(e) => updateCustomFilter(filter.id, 'key', e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">Value (contains)</Label>
                <Input
                  placeholder="e.g., engineer"
                  value={filter.value}
                  onChange={(e) => updateCustomFilter(filter.id, 'value', e.target.value)}
                />
              </div>
            </div>
          </div>
        ))}

        {activeFilters.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No filters added. All public backstories will be included.
          </p>
        )}

        {/* Sample Size */}
        <div className="pt-4 border-t space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Sample Size</Label>
              <p className="text-sm text-muted-foreground">
                Limit how many backstories to run (leave empty for all)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                className="w-32"
                placeholder="All"
                min={1}
                value={sampleSize ?? ''}
                onChange={(e) => {
                  const val = e.target.value
                  onSampleSizeChange?.(val === '' ? undefined : parseInt(val, 10))
                }}
              />
              {sampleSize && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSampleSizeChange?.(undefined)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Estimated matches:{' '}
            <span className="font-semibold text-foreground">
              ~{matchCount ?? 0} backstories
            </span>
            {sampleSize && matchCount && sampleSize < matchCount && (
              <span className="text-primary"> → will use {sampleSize}</span>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
