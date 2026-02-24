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
import { ChevronDown, ChevronRight, X } from 'lucide-react'

interface DemographicFilterProps {
  value: DemographicSelectionConfig
  onChange: (value: DemographicSelectionConfig) => void
  /** Override the card description text */
  description?: string
}

export function DemographicFilter({ value, onChange, description }: DemographicFilterProps) {
  const [demographicKeys, setDemographicKeys] = useState<DemographicKey[]>([])
  const [loading, setLoading] = useState(true)
  const [poolSize, setPoolSize] = useState<number | null>(null)
  const [showSlotAllocation, setShowSlotAllocation] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [showAlgorithm, setShowAlgorithm] = useState(false)

  // Shorthand helpers
  const mode = value.mode
  const sampleSize = value.sample_size
  const filters = value.filters

  useEffect(() => {
    fetchDemographicKeys()
  }, [])

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
      slot_allocation: undefined,
    })
  }

  // --- Filters ---
  const updateFilters = useCallback(
    (newFilters: DemographicFilterType) => {
      // Clean up: remove keys with undefined/empty values
      const cleaned: DemographicFilterType = {}
      for (const [k, v] of Object.entries(newFilters)) {
        if (v !== undefined && Array.isArray(v) && v.length > 0) {
          cleaned[k] = v
        }
      }
      onChange({
        ...value,
        filters: cleaned,
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
    const newFilters = { ...filters }
    if (newArr.length > 0) {
      newFilters[dimKey] = newArr
    } else {
      delete newFilters[dimKey]
    }
    updateFilters(newFilters)
  }

  // --- Dimensions to show (from demographic_keys enum_values) ---
  const dimensionsToShow = useMemo(() => {
    return demographicKeys
      .filter((dk) => dk.enum_values && dk.enum_values.length > 0)
      .map((dk) => ({
        key: dk.key,
        displayName: dk.display_name,
        bins: dk.enum_values!,
      }))
  }, [demographicKeys])

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

  // --- Active filter count ---
  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).filter(
      ([, val]) => Array.isArray(val) && val.length > 0
    ).length
  }, [filters])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target Demographics</CardTitle>
        <CardDescription>
          {description || 'Select demographic categories and a matching algorithm for backstory selection.'}{' '}
          <Link to="/demographic-surveys/new" className="text-primary hover:underline">
            Missing a demographic? Define your own.
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* =================== Sample Size =================== */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-base">Sample Size</Label>
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

        {/* =================== Demographic Categories (collapsible) =================== */}
        <div className="space-y-3">
          <button
            type="button"
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setShowCategories(!showCategories)}
          >
            {showCategories ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Label className="text-base font-semibold cursor-pointer">
              Demographic Categories
            </Label>
            {!showCategories && activeFilterCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
              </span>
            )}
          </button>

          {showCategories && (
            <div className="space-y-3 pt-1">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-primary border-t-transparent" />
                  Loading...
                </div>
              )}
              {!loading && dimensionsToShow.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No demographic keys with categories found. Define demographics via the link above.
                </p>
              )}

              {dimensionsToShow.map(({ key, displayName, bins }) => (
                <div key={key} className="border rounded-lg p-4">
                  <Label className="text-sm font-semibold capitalize mb-3 block">
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
          )}
        </div>

        {/* =================== Selection Algorithm (collapsible) =================== */}
        <div className="space-y-3">
          <button
            type="button"
            className="flex items-center gap-2 w-full text-left"
            onClick={() => setShowAlgorithm(!showAlgorithm)}
          >
            {showAlgorithm ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Label className="text-base font-semibold cursor-pointer">
              Selection Algorithm
            </Label>
            {!showAlgorithm && (
              <span className="text-xs text-muted-foreground">
                {mode === 'top_k' ? 'Top-K Probability' : 'Balanced Matching'}
                {mode === 'balanced' && crossProduct.groups.length > 0 && sampleSize > 0 && (
                  <> &middot; {crossProduct.groups.length} demographic group{crossProduct.groups.length > 1 ? 's' : ''} &middot; {slotSum} slots allocated</>
                )}
              </span>
            )}
          </button>

          {showAlgorithm && (
            <div className="space-y-4 pt-1">
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as DemographicSelectionMode)}
                className="grid gap-3"
              >
                <label
                  htmlFor="mode-top_k"
                  className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                    mode === 'top_k' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <RadioGroupItem value="top_k" id="mode-top_k" className="mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-medium text-sm">Top-K Probability</span>
                    <p className="text-xs text-muted-foreground">
                      Selects the K backstories most likely to match your criteria. No guarantee of equal representation.
                    </p>
                  </div>
                </label>
                <label
                  htmlFor="mode-balanced"
                  className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                    mode === 'balanced' ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <RadioGroupItem value="balanced" id="mode-balanced" className="mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-medium text-sm">Balanced Matching</span>
                    <p className="text-xs text-muted-foreground">
                      Ensures every selected demographic group is represented via optimal assignment.
                    </p>
                  </div>
                </label>
              </RadioGroup>

              {/* Balanced mode: group & slot info */}
              {mode === 'balanced' && activeFilterCount === 0 && (
                <p className="text-sm text-muted-foreground">
                  {sampleSize > 0
                    ? `No demographic filters selected — ${sampleSize} backstories will be randomly sampled.`
                    : 'Select demographic categories above to define groups for balanced allocation.'}
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
            </div>
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
  const { _sample_size, ...rest } = legacy
  // Clean up: only keep keys with non-empty array values
  const filters: DemographicFilterType = {}
  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v) && v.length > 0) {
      filters[k] = v
    }
  }
  return {
    mode: 'top_k',
    sample_size: _sample_size?.[0] ?? 0,
    filters,
  }
}
