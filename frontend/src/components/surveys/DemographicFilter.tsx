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
}

interface ActiveFilter {
  key: string
  demographicKey: DemographicKey
}

export function DemographicFilter({ value, onChange }: DemographicFilterProps) {
  const [demographicKeys, setDemographicKeys] = useState<DemographicKey[]>([])
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])
  const [selectedKeyToAdd, setSelectedKeyToAdd] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [matchCount, setMatchCount] = useState<number | null>(null)

  useEffect(() => {
    fetchDemographicKeys()
  }, [])

  useEffect(() => {
    // Initialize active filters from value prop
    if (demographicKeys.length > 0 && Object.keys(value).length > 0) {
      const filters: ActiveFilter[] = []
      for (const key of Object.keys(value)) {
        const dk = demographicKeys.find((d) => d.key === key)
        if (dk) {
          filters.push({ key, demographicKey: dk })
        }
      }
      setActiveFilters(filters)
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
        {availableKeys.length > 0 && (
          <div className="flex items-center gap-2">
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
          </div>
        )}

        {activeFilters.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No filters added. All public backstories will be included.
          </p>
        )}

        <div className="pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            Estimated matches:{' '}
            <span className="font-semibold text-foreground">
              ~{matchCount ?? 0} backstories
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
