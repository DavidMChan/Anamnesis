import { useEffect, useState, useMemo, useCallback } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { supabase } from '@/lib/supabase'
import type {
  DemographicFilter as DemographicFilterType,
  DemographicKey,
  DemographicSelectionConfig,
  DemographicSelectionMode,
} from '@/types/database'
import {
  computeCrossProduct,
  defaultSlotAllocation,
  serializeGroup,
} from '@/lib/hungarianMatching'
import { Link } from 'react-router-dom'
import { Plus, X, ChevronDown, ChevronRight } from 'lucide-react'

interface DemographicFilterProps {
  value: DemographicSelectionConfig
  onChange: (value: DemographicSelectionConfig) => void
  /** Override the card description text */
  description?: string
}

interface CustomFilter {
  id: string
  key: string
  value: string
}

/** Available distribution bins discovered from backstory data per dimension */
type DiscoveredBins = Record<string, string[]>

export function DemographicFilter({ value, onChange, description }: DemographicFilterProps) {
  const [demographicKeys, setDemographicKeys] = useState<DemographicKey[]>([])
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([])
  const [loading, setLoading] = useState(true)
  const [discoveredBins, setDiscoveredBins] = useState<DiscoveredBins>({})
  const [poolSize, setPoolSize] = useState<number | null>(null)
  const [showSlotAllocation, setShowSlotAllocation] = useState(false)

  // Shorthand helpers
  const mode = value.mode
  const sampleSize = value.sample_size
  const filters = value.filters

  useEffect(() => {
    fetchDemographicKeys()
    discoverBins()
  }, [])

  useEffect(() => {
    // Initialize custom filters from value prop
    const customs: CustomFilter[] = []
    for (const key of Object.keys(filters)) {
      if (key.startsWith('custom_')) {
        const filterValue = filters[key]
        if (Array.isArray(filterValue) && filterValue.length > 0) {
          customs.push({
            id: key,
            key: key.replace('custom_', ''),
            value: filterValue[0] as string,
          })
        }
      }
    }
    if (customs.length > 0) setCustomFilters(customs)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    estimatePoolSize()
  }, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDemographicKeys = async () => {
    const { data, error } = await supabase
      .from('demographic_keys')
      .select('*')
      .eq('status', 'finished')
      .order('display_name')

    if (error) {
      console.error('Error fetching demographic keys:', error)
    } else {
      setDemographicKeys((data as DemographicKey[]) || [])
    }
    setLoading(false)
  }

  /**
   * Discover available distribution bins from actual backstory data.
   * Fetches all public backstories' demographics and collects unique
   * distribution keys per dimension.
   */
  const discoverBins = async () => {
    const { data, error } = await supabase
      .from('backstories')
      .select('demographics')
      .eq('is_public', true)
      .neq('source_type', 'anthology')

    if (error || !data) return

    const bins: DiscoveredBins = {}
    for (const row of data) {
      const demos = row.demographics as Record<string, { distribution?: Record<string, number> }> | null
      if (!demos) continue
      for (const [dimKey, dim] of Object.entries(demos)) {
        if (!dim?.distribution) continue
        if (!bins[dimKey]) bins[dimKey] = []
        for (const cat of Object.keys(dim.distribution)) {
          if (!bins[dimKey].includes(cat)) {
            bins[dimKey].push(cat)
          }
        }
      }
    }

    // Sort bins alphabetically within each dimension
    for (const key of Object.keys(bins)) {
      bins[key].sort()
    }

    setDiscoveredBins(bins)
  }

  const estimatePoolSize = async () => {
    const { count } = await supabase
      .from('backstories')
      .select('id', { count: 'exact', head: true })
      .eq('is_public', true)
      .neq('source_type', 'anthology')

    setPoolSize(count)
  }

  // --- Mode ---
  const setMode = (newMode: DemographicSelectionMode) => {
    onChange({ ...value, mode: newMode })
    setShowSlotAllocation(false)
  }

  // --- Sample size ---
  const setSampleSize = (size: number | undefined) => {
    onChange({
      ...value,
      sample_size: size ?? 0,
      // Reset slot allocation when sample size changes
      slot_allocation: undefined,
    })
  }

  // --- Filters ---
  const updateFilters = useCallback(
    (newFilters: DemographicFilterType) => {
      onChange({
        ...value,
        filters: newFilters,
        // Reset slot allocation when filters change
        slot_allocation: undefined,
      })
    },
    [value, onChange]
  )

  const toggleBinValue = (dimKey: string, bin: string, checked: boolean) => {
    const current = (filters[dimKey] as string[]) || []
    let newArr: string[]
    if (checked) {
      newArr = [...current, bin]
    } else {
      newArr = current.filter((v) => v !== bin)
    }
    updateFilters({
      ...filters,
      [dimKey]: newArr.length > 0 ? newArr : undefined,
    })
  }

  // --- Custom filters ---
  const addCustomFilter = () => {
    const id = `custom_${Date.now()}`
    setCustomFilters([...customFilters, { id, key: '', value: '' }])
  }

  const updateCustomFilter = (id: string, field: 'key' | 'value', val: string) => {
    setCustomFilters(
      customFilters.map((f) => (f.id === id ? { ...f, [field]: val } : f))
    )

    const filter = customFilters.find((f) => f.id === id)
    if (filter) {
      const newFilters = { ...filters }
      if (field === 'key' && filter.key) {
        delete newFilters[`custom_${filter.key}`]
      }
      const newKey = field === 'key' ? val : filter.key
      const newVal = field === 'value' ? val : filter.value
      if (newKey && newVal) {
        newFilters[`custom_${newKey}`] = [newVal]
      }
      updateFilters(newFilters)
    }
  }

  const removeCustomFilter = (id: string) => {
    const filter = customFilters.find((f) => f.id === id)
    if (filter && filter.key) {
      const newFilters = { ...filters }
      delete newFilters[`custom_${filter.key}`]
      updateFilters(newFilters)
    }
    setCustomFilters(customFilters.filter((f) => f.id !== id))
  }

  // --- Cross-product & slot allocation (balanced mode) ---
  const crossProduct = useMemo(() => {
    if (mode !== 'balanced') return { dimensions: [] as string[], groups: [] as Record<string, string>[] }
    return computeCrossProduct(filters)
  }, [mode, filters])

  const effectiveSlotAllocation = useMemo(() => {
    if (crossProduct.groups.length === 0 || sampleSize <= 0) return {}
    return (
      value.slot_allocation ??
      defaultSlotAllocation(crossProduct.groups, crossProduct.dimensions, sampleSize)
    )
  }, [crossProduct, sampleSize, value.slot_allocation])

  const slotSum = useMemo(() => {
    return Object.values(effectiveSlotAllocation).reduce((a, b) => a + b, 0)
  }, [effectiveSlotAllocation])

  const updateSlotCount = (groupKey: string, count: number) => {
    const newAllocation = { ...effectiveSlotAllocation, [groupKey]: Math.max(0, count) }
    onChange({
      ...value,
      slot_allocation: newAllocation,
      dimensions: crossProduct.dimensions,
    })
  }

  // --- Dimension keys to show ---
  // Show all dimensions that have discovered bins
  const dimensionsToShow = useMemo(() => {
    const allDimKeys = Object.keys(discoveredBins)
    // Merge with demographic_keys for display names
    return allDimKeys.map((key) => {
      const dk = demographicKeys.find((d) => d.key === key)
      return {
        key,
        displayName: dk?.display_name || key.replace(/^c_/, '').replace(/_/g, ' '),
        bins: discoveredBins[key] || [],
      }
    })
  }, [discoveredBins, demographicKeys])

  // --- Active filter count ---
  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).filter(
      ([key, val]) =>
        key !== '_sample_size' &&
        !key.startsWith('custom_') &&
        Array.isArray(val) &&
        val.length > 0
    ).length
  }, [filters])

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
          {description || 'Select demographic categories and a matching mode for backstory selection.'}{' '}
          <Link to="/demographic-surveys/new" className="text-primary hover:underline">
            Missing a demographic? Define your own.
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* =================== Mode Selector =================== */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Selection Mode</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as DemographicSelectionMode)}
            className="grid gap-3"
          >
            <label
              htmlFor="mode-top_k"
              className={`flex items-start gap-3 border rounded-lg p-4 cursor-pointer transition-colors ${
                mode === 'top_k' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <RadioGroupItem value="top_k" id="mode-top_k" className="mt-0.5" />
              <div className="space-y-1">
                <span className="font-medium">Top-K Probability</span>
                <p className="text-sm text-muted-foreground">
                  Best for seeing how this group responds overall.
                  Selects the K backstories most likely to match your criteria.
                  No guarantee of equal representation across selected groups.
                </p>
              </div>
            </label>
            <label
              htmlFor="mode-balanced"
              className={`flex items-start gap-3 border rounded-lg p-4 cursor-pointer transition-colors ${
                mode === 'balanced' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <RadioGroupItem value="balanced" id="mode-balanced" className="mt-0.5" />
              <div className="space-y-1">
                <span className="font-medium">Balanced Matching</span>
                <p className="text-sm text-muted-foreground">
                  Ensures every selected demographic group is represented.
                  Good for comparing responses across subgroups or simulating stratified sampling.
                </p>
              </div>
            </label>
          </RadioGroup>
        </div>

        {/* =================== Sample Size =================== */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Sample Size</Label>
              <p className="text-sm text-muted-foreground">
                Number of backstories to select
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                className="w-32"
                placeholder="e.g. 20"
                min={1}
                value={sampleSize || ''}
                onChange={(e) => {
                  const val = e.target.value
                  setSampleSize(val === '' ? undefined : parseInt(val, 10))
                }}
              />
              {sampleSize > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSampleSize(undefined)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {poolSize !== null && (
              <>
                Pool: <span className="font-semibold text-foreground">{poolSize} backstories</span>
                {sampleSize > 0 && sampleSize > poolSize && (
                  <span className="text-destructive"> — only {poolSize} available</span>
                )}
              </>
            )}
          </p>
        </div>

        {/* =================== Demographic Dimensions =================== */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Demographic Categories</Label>

          {dimensionsToShow.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No demographic distributions found in backstory data.
            </p>
          )}

          {dimensionsToShow.map(({ key, displayName, bins }) => (
            <div key={key} className="border rounded-lg p-4">
              <Label className="text-base font-semibold capitalize mb-3 block">
                {displayName}
              </Label>
              <div className="flex flex-wrap gap-3">
                {bins.map((bin) => {
                  const current = (filters[key] as string[]) || []
                  const checked = current.includes(bin)
                  return (
                    <div key={bin} className="flex items-center space-x-2">
                      <Checkbox
                        id={`${key}-${bin}`}
                        checked={checked}
                        onCheckedChange={(c) => toggleBinValue(key, bin, c as boolean)}
                      />
                      <label
                        htmlFor={`${key}-${bin}`}
                        className="text-sm capitalize cursor-pointer"
                      >
                        {bin.replace(/_/g, ' ')}
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* =================== Custom Filters =================== */}
        <div className="space-y-3">
          <Button variant="outline" onClick={addCustomFilter} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Custom Filter
          </Button>

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
                  <Label className="text-xs text-muted-foreground">Value (exact match)</Label>
                  <Input
                    placeholder="e.g., engineer"
                    value={filter.value}
                    onChange={(e) => updateCustomFilter(filter.id, 'value', e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* =================== Preview / Balanced Mode Allocation =================== */}
        <div className="pt-4 border-t space-y-3">
          {mode === 'top_k' && (
            <p className="text-sm text-muted-foreground">
              {poolSize !== null && sampleSize > 0 && (
                <>
                  {poolSize} backstories scored
                  {activeFilterCount > 0 ? ` across ${activeFilterCount} dimension${activeFilterCount > 1 ? 's' : ''}` : ''}
                  {' '}&middot; top {sampleSize} will be selected
                </>
              )}
              {(!sampleSize || sampleSize <= 0) && (
                <>Set a sample size above to select backstories.</>
              )}
            </p>
          )}

          {mode === 'balanced' && crossProduct.groups.length > 0 && sampleSize > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {crossProduct.groups.length} demographic group{crossProduct.groups.length > 1 ? 's' : ''}
                {' '}&middot; {slotSum} slots allocated
              </p>

              {crossProduct.groups.length > sampleSize && (
                <p className="text-sm text-destructive">
                  Warning: More groups ({crossProduct.groups.length}) than sample size ({sampleSize}).
                  Some groups will have 0 slots.
                </p>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSlotAllocation(!showSlotAllocation)}
                className="gap-1"
              >
                {showSlotAllocation ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Customize slot allocation
              </Button>

              {showSlotAllocation && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Group</th>
                        <th className="text-right p-3 font-medium w-24">Slots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crossProduct.groups.map((group) => {
                        const groupKey = serializeGroup(group, crossProduct.dimensions)
                        const groupLabel = crossProduct.dimensions
                          .map((d) => group[d])
                          .join(' \u00B7 ')
                        return (
                          <tr key={groupKey} className="border-b last:border-0">
                            <td className="p-3 capitalize">{groupLabel}</td>
                            <td className="p-3 text-right">
                              <Input
                                type="number"
                                className="w-20 ml-auto text-right"
                                min={0}
                                value={effectiveSlotAllocation[groupKey] ?? 0}
                                onChange={(e) =>
                                  updateSlotCount(
                                    groupKey,
                                    parseInt(e.target.value, 10) || 0
                                  )
                                }
                              />
                            </td>
                          </tr>
                        )
                      })}
                      <tr className="bg-muted/50">
                        <td className="p-3 font-medium">Total</td>
                        <td className={`p-3 text-right font-medium ${slotSum !== sampleSize ? 'text-destructive' : ''}`}>
                          {slotSum}
                          {slotSum !== sampleSize && (
                            <span className="text-xs ml-1">(must be {sampleSize})</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Best available backstory will be matched to each slot.
              </p>
            </div>
          )}

          {mode === 'balanced' && crossProduct.groups.length === 0 && activeFilterCount === 0 && (
            <p className="text-sm text-muted-foreground">
              Select demographic categories above to define groups for balanced matching.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Create a default DemographicSelectionConfig.
 */
export function defaultDemographicSelectionConfig(): DemographicSelectionConfig {
  return {
    mode: 'top_k',
    sample_size: 0,
    filters: {},
  }
}

/**
 * Convert legacy DemographicFilter to DemographicSelectionConfig.
 * Used for backward compatibility when loading old surveys.
 */
export function legacyToSelectionConfig(
  legacy: DemographicFilterType & { _sample_size?: number[] }
): DemographicSelectionConfig {
  const { _sample_size, ...filters } = legacy
  return {
    mode: 'top_k',
    sample_size: _sample_size?.[0] ?? 0,
    filters,
  }
}
