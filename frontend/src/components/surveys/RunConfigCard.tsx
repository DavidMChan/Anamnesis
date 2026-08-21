import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoHint } from '@/components/ui/info-hint'
import { Settings } from 'lucide-react'
import { mergeEffectiveConfig, getConfigSources, getEndpoints, getActiveEndpoint, LLM_DEFAULTS } from '@/lib/llmConfig'
import type { LLMConfig } from '@/types/database'

/** Run configuration card — local state only, applied when "Run Survey" is clicked */
export function RunConfigCard({
  profileConfig,
  overrides,
  onChangeOverrides,
}: {
  profileConfig?: LLMConfig
  overrides: Partial<LLMConfig>
  onChangeOverrides: (o: Partial<LLMConfig>) => void
}) {
  const effective = mergeEffectiveConfig(profileConfig, overrides)
  const sources = getConfigSources(profileConfig, overrides)

  const sourceLabel = (key: string) => {
    const s = sources[key]
    if (s === 'override') return <span className="text-xs text-blue-500 ml-1">(override)</span>
    if (s === 'profile') return <span className="text-xs text-muted-foreground ml-1">(profile)</span>
    return <span className="text-xs text-muted-foreground ml-1">(default)</span>
  }

  const provider = overrides.provider || ''
  const endpoints = getEndpoints(profileConfig)
  // Resolve against the profile registry — `effective` has the registry stripped.
  const selectedEndpoint =
    endpoints.find((e) => e.id === overrides.active_endpoint_id) ?? getActiveEndpoint(profileConfig)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <CardTitle>Run Configuration</CardTitle>
        </div>
        <CardDescription>
          Settings for the next run (empty = inherit from profile)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(320px,1.3fr)]">
          <div className="space-y-2">
            <Label>Provider {sourceLabel('provider')}</Label>
            <Select
              value={provider}
              onValueChange={(v) => onChangeOverrides({ ...overrides, provider: (v || undefined) as LLMConfig['provider'] })}
            >
              <SelectTrigger>
                <SelectValue placeholder={profileConfig?.provider ? `${profileConfig.provider} (profile)` : 'Select provider'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="vllm">Self-hosted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(provider === 'openrouter' || (!provider && effective.provider === 'openrouter')) && (
            <div className="space-y-2">
              <Label>Model {sourceLabel('openrouter_model')}</Label>
              <Input
                value={overrides.openrouter_model ?? ''}
                onChange={(e) => onChangeOverrides({ ...overrides, openrouter_model: e.target.value || undefined })}
                placeholder={profileConfig?.openrouter_model || 'anthropic/claude-3-haiku'}
              />
            </div>
          )}
          {(provider === 'vllm' || (!provider && effective.provider === 'vllm')) && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Endpoint {sourceLabel('active_endpoint_id')}
                <InfoHint side="top">
                  <span className="block">
                    Picks one of the servers saved in Settings. The whole set travels together —
                    base URL, model, chat template and guided decoding.
                  </span>
                  <span className="block">
                    Leave it alone to use whichever endpoint is marked default on your profile.
                  </span>
                </InfoHint>
              </Label>
              <Select
                value={overrides.active_endpoint_id ?? ''}
                onValueChange={(v) =>
                  onChangeOverrides({ ...overrides, active_endpoint_id: v || undefined })
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      selectedEndpoint ? `${selectedEndpoint.name} (profile)` : 'Select endpoint'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {endpoints.map((ep) => (
                    <SelectItem key={ep.id} value={ep.id}>
                      {ep.name || ep.endpoint || 'Unnamed endpoint'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEndpoint && (
                <p className="text-xs text-muted-foreground truncate">
                  {selectedEndpoint.model || 'no model set'} @{' '}
                  {selectedEndpoint.endpoint || 'no URL set'}
                </p>
              )}
              {endpoints.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No endpoints saved yet — add one in Settings.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Temperature {sourceLabel('temperature')}</Label>
            <Input
              type="number"
              min="0" max="2" step="0.1"
              value={overrides.temperature ?? ''}
              onChange={(e) => onChangeOverrides({ ...overrides, temperature: e.target.value ? parseFloat(e.target.value) : undefined })}
              placeholder={`${profileConfig?.temperature ?? LLM_DEFAULTS.temperature} (default)`}
            />
          </div>
          <div className="space-y-2">
            <Label>Max Tokens {sourceLabel('max_tokens')}</Label>
            <Input
              type="number"
              min="1" max="16384" step="1"
              value={overrides.max_tokens ?? ''}
              onChange={(e) => onChangeOverrides({ ...overrides, max_tokens: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              placeholder={`${profileConfig?.max_tokens ?? LLM_DEFAULTS.max_tokens} (default)`}
            />
          </div>
          <div className="space-y-2">
            <Label>Max Concurrent Tasks {sourceLabel('max_concurrent_tasks')}</Label>
            <Input
              type="number"
              min="1" max="200" step="1"
              value={overrides.max_concurrent_tasks ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value, 10) : undefined
                onChangeOverrides({ ...overrides, max_concurrent_tasks: val ? Math.max(1, Math.min(200, val)) : undefined })
              }}
              placeholder={`${profileConfig?.max_concurrent_tasks ?? 10} (default)`}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Parallel LLM requests: 5-10 for cloud APIs, 20-100 for a self-hosted endpoint.
        </p>
      </CardContent>
    </Card>
  )
}
